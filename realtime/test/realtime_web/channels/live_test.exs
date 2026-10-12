defmodule RealtimeWeb.LiveTest do
  use RealtimeWeb.ChannelCase, async: true

  alias Phoenix.Socket.Message
  alias Realtime.Fanout
  alias RealtimeWeb.{ContactChannel, TicketChannel}

  setup do
    agent = Tokens.ws_claims()
    contact = Tokens.widget_claims(%{"wid" => agent["wid"]})
    {:ok, a} = connect_claims(agent)
    {:ok, k} = connect_claims(contact)
    wid = agent["wid"]
    tid = Tokens.uuid()

    {:ok, _, _} = subscribe_and_join(a, TicketChannel, "ticket:#{wid}:#{tid}", %{"watch" => true})
    {:ok, _, _} = subscribe_and_join(k, ContactChannel, "contact:#{wid}:#{contact["sub"]}")
    assert_push "presence_state", _

    %{wid: wid, tid: tid, cid: contact["sub"]}
  end

  defp event(c, type \\ "ai.reply.delta") do
    %{
      "workspace_id" => c.wid,
      "ticket_id" => c.tid,
      "contact_id" => c.cid,
      "type" => type,
      "data" => %{"reply_id" => Tokens.uuid(), "ticket_id" => c.tid, "text" => "Hello"}
    }
  end

  defp publish(c, ev), do: Fanout.handle("od.live." <> c.wid, Jason.encode!(ev))

  test "a live preview reaches the visitor and agents watching the ticket", c do
    ev = event(c)
    ticket = "ticket:#{c.wid}:#{c.tid}"
    contact = "contact:#{c.wid}:#{c.cid}"

    assert {:ok, [^ticket, ^contact]} = publish(c, ev)
    expected = %{"type" => "ai.reply.delta", "data" => ev["data"]}
    assert_receive %Message{topic: ^ticket, event: "live", payload: ^expected}
    assert_receive %Message{topic: ^contact, event: "live", payload: ^expected}
  end

  test "every reply type is forwarded and nothing is deduplicated", c do
    for type <- ~w(ai.reply.started ai.reply.delta ai.reply.tool ai.reply.ended) do
      assert {:ok, _} = publish(c, event(c, type))
      assert {:ok, _} = publish(c, event(c, type))
    end
  end

  test "previews that do not match their subject or are malformed are dropped", c do
    ev = event(c)

    assert Fanout.handle("od.live." <> Tokens.uuid(), Jason.encode!(ev)) ==
             {:error, :workspace_mismatch}

    assert Fanout.handle("od.live.nope", Jason.encode!(ev)) == {:error, :invalid_subject}
    assert publish(c, %{ev | "type" => "message.created"}) == {:error, :invalid_live}
    assert publish(c, %{ev | "ticket_id" => "nope"}) == {:error, :invalid_live}
    assert publish(c, %{ev | "contact_id" => "x"}) == {:error, :invalid_live}
    assert publish(c, %{ev | "data" => "text"}) == {:error, :invalid_live}
    assert publish(c, Map.delete(ev, "workspace_id")) == {:error, :invalid_live}
    assert Fanout.handle("od.live." <> c.wid, "{bad") == {:error, :invalid_json}
    refute_receive %Message{}, 50
  end
end
