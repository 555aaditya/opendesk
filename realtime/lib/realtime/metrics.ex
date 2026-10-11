defmodule Realtime.Metrics do
  @moduledoc """
  Connection and fan-out counters, flushed to PostHog once a minute when
  `POSTHOG_KEY` is set. Counters carry reasons and totals only: never a token,
  an id, a name or any message content.
  """

  use GenServer

  alias Realtime.Nats.Consumer
  alias Realtime.PostHog
  alias Realtime.Sockets

  @table __MODULE__
  @flush_ms 60_000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "Adds one to `key` (an atom or `{atom, atom}`)."
  def incr(key) do
    :ets.update_counter(@table, key, 1, {key, 0})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Current counter values without resetting them."
  def snapshot, do: @table |> :ets.tab2list() |> Map.new()

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    schedule()
    {:ok, nil}
  end

  @impl true
  def handle_info(:flush, state) do
    flush()
    schedule()
    {:noreply, state}
  end

  defp flush do
    counters = :ets.tab2list(@table)
    :ets.delete_all_objects(@table)

    if PostHog.enabled?() do
      props =
        Map.new(counters, fn
          {{name, reason}, n} -> {"#{name}.#{reason}", n}
          {name, n} -> {to_string(name), n}
        end)
        |> Map.merge(%{
          "sockets_open" => Sockets.local_count(),
          "nats_connected" => Consumer.connected?()
        })

      PostHog.capture("realtime_metrics", props)
    end
  end

  defp schedule, do: Process.send_after(self(), :flush, @flush_ms)
end
