defmodule RealtimeWeb.TicketChannel do
  @moduledoc """
  `ticket:<wid>:<ticket_id>`: Presence of agents on a ticket and typing.
  Joined by `ws` tokens with `kind=user` in the same workspace.

  Client pushes:

    * `"presence"` `{state: "viewing" | "replying" | "idle"}` updates the meta.
    * `"typing"` `{contact_id?}` sends `"typing"` `{user_id, name}` to the other
      agents here and, with a `contact_id`, `"typing"`
      `{ticket_id, user: {id, name}}` to `contact:<wid>:<contact_id>`.
  """

  use Phoenix.Channel, log_join: false, log_handle_in: false

  alias Realtime.Ids
  alias RealtimeWeb.Channels.Guard
  alias RealtimeWeb.Endpoint
  alias RealtimeWeb.Presence

  @states ~w(viewing replying idle)

  @impl true
  def join("ticket:" <> rest, _payload, %{assigns: %{kind: :user, wid: wid}} = socket) do
    with [^wid, ticket_id] <- String.split(rest, ":"),
         true <- Ids.uuid?(ticket_id) and ticket_id == Ids.normalize(ticket_id) do
      if Guard.join_allowed?(socket) do
        send(self(), :after_join)
        {:ok, Guard.ok_reply(), assign(socket, :ticket_id, ticket_id)}
      else
        {:error, %{reason: "rate_limited"}}
      end
    else
      _ -> Guard.forbidden(:ticket)
    end
  end

  def join(_topic, _payload, _socket), do: Guard.forbidden(:ticket)

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _ref} = Presence.track(socket, socket.assigns.sub, meta(socket, "viewing"))
    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  @impl true
  def handle_in(event, payload, socket) do
    case Guard.throttle_push(socket) do
      {:ok, socket} -> handle_push(event, payload, socket)
      {:drop, socket} -> {:noreply, socket}
      reply -> reply
    end
  end

  defp handle_push("presence", %{"state" => state}, socket) when state in @states do
    {:ok, _ref} =
      Presence.update(socket, socket.assigns.sub, fn meta -> Map.put(meta, :state, state) end)

    {:reply, :ok, socket}
  end

  defp handle_push("typing", payload, socket) when is_map(payload) do
    %{sub: sub, name: name, wid: wid, ticket_id: ticket_id} = socket.assigns

    case Map.get(payload, "contact_id") do
      nil ->
        broadcast_from!(socket, "typing", %{user_id: sub, name: name})
        {:noreply, socket}

      contact_id ->
        if Ids.uuid?(contact_id) do
          broadcast_from!(socket, "typing", %{user_id: sub, name: name})

          Endpoint.broadcast!("contact:#{wid}:#{Ids.normalize(contact_id)}", "typing", %{
            ticket_id: ticket_id,
            user: %{id: sub, name: name}
          })

          {:noreply, socket}
        else
          Guard.invalid(socket)
        end
    end
  end

  defp handle_push(_event, _payload, socket), do: Guard.invalid(socket)

  defp meta(socket, state) do
    %{
      user_id: socket.assigns.sub,
      name: socket.assigns.name,
      avatar: socket.assigns.avatar,
      state: state,
      online_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end
end
