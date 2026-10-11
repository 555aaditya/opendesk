import Config

config :realtime, RealtimeWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4402],
  secret_key_base: String.duplicate("t", 64),
  server: false

config :realtime,
  check_origins: ["https://app.example.test"],
  auth_secret: "test-auth-secret-0123456789abcdefghijklmnop",
  # The NATS consumer is not started in tests; messages are injected through
  # Realtime.Fanout directly.
  nats_enabled: false

config :logger, level: :warning
