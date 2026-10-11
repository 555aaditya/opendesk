defmodule Realtime.ClientIP do
  @moduledoc """
  The client address used for per-IP limits.

  With `TRUSTED_PROXY_HOPS=0` (default) it is the TCP peer. Behind proxies that
  append to `X-Forwarded-For` (ALB, Caddy, Cloudflare), set it to the number of
  those proxies: the address that many entries from the right is the one the
  outermost trusted proxy saw, which a client cannot forge. Entries further left
  are client-supplied and ignored.
  """

  @spec from_connect_info(map(), non_neg_integer()) :: String.t()
  def from_connect_info(connect_info, hops \\ hops()) do
    peer = peer(connect_info)

    if hops > 0 do
      case forwarded(connect_info) do
        list when length(list) >= hops -> Enum.at(list, -hops)
        _ -> peer
      end
    else
      peer
    end
  end

  defp hops, do: Application.get_env(:realtime, :trusted_proxy_hops, 0)

  defp peer(%{peer_data: %{address: address}}), do: address |> :inet.ntoa() |> to_string()
  defp peer(_), do: "unknown"

  defp forwarded(%{x_headers: headers}) when is_list(headers) do
    for {"x-forwarded-for", value} <- headers,
        part <- String.split(value, ","),
        part = String.trim(part),
        part != "",
        valid_ip?(part),
        do: part
  end

  defp forwarded(_), do: []

  defp valid_ip?(value), do: match?({:ok, _}, :inet.parse_strict_address(to_charlist(value)))
end
