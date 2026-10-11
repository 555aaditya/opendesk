defmodule Realtime.RateLimiter do
  @moduledoc """
  Token buckets in ETS, local to the node.

  A bucket is `{per_second, burst}`: it holds up to `burst` tokens and refills at
  `per_second`. Every `check/2` spends one token. Keys are terms such as
  `{:push, transport_pid}` or `{:connect, ip}`. Buckets idle for longer than
  `@idle_ms` are full again by construction, so a periodic sweep drops them.
  """

  use GenServer

  @table __MODULE__
  @sweep_ms 60_000
  @idle_ms 120_000

  @type bucket :: {pos_integer(), pos_integer()}

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "Spends one token from the bucket at `key`."
  @spec check(term(), bucket()) :: :ok | {:error, :rate_limited}
  def check(key, {per_second, burst}) do
    now = System.monotonic_time(:millisecond)

    tokens =
      case :ets.lookup(@table, key) do
        [{^key, tokens, at}] -> min(burst * 1.0, tokens + (now - at) * per_second / 1000)
        [] -> burst * 1.0
      end

    if tokens >= 1 do
      :ets.insert(@table, {key, tokens - 1, now})
      :ok
    else
      :ets.insert(@table, {key, tokens, now})
      {:error, :rate_limited}
    end
  end

  @doc "Forgets every bucket (tests)."
  def reset, do: :ets.delete_all_objects(@table)

  @doc "Removes buckets idle for longer than `@idle_ms`."
  def sweep do
    cutoff = System.monotonic_time(:millisecond) - @idle_ms
    :ets.select_delete(@table, [{{:_, :_, :"$1"}, [{:<, :"$1", cutoff}], [true]}])
  end

  @impl true
  def init(_opts) do
    :ets.new(@table, [
      :named_table,
      :public,
      :set,
      read_concurrency: true,
      write_concurrency: true
    ])

    schedule()
    {:ok, nil}
  end

  @impl true
  def handle_info(:sweep, state) do
    sweep()
    schedule()
    {:noreply, state}
  end

  defp schedule, do: Process.send_after(self(), :sweep, @sweep_ms)
end
