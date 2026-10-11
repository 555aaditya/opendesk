defmodule RealtimeWeb.Origin do
  @moduledoc """
  Browser `Origin` check for the socket (`CHECK_ORIGINS`).

  Each configured origin is `scheme://host[:port]` (or `//host[:port]` for any
  scheme) and must match exactly; default ports are implied. Phoenix only calls
  this when the request carries an `Origin`; requests without one come from
  non-browser clients and are authorized by their token alone.

  `:any` (development only, when `CHECK_ORIGINS` is unset) allows every origin.
  """

  @doc "Called by the transport with the parsed `Origin` header."
  @spec allowed?(URI.t()) :: boolean()
  def allowed?(%URI{} = origin) do
    case Application.get_env(:realtime, :check_origins, []) do
      :any -> true
      list when is_list(list) -> Enum.any?(list, &same_origin?(&1, origin))
      _ -> false
    end
  end

  defp same_origin?(allowed, origin) when is_binary(allowed) do
    allowed = URI.parse(allowed)

    allowed.host != nil and
      String.downcase(allowed.host) == String.downcase(origin.host || "") and
      (allowed.scheme == nil or allowed.scheme == origin.scheme) and
      (port(allowed) == nil or port(allowed) == port(origin))
  end

  defp same_origin?(_allowed, _origin), do: false

  defp port(%URI{port: port}) when is_integer(port), do: port
  defp port(%URI{scheme: "http"}), do: 80
  defp port(%URI{scheme: "https"}), do: 443
  defp port(_), do: nil
end
