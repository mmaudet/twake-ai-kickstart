'use client'

import { useCallback, useEffect, useState } from 'react'
import UserAccessList, { type UserToken } from '@/components/user-access-list'
import { apiFetch } from '@/lib/api'
import { authHeaders } from '@/lib/auth'

export default function UserPage() {
  const [tokens, setTokens] = useState<UserToken[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchTokens = useCallback(async () => {
    try {
      const data = await apiFetch<UserToken[]>('/tokens', { headers: authHeaders() })
      setTokens(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens')
    }
  }, [])

  useEffect(() => {
    void fetchTokens()
  }, [fetchTokens])

  const handleRevoke = async (service: string) => {
    try {
      await apiFetch<void>(`/tokens/${service}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">My Access</h2>
        <p className="mt-1 text-sm text-gray-500">
          Service tokens granted to your account
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <UserAccessList tokens={tokens} onRevoke={handleRevoke} />
    </div>
  )
}
