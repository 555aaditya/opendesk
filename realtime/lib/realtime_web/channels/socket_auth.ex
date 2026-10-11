defmodule RealtimeWeb.SocketAuth do
  @moduledoc """
  Connect logic shared by both sockets: per-IP connect throttle, token
  verification, the socket's accepted identity kinds, and the socket caps.
  """

  require Logger

  alias Realtime.Auth
  alias Realtime.ClientIP
  alias Realtime.Metrics
  alias Realtime.RateLimiter
  alias Realtime.Sockets

  @doc "Connects `socket` if the token's kind is one of `kinds`."
  def connect(params, socket, connect_info, kinds) do
    ip = ClientIP.from_connect_info(connect_info)

    with :ok <-
           RateLimiter.check(
             {:connect, ip},
             Application.fetch_env!(:realtime, :connect_rate_per_ip)
           ),
         {:ok, identity} <- Auth.verify(params["token"]),
         :ok <- accept_kind(identity, kinds),
         :ok <- Sockets.admit(identity.sub, ip) do
      Metrics.incr({:connected, identity.kind})
      {:ok, Phoenix.Socket.assign(socket, identity)}
    else
      {:error, reason} ->
        Metrics.incr({:rejected, reason})
        Logger.info("socket rejected", reason: reason)
        :error
    end
  end

  defp accept_kind(%{kind: kind}, kinds) do
    if kind in kinds, do: :ok, else: {:error, :wrong_purpose}
  end
end
