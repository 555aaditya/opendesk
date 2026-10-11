defmodule RealtimeWeb.Channels.Guard do
  @moduledoc """
  Shared join and push helpers: the join reply, the forbidden reply, and the
  per-socket token buckets. Buckets are keyed by the transport pid, so every
  channel on one socket draws from the same budget.
  """

  alias Realtime.Metrics
  alias Realtime.RateLimiter

  @forbidden {:error, %{reason: "forbidden"}}

  def forbidden(topic_kind) do
    Metrics.incr({:join_forbidden, topic_kind})
    @forbidden
  end

  def ok_reply, do: %{server_time: DateTime.utc_now() |> DateTime.to_iso8601()}

  @doc "Spends a join token for the socket."
  def join_allowed?(socket),
    do: RateLimiter.check({:join, socket.transport_pid}, limit(:join_rate_per_socket)) == :ok

  @doc """
  Spends a push token. On the first refusal after a success the caller replies
  with `rate_limited`; later refusals in a row are dropped without a reply.
  """
  def throttle_push(socket) do
    case RateLimiter.check({:push, socket.transport_pid}, limit(:push_rate_per_socket)) do
      :ok ->
        {:ok, Phoenix.Socket.assign(socket, :throttled, false)}

      {:error, :rate_limited} ->
        Metrics.incr(:push_throttled)

        if socket.assigns[:throttled] do
          {:drop, socket}
        else
          {:reply, {:error, %{reason: "rate_limited"}},
           Phoenix.Socket.assign(socket, :throttled, true)}
        end
    end
  end

  def invalid(socket), do: {:reply, {:error, %{reason: "invalid"}}, socket}

  defp limit(name), do: Application.fetch_env!(:realtime, name)
end
