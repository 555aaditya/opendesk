import Config

# Structured JSON logs. Metadata is an allowlist so nothing unexpected (such as
# socket assigns) lands in a log line.
config :logger, :default_handler,
  formatter: {LoggerJSON.Formatters.Basic, metadata: [:request_id, :node, :reason, :topic]}

config :logger, level: :info
