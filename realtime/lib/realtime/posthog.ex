defmodule Realtime.PostHog do
  @moduledoc """
  Optional PostHog reporting: periodic connection metrics (`Realtime.Metrics`)
  and exceptions. Off unless `POSTHOG_KEY` is set; then nothing is started and
  no host is contacted.

  What is sent is fixed and content-free: counters, the exception's type and
  stack frames. Exception messages are not sent because they can quote data
  (a `KeyError` prints the map it looked in). No person profile is created: the
  distinct id names the service.
  """

  require Logger

  @finch __MODULE__.Finch
  @tasks __MODULE__.Tasks
  @capture_path "/i/v0/e/"
  @distinct_id "opendesk-realtime"

  @doc "Children for the application supervisor; none when disabled."
  def children do
    if enabled?(), do: [{Finch, name: @finch}, {Task.Supervisor, name: @tasks}], else: []
  end

  def enabled?, do: is_binary(Application.get_env(:realtime, :posthog_key))

  @doc "Sends an event with `properties`."
  def capture(event, properties) when is_binary(event) and is_map(properties) do
    send_event(event, properties)
  end

  @doc "Reports an exception by type and stack frames only."
  def capture_exception(exception, stacktrace \\ []) do
    item = %{
      "type" => exception_type(exception),
      "value" => exception_type(exception),
      "mechanism" => %{"handled" => true, "synthetic" => false}
    }

    item =
      case stacktrace do
        [_ | _] ->
          frames = stacktrace |> Enum.reverse() |> Enum.map(&frame/1)
          Map.put(item, "stacktrace", %{"type" => "raw", "frames" => frames})

        _ ->
          item
      end

    send_event("$exception", %{"$exception_list" => [item], "$exception_level" => "error"})
  end

  defp send_event(event, properties) do
    case Application.get_env(:realtime, :posthog_key) do
      key when is_binary(key) ->
        body =
          Jason.encode!(%{
            "api_key" => key,
            "event" => event,
            "distinct_id" => @distinct_id,
            "timestamp" => DateTime.utc_now() |> DateTime.to_iso8601(),
            "properties" =>
              Map.merge(properties, %{
                "$process_person_profile" => false,
                "$geoip_disable" => true,
                "service" => "realtime"
              })
          })

        _ = Task.Supervisor.start_child(@tasks, fn -> post(body) end)
        :ok

      _ ->
        :ok
    end
  end

  defp post(body) do
    host = Application.get_env(:realtime, :posthog_host) |> String.trim_trailing("/")

    request =
      Finch.build(:post, host <> @capture_path, [{"content-type", "application/json"}], body)

    case Finch.request(request, @finch, receive_timeout: 5_000) do
      {:ok, %Finch.Response{status: status}} when status in 200..299 ->
        :ok

      {:ok, %Finch.Response{status: status}} ->
        Logger.warning("PostHog rejected a report", reason: status)

      {:error, _} ->
        Logger.warning("PostHog unreachable")
    end
  end

  defp exception_type(%module{}), do: inspect(module)
  defp exception_type({kind, _}) when is_atom(kind), do: to_string(kind)
  defp exception_type(_), do: "error"

  defp frame({module, function, arity, location}) do
    %{
      "platform" => "custom",
      "lang" => "elixir",
      "function" => Exception.format_mfa(module, function, arity),
      "filename" => location |> Keyword.get(:file, ~c"") |> to_string(),
      "lineno" => Keyword.get(location, :line, 0),
      "in_app" => String.starts_with?(Atom.to_string(module), "Elixir.Realtime"),
      "resolved" => true
    }
  end

  defp frame(_), do: %{"platform" => "custom", "lang" => "elixir", "function" => "unknown"}
end
