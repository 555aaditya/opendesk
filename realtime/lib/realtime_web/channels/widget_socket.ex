defmodule RealtimeWeb.WidgetSocket do
  @moduledoc """
  The chat widget's socket at `/socket/widget`. The widget runs on customer
  websites, so any browser origin may connect; what authorizes it is the
  `widget_ws` token, the only purpose accepted here, and the only topic it can
  join is its own `contact:<wid>:<sub>`.
  """

  use Phoenix.Socket, log: false

  channel "contact:*", RealtimeWeb.ContactChannel

  @impl true
  def connect(params, socket, connect_info),
    do: RealtimeWeb.SocketAuth.connect(params, socket, connect_info, [:contact])

  @impl true
  def id(socket), do: "user_socket:" <> socket.assigns.sub
end
