'use client'

export interface UserToken {
  service: string
  status: string
  expires_at: string
  granted_by?: string
  granted_at?: string
  instance_url?: string
}

interface UserAccessListProps {
  tokens: UserToken[]
  onRevoke: (service: string) => void
}

export default function UserAccessList({ tokens, onRevoke }: UserAccessListProps) {
  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        You have no active service tokens.
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tokens.map((token) => (
        <div
          key={token.service}
          className="rounded-lg border border-gray-200 bg-white p-5 flex flex-col gap-3"
        >
          <div className="flex items-start justify-between">
            <span className="font-semibold font-mono text-gray-800">{token.service}</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                token.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {token.status}
            </span>
          </div>

          <div className="space-y-1 text-xs text-gray-500">
            {token.granted_at && (
              <p>
                <span className="font-medium text-gray-600">Granted:</span>{' '}
                {new Date(token.granted_at).toLocaleDateString()}
              </p>
            )}
            {token.granted_by && (
              <p>
                <span className="font-medium text-gray-600">By:</span> {token.granted_by}
              </p>
            )}
            <p>
              <span className="font-medium text-gray-600">Expires:</span>{' '}
              {new Date(token.expires_at).toLocaleString()}
            </p>
          </div>

          <button
            onClick={() => onRevoke(token.service)}
            className="mt-auto self-start rounded px-3 py-1 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
          >
            Revoke
          </button>
        </div>
      ))}
    </div>
  )
}
