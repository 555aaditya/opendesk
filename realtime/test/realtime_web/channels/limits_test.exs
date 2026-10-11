defmodule RealtimeWeb.LimitsTest do
  # Changes application env (caps), so not async.
  use RealtimeWeb.ChannelCase, async: false

  alias Phoenix.Socket.Broadcast
  alias Realtime.{Fanout, RateLimiter}
  alias RealtimeWeb.{Endpoint, TicketChannel, WorkspaceChannel}

  defp with_env(key, value) do
    old = Application.fetch_env!(:realtime, key)
    Application.put_env(:realtime, key, value)
    on_exit(fn -> Application.put_env(:realtime, key, old) end)
  end

  test "token bucket: burst, then refuse, then refill" do
    # 10 per second: one token every 100 ms, so a slow machine cannot refill
    # the bucket between the burst and the refusal.
    key = {:test, make_ref()}
    for _ <- 1..5, do: assert(RateLimiter.check(key, {10, 5}) == :ok)
    assert RateLimiter.check(key, {10, 5}) == {:error, :rate_limited}
    Process.sleep(150)
    assert RateLimiter.check(key, {10, 5}) == :ok
  end

  test "at most 20 concurrent sockets per subject" do
    claims = Tokens.ws_claims()
    for _ <- 1..20, do: assert({:ok, _} = connect_claims(claims))
    assert connect_claims(claims) == :error

    # Another subject is unaffected.
    assert {:ok, _} = connect_claims(Tokens.ws_claims())
  end

  test "sockets count until their process exits" do
    claims = Tokens.ws_claims()
    test = self()

    ip = Tokens.random_ip() |> :inet.ntoa() |> to_string()

    holder =
      spawn(fn ->
        for _ <- 1..20, do: :ok = Realtime.Sockets.admit(claims["sub"], ip)
        send(test, :full)

        receive do
          :stop -> :ok
        end
      end)

    assert_receive :full
    assert connect_claims(claims) == :error
    ref = Process.monitor(holder)
    send(holder, :stop)
    assert_receive {:DOWN, ^ref, _, _, _}
    # :pg drops members asynchronously once the process is gone.
    Process.sleep(20)
    assert {:ok, _} = connect_claims(claims)
  end

  test "concurrent sockets per IP are capped" do
    with_env(:max_sockets_per_ip, 3)
    ip = Tokens.random_ip()
    for _ <- 1..3, do: assert({:ok, _} = connect_claims(Tokens.ws_claims(), ip))
    assert connect_claims(Tokens.ws_claims(), ip) == :error
    assert {:ok, _} = connect_claims(Tokens.ws_claims(), Tokens.random_ip())
  end

  test "connects per IP are rate limited" do
    with_env(:connect_rate_per_ip, {1, 3})
    ip = Tokens.random_ip()
    for _ <- 1..3, do: assert({:ok, _} = connect_claims(Tokens.ws_claims(), ip))
    assert connect_claims(Tokens.ws_claims(), ip) == :error
  end

  test "joins per socket are rate limited" do
    with_env(:join_rate_per_socket, {1, 2})
    claims = Tokens.ws_claims()
    {:ok, socket} = connect_claims(claims)
    topic = "workspace:#{claims["wid"]}"
    assert {:ok, _, _} = subscribe_and_join(socket, WorkspaceChannel, topic)
    assert {:ok, _, _} = subscribe_and_join(socket, WorkspaceChannel, topic)

    assert subscribe_and_join(socket, WorkspaceChannel, topic) ==
             {:error, %{reason: "rate_limited"}}
  end

  test "typing is throttled per socket: excess is refused once, then dropped silently" do
    # Slow refill so the test's own pace does not add tokens.
    with_env(:push_rate_per_socket, {1, 20})
    claims = Tokens.ws_claims()
    {:ok, socket} = connect_claims(claims)
    topic = "ticket:#{claims["wid"]}:#{Tokens.uuid()}"
    # subscribe_and_join also subscribes this process to the topic.
    {:ok, _, ticket} = subscribe_and_join(socket, TicketChannel, topic)

    for _ <- 1..20, do: push(ticket, "typing", %{})
    for _ <- 1..20, do: assert_receive(%Broadcast{event: "typing"})

    ref = push(ticket, "typing", %{})
    assert_reply ref, :error, %{reason: "rate_limited"}
    ref = push(ticket, "typing", %{})
    refute_reply ref, _, _, 50
    refute_receive %Broadcast{event: "typing"}, 50
  end

  test "presence and typing share the socket's budget" do
    claims = Tokens.ws_claims()
    {:ok, socket} = connect_claims(claims)

    {:ok, _, ticket} =
      subscribe_and_join(socket, TicketChannel, "ticket:#{claims["wid"]}:#{Tokens.uuid()}")

    refs = for _ <- 1..20, do: push(ticket, "presence", %{"state" => "idle"})
    for ref <- refs, do: assert_reply(ref, :ok)
    ref = push(ticket, "typing", %{})
    assert_reply ref, :error, %{reason: "rate_limited"}
  end

  test "od.control.disconnect broadcasts disconnect to the user's socket id" do
    claims = Tokens.ws_claims()
    {:ok, socket} = connect_claims(claims)
    id = RealtimeWeb.UserSocket.id(socket)
    :ok = Endpoint.subscribe(id)

    payload = Jason.encode!(%{"user_id" => String.upcase(claims["sub"]), "session_id" => "s"})
    assert {:ok, [^id]} = Fanout.handle("od.control.disconnect", payload)
    assert_receive %Broadcast{topic: ^id, event: "disconnect"}
  end

  test "malformed disconnects are dropped" do
    for body <- ["{}", ~s({"user_id":"x"}), "nope", ~s({"user_id":1})] do
      assert Fanout.handle("od.control.disconnect", body) == {:error, :invalid_disconnect}
    end
  end
end
