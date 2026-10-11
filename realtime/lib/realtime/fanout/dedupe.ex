defmodule Realtime.Fanout.Dedupe do
  @moduledoc """
  Drops envelopes this node has already broadcast.

  The outbox relay delivers at least once: it publishes to NATS and then marks
  the row, so a failure in between publishes the same event again. `seq` only
  grows within a workspace, so remembering the highest `seq` broadcast per
  workspace is enough to drop repeats (and stragglers older than it; a client
  that saw the newer event has already noticed the gap and replays it through
  `GET /v1/events`). Workspaces idle for an hour are forgotten.
  """

  use GenServer

  @table __MODULE__
  @sweep_ms 600_000
  @idle_ms 3_600_000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "`:ok` the first time `seq` (or a higher one) is seen for `wid`."
  @spec check(String.t(), term()) :: :ok | :duplicate
  def check(wid, seq) when is_integer(seq) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, wid) do
      [{^wid, last, _}] when seq <= last ->
        :duplicate

      _ ->
        :ets.insert(@table, {wid, seq, now})
        :ok
    end
  end

  def check(_wid, _seq), do: :ok

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set])
    schedule()
    {:ok, nil}
  end

  @impl true
  def handle_info(:sweep, state) do
    cutoff = System.monotonic_time(:millisecond) - @idle_ms
    :ets.select_delete(@table, [{{:_, :_, :"$1"}, [{:<, :"$1", cutoff}], [true]}])
    schedule()
    {:noreply, state}
  end

  defp schedule, do: Process.send_after(self(), :sweep, @sweep_ms)
end
