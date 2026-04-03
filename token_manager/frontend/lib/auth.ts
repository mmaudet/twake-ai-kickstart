'use client'

let oidcToken: string | null = null

export function setOidcToken(token: string) {
  oidcToken = token
}

export function getOidcToken(): string | null {
  return oidcToken
}

export function authHeaders(): Record<string, string> {
  // Use stored OIDC token, or fall back to dev token for local testing
  const token = oidcToken ?? getDevToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

function getDevToken(): string | null {
  if (typeof window === 'undefined') return null
  // Check URL param ?dev_user=user1 or use localStorage
  const params = new URLSearchParams(window.location.search)
  const devUser = params.get('dev_user')
  if (devUser) {
    localStorage.setItem('twake_dev_token', `dev-${devUser}`)
    return `dev-${devUser}`
  }
  return localStorage.getItem('twake_dev_token')
}
