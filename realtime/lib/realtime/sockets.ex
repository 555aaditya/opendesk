defmodule Realtime.Sockets do
  @moduledoc """
  Concurrent socket caps per token subject and per client IP, cluster-wide.

  Each admitted socket process joins `:pg` groups in the `Realtime.Sockets`
  scope. `:pg` replicates membership to every connected node and drops a member
  when its process exits, so the counts need no bookkeeping and include the
  sockets held by other nodes. Two connects racing on different nodes can both
  pass at the limit; the cap is a guard against abuse, not an exact quota.
  """

  @scope __MODULE__

  @doc "The `:pg` scope child spec, started by the application."
  def child_spec(_opts), do: %{id: @scope, start: {:pg, :start_link, [@scope]}}

  @doc "Admits the calling socket process, or refuses it at a cap."
  @spec admit(String.t(), String.t(), pid()) ::
          :ok | {:error, :too_many_sockets | :too_many_sockets_ip}
  def admit(sub, ip, pid \\ self()) do
    cond do
      count({:sub, sub}) >= max_per_sub() ->
        {:error, :too_many_sockets}

      count({:ip, ip}) >= max_per_ip() ->
        {:error, :too_many_sockets_ip}

      true ->
        Enum.each([{:sub, sub}, {:ip, ip}, :all], &:pg.join(@scope, &1, pid))
    end
  end

  @doc "Sockets open for `group` across the cluster."
  def count(group), do: @scope |> :pg.get_members(group) |> length()

  @doc "Sockets open on this node."
  def local_count, do: @scope |> :pg.get_local_members(:all) |> length()

  defp max_per_sub, do: Application.get_env(:realtime, :max_sockets_per_sub, 20)
  defp max_per_ip, do: Application.get_env(:realtime, :max_sockets_per_ip, 200)
end
