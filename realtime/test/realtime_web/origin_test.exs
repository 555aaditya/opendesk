defmodule RealtimeWeb.OriginTest do
  use ExUnit.Case, async: false

  alias RealtimeWeb.Origin

  setup do
    old = Application.get_env(:realtime, :check_origins)
    on_exit(fn -> Application.put_env(:realtime, :check_origins, old) end)
    :ok
  end

  defp allowed?(origin), do: Origin.allowed?(URI.parse(origin))

  test "matches scheme, host and port exactly" do
    Application.put_env(:realtime, :check_origins, [
      "https://app.opendesk.sh",
      "http://localhost:5173",
      "//desk.example.com"
    ])

    assert allowed?("https://app.opendesk.sh")
    assert allowed?("https://APP.opendesk.sh:443")
    assert allowed?("http://localhost:5173")
    assert allowed?("https://desk.example.com")
    assert allowed?("http://desk.example.com")

    refute allowed?("http://app.opendesk.sh")
    refute allowed?("https://app.opendesk.sh:8443")
    refute allowed?("https://evil.app.opendesk.sh")
    refute allowed?("https://app.opendesk.sh.evil.com")
    refute allowed?("http://localhost:5174")
    refute allowed?("null")
  end

  test "an empty list allows no browser origin; :any allows all" do
    Application.put_env(:realtime, :check_origins, [])
    refute allowed?("https://app.opendesk.sh")
    Application.put_env(:realtime, :check_origins, :any)
    assert allowed?("https://anything.example")
  end
end
