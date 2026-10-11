defmodule RealtimeWeb.ErrorJSON do
  @moduledoc "Error bodies for the endpoint: a status message, never details."
  def render(template, _assigns),
    do: %{error: Phoenix.Controller.status_message_from_template(template)}
end
