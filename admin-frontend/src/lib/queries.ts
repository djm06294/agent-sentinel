import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, errorMessage } from '@/lib/api'

export const keys = {
  users: ['agent-users'] as const,
  agents: ['agents'] as const,
  servers: ['servers'] as const,
  policies: ['policies'] as const,
}

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: api.users.list })
export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: api.agents.list })
export const useServers = () => useQuery({ queryKey: keys.servers, queryFn: api.servers.list })
export const usePolicies = () => useQuery({ queryKey: keys.policies, queryFn: api.policies.list })

/** 저장 후 목록 갱신 + 결과 알림을 묶은 mutation */
export function useSave<Args>(key: readonly string[], fn: (args: Args) => Promise<unknown>, success: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(success)
      return client.invalidateQueries({ queryKey: key })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}
