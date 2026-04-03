'use client'
let oidcToken: string | null = null
export function setOidcToken(token: string) { oidcToken = token }
export function getOidcToken(): string | null { return oidcToken }
export function authHeaders(): Record<string, string> {
  if (!oidcToken) return {}
  return { Authorization: `Bearer ${oidcToken}` }
}
