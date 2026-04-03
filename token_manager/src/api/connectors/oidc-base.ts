import type { Tenant } from '@prisma/client'
import type { ServiceConfig } from '../config.js'
import type { AuthResult, ServiceConnector, TokenPair } from './interface.js'

interface OidcTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export abstract class OidcBaseConnector implements ServiceConnector {
  abstract readonly serviceId: string

  protected readonly _config: ServiceConfig
  protected readonly _oidcIssuer: string

  constructor(config: ServiceConfig, oidcIssuer: string) {
    this._config = config
    this._oidcIssuer = oidcIssuer
  }

  getInstanceUrl(_userId: string, _tenant: Tenant): string {
    return this._config.instance_url ?? ''
  }

  async authenticate(_userId: string, _tenant: Tenant, oidcToken: string): Promise<AuthResult> {
    return {
      type: 'direct',
      tokenPair: {
        accessToken: oidcToken,
        expiresAt: new Date(Date.now() + this._config.token_validity_ms),
      },
    }
  }

  async refresh(refreshToken: string, _tenant: Tenant, _instanceUrl: string): Promise<TokenPair> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })

    const resp = await fetch(`${this._oidcIssuer}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`OIDC token refresh failed (${resp.status}): ${text}`)
    }

    const data = (await resp.json()) as OidcTokenResponse
    const expiresInMs = (data.expires_in ?? this._config.token_validity_ms / 1000) * 1000

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + expiresInMs),
    }
  }

  async revoke(accessToken: string, _tenant: Tenant): Promise<void> {
    const body = new URLSearchParams({
      token: accessToken,
      token_type_hint: 'access_token',
    })

    const resp = await fetch(`${this._oidcIssuer}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`OIDC token revoke failed (${resp.status}): ${text}`)
    }
  }
}
