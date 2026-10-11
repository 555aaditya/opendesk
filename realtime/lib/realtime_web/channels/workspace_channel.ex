defmodule RealtimeWeb.WorkspaceChannel do
  @moduledoc """
  `workspace:<wid>`: every event of the workspace, both visibilities. Joined by
  `ws` tokens (users and API keys) whose `wid` matches.
  """

  use Phoenix.Channel, log_join: false, log_handle_in: false

  alias RealtimeWeb.Channels.Guard

  @impl true
  def join("workspace:" <> wid, _payload, %{assigns: %{kind: kind, wid: wid}} = socket)
      when kind in [:user, :api_key] do
    if Guard.join_allowed?(socket),
      do: {:ok, Guard.ok_reply(), socket},
      else: {:error, %{reason: "rate_limited"}}
  end

  def join(_topic, _payload, _socket), do: Guard.forbidden(:workspace)

  @impl true
  def handle_in(_event, _payload, socket) do
    case Guard.throttle_push(socket) do
      {:ok, socket} -> Guard.invalid(socket)
      {:drop, socket} -> {:noreply, socket}
      reply -> reply
    end
  end
end
