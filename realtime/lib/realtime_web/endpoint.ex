defmodule RealtimeWeb.Endpoint do
  @moduledoc """
  WebSocket gateway endpoint. Serves `/socket` and `/socket/widget` (Phoenix Channels,
  JSON v2 serializer) and `GET /health`; everything else is 404.

  `/socket` (agents): a browser upgrade whose `Origin` is not in
  `CHECK_ORIGINS` is refused with 403 (`RealtimeWeb.Origin`); clients that send
  no `Origin` (servers, CLIs) are allowed, as the token authorizes them.

  `/socket/widget` (chat widget on customer sites): any Origin, `widget_ws`
  tokens only, `contact:` topics only.
  """

  use Phoenix.Endpoint, otp_app: :realtime

  @websocket [
    serializer: [{Phoenix.Socket.V2.JSONSerializer, "~> 2.0.0"}],
    timeout: 60_000,
    # Client frames are small (joins, presence, typing).
    max_frame_size: 16_384,
    compress: false,
    connect_info: [:peer_data, :x_headers]
  ]

  # The chat widget is embedded on customer sites, so its socket allows any
  # Origin; it accepts only widget_ws tokens and routes only contact: topics.
  socket "/socket/widget", RealtimeWeb.WidgetSocket,
    websocket: [{:check_origin, false} | @websocket],
    longpoll: false

  socket "/socket", RealtimeWeb.UserSocket,
    websocket: [{:check_origin, {RealtimeWeb.Origin, :allowed?, []}} | @websocket],
    longpoll: false

  plug :health
  plug :not_found

  defp health(%Plug.Conn{method: "GET", request_path: "/health"} = conn, _opts) do
    conn
    |> Plug.Conn.put_resp_content_type("text/plain")
    |> Plug.Conn.send_resp(200, "ok")
    |> Plug.Conn.halt()
  end

  defp health(conn, _opts), do: conn

  defp not_found(conn, _opts) do
    conn
    |> Plug.Conn.put_resp_content_type("text/plain")
    |> Plug.Conn.send_resp(404, "not found")
    |> Plug.Conn.halt()
  end
end
