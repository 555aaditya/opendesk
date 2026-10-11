defmodule Realtime.PostHog.LoggerHandler do
  @moduledoc """
  A `:logger` handler that forwards crashes to PostHog. Only the exception type
  and stack frames are sent; the log message and process state never leave the
  node (they can hold socket assigns or event payloads).
  """

  @doc false
  def log(%{level: level, meta: meta}, _config)
      when level in [:error, :critical, :alert, :emergency] do
    case Map.get(meta, :crash_reason) do
      {exception, stacktrace} when is_list(stacktrace) ->
        Realtime.PostHog.capture_exception(exception, stacktrace)

      _ ->
        :ok
    end
  end

  def log(_event, _config), do: :ok
end
