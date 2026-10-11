defmodule Realtime.RuntimeConfigTest do
  # Reads config/runtime.exs as a prod boot would; touches the OS environment.
  use ExUnit.Case, async: false

  @vars ~w(AUTH_SECRET SECRET_KEY_BASE CHECK_ORIGINS NATS_URL NATS_TOKEN PORT CLUSTER_DNS POSTHOG_KEY)

  setup do
    saved = Map.new(@vars, &{&1, System.get_env(&1)})

    on_exit(fn ->
      Enum.each(saved, fn
        {k, nil} -> System.delete_env(k)
        {k, v} -> System.put_env(k, v)
      end)
    end)

    Enum.each(@vars, &System.delete_env/1)
    :ok
  end

  defp prod_env(vars) do
    Enum.each(vars, fn {k, v} -> System.put_env(k, v) end)
    Config.Reader.read!("config/runtime.exs", env: :prod)
  end

  @good %{
    "AUTH_SECRET" => String.duplicate("a", 32),
    "SECRET_KEY_BASE" => String.duplicate("b", 64),
    "CHECK_ORIGINS" => "https://app.opendesk.sh, https://desk.example.com"
  }

  test "boots with a full prod environment" do
    config =
      prod_env(Map.merge(@good, %{"NATS_URL" => "nats://nats:4222", "CLUSTER_DNS" => "rt.local"}))

    assert config[:realtime][:auth_secret] == String.duplicate("a", 32)
    assert config[:realtime][:nats][:url] == "nats://nats:4222"

    assert config[:realtime][:check_origins] == [
             "https://app.opendesk.sh",
             "https://desk.example.com"
           ]

    assert [opendesk: topology] = config[:libcluster][:topologies]
    assert topology[:strategy] == Cluster.Strategy.DNSPoll
  end

  test "refuses a short AUTH_SECRET" do
    assert_raise RuntimeError, ~r/at least 32 bytes/, fn ->
      prod_env(%{@good | "AUTH_SECRET" => String.duplicate("a", 31)})
    end
  end

  test "refuses a missing AUTH_SECRET, SECRET_KEY_BASE or CHECK_ORIGINS" do
    for var <- Map.keys(@good) do
      Enum.each(@vars, &System.delete_env/1)
      assert_raise RuntimeError, ~r/#{var}/, fn -> prod_env(Map.delete(@good, var)) end
    end
  end
end
