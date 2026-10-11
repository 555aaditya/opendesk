defmodule RealtimeWeb.Presence do
  @moduledoc "Who is viewing or replying to a ticket. Replicated across the cluster."
  use Phoenix.Presence, otp_app: :realtime, pubsub_server: Realtime.PubSub
end
