defmodule Realtime.Fanout do
  @moduledoc """
  Turns NATS messages into channel broadcasts (`contracts/events.md`).

  Every gateway node subscribes to NATS on its own (no queue group), so every
  node receives every message exactly once and broadcasts it only to the
  sockets connected to it (`local_broadcast`). Each socket lives on one node,
  so each client receives each event once, in the order NATS delivered it.

  Fan-out of an envelope on `od.events.<wid>`:

    * `workspace:<wid>` always (agents see both visibilities);
    * every `user:<uid>` listed in `topics`;
    * every `contact:<wid>:<cid>` listed in `topics`, only when visibility is
      `public`, and only for the envelope's own workspace.

  The pushed payload is the envelope minus `topics`. Repeats of an envelope
  (the relay delivers at least once) are dropped by `Realtime.Fanout.Dedupe`.

  Live previews on `od.live.<wid>` (`contracts/realtime.md`, "Live events") are
  pushed as `"live"` `{type, data}` to `contact:<wid>:<contact_id>` and
  `ticket:<wid>:<ticket_id>`. They carry no `seq` and are never deduplicated
  or replayed.
  """

  require Logger

  alias Realtime.Fanout.Dedupe
  alias Realtime.Ids
  alias Realtime.Metrics

  @events_prefix "od.events."
  @live_prefix "od.live."
  @disconnect "od.control.disconnect"
  @live_types ~w(ai.reply.started ai.reply.delta ai.reply.tool ai.reply.ended)

  @doc "NATS subjects the gateway subscribes to."
  def subjects, do: [@events_prefix <> ">", @live_prefix <> ">", @disconnect]

  @doc """
  Handles one NATS message. `broadcast` is `(topic, event, payload) -> any`,
  `RealtimeWeb.Endpoint.local_broadcast/3` by default.
  """
  @spec handle(String.t(), iodata(), (String.t(), String.t(), map() -> any())) ::
          {:ok, [String.t()]} | {:error, atom()}
  def handle(subject, body, broadcast \\ &RealtimeWeb.Endpoint.local_broadcast/3)

  def handle(@disconnect, body, broadcast) do
    with {:ok, %{"user_id" => user_id}} <- decode(body),
         true <- Ids.uuid?(user_id) do
      topic = "user_socket:" <> Ids.normalize(user_id)
      broadcast.(topic, "disconnect", %{})
      Metrics.incr(:disconnects)
      {:ok, [topic]}
    else
      _ -> reject(:invalid_disconnect)
    end
  end

  def handle(@events_prefix <> wid, body, broadcast) do
    with true <- Ids.uuid?(wid),
         {:ok, envelope} <- decode(body),
         {:ok, topics} <- topics(Ids.normalize(wid), envelope),
         :ok <- Dedupe.check(Ids.normalize(wid), envelope["seq"]) do
      payload = Map.delete(envelope, "topics")
      Enum.each(topics, &broadcast.(&1, "event", payload))
      Metrics.incr(:events)
      {:ok, topics}
    else
      :duplicate ->
        Metrics.incr(:duplicates)
        {:error, :duplicate}

      {:error, reason} ->
        reject(reason)

      _ ->
        reject(:invalid_subject)
    end
  end

  def handle(@live_prefix <> wid, body, broadcast) do
    with true <- Ids.uuid?(wid),
         {:ok, event} <- decode(body),
         {:ok, topics, payload} <- live(Ids.normalize(wid), event) do
      Enum.each(topics, &broadcast.(&1, "live", payload))
      Metrics.incr(:live)
      {:ok, topics}
    else
      {:error, reason} -> reject(reason)
      _ -> reject(:invalid_subject)
    end
  end

  def handle(_subject, _body, _broadcast), do: reject(:unknown_subject)

  @doc "The topics and payload of a live preview from workspace `wid`."
  @spec live(String.t(), map()) :: {:ok, [String.t()], map()} | {:error, atom()}
  def live(
        wid,
        %{
          "workspace_id" => event_wid,
          "ticket_id" => tid,
          "contact_id" => cid,
          "type" => type,
          "data" => data
        }
      )
      when is_binary(event_wid) and is_binary(tid) and is_binary(cid) and type in @live_types and
             is_map(data) do
    with :ok <- same_workspace(event_wid, wid),
         :ok <- live_ids(tid, cid) do
      topics = ["ticket:#{wid}:#{Ids.normalize(tid)}", "contact:#{wid}:#{Ids.normalize(cid)}"]
      {:ok, topics, %{"type" => type, "data" => data}}
    end
  end

  def live(_wid, _event), do: {:error, :invalid_live}

  defp same_workspace(event_wid, wid) do
    if Ids.uuid?(event_wid) and Ids.normalize(event_wid) == wid,
      do: :ok,
      else: {:error, :workspace_mismatch}
  end

  defp live_ids(tid, cid) do
    if Ids.uuid?(tid) and Ids.uuid?(cid), do: :ok, else: {:error, :invalid_live}
  end

  @doc "The channel topics an envelope from workspace `wid` fans out to."
  @spec topics(String.t(), map()) :: {:ok, [String.t()]} | {:error, atom()}
  def topics(wid, %{"workspace_id" => envelope_wid, "visibility" => visibility} = envelope)
      when is_binary(envelope_wid) and visibility in ["agents", "public"] do
    listed = Map.get(envelope, "topics", [])

    cond do
      Ids.normalize(envelope_wid) != wid ->
        {:error, :workspace_mismatch}

      not is_list(listed) ->
        {:error, :invalid_envelope}

      true ->
        extra = listed |> Enum.flat_map(&route(&1, wid, visibility))
        {:ok, Enum.uniq(["workspace:" <> wid | extra])}
    end
  end

  def topics(_wid, _envelope), do: {:error, :invalid_envelope}

  defp route("user:" <> uid, _wid, _visibility) do
    if Ids.uuid?(uid), do: ["user:" <> Ids.normalize(uid)], else: []
  end

  defp route("contact:" <> rest, wid, "public") do
    case String.split(rest, ":") do
      [^wid, cid] -> if Ids.uuid?(cid), do: ["contact:#{wid}:#{Ids.normalize(cid)}"], else: []
      _ -> []
    end
  end

  defp route(_topic, _wid, _visibility), do: []

  defp decode(body) do
    case Jason.decode(body) do
      {:ok, map} when is_map(map) -> {:ok, map}
      _ -> {:error, :invalid_json}
    end
  end

  # The message body is never logged: it carries customer content.
  defp reject(reason) do
    Metrics.incr({:nats_rejected, reason})
    Logger.warning("dropped NATS message", reason: reason)
    {:error, reason}
  end
end
