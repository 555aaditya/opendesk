defmodule Realtime.Ids do
  @moduledoc "Identifier validation. Every id the gateway accepts is a canonical lowercase-or-uppercase UUID."

  @uuid ~r/\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z/

  @doc "True when `value` is a UUID string in the 8-4-4-4-12 form."
  @spec uuid?(term()) :: boolean()
  def uuid?(value) when is_binary(value) and byte_size(value) == 36,
    do: Regex.match?(@uuid, value)

  def uuid?(_), do: false

  @doc "Lowercases a UUID so topic names compare equal however the issuer cased it."
  @spec normalize(String.t()) :: String.t()
  def normalize(value), do: String.downcase(value)
end
