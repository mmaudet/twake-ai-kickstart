'use client'

import { useCallback, useEffect, useState } from 'react'
import StatsBar from '@/components/stats-bar'
import TokenTable, { type Token } from '@/components/token-table'
import { apiFetch } from '@/lib/api'
import { authHeaders } from '@/lib/auth'

export default function AdminDashboard() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchTokens = useCallback(async () => {
    try {
      const data = await apiFetch<Token[]>('/admin/tokens', { headers: authHeaders() })
      setTokens(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens')
    }
  }, [])

  useEffect(() => {
    void fetchTokens()
    const interval = setInterval(() => { void fetchTokens() }, 30_000)
    return () => clearInterval(interval)
  }, [fetchTokens])

  const handleRevoke = async (service: string, user: string) => {
    try {
      await apiFetch<void>(`/tokens/${service}?user=${encodeURIComponent(user)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  const handleRefresh = async (service: string, user: string) => {
    try {
      await apiFetch<void>('/tokens/refresh', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ service, user }),
      })
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    }
  }

  const visibleTokens = tokens.filter((t) => t.status !== 'REVOKED')
  const active = visibleTokens.filter((t) => t.status === 'ACTIVE').length
  const expired = visibleTokens.filter(
    (t) => t.status === 'EXPIRED' || t.status === 'REFRESH_FAILED',
  ).length
  const umbrella = visibleTokens.length

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Admin Dashboard</h2>
        <p className="mt-1 text-sm text-gray-500">All tenant tokens — auto-refreshes every 30s</p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <StatsBar active={active} expired={expired} umbrella={umbrella} />
      <TokenTable tokens={visibleTokens} onRevoke={handleRevoke} onRefresh={handleRefresh} />
    </div>
  )
}
