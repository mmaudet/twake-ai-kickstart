import type { FastifyRequest, FastifyReply } from 'fastify'
import * as jose from 'jose'

const ADMIN_GROUP = 'token-manager-admins'

export interface OidcUser {
  sub: string
  email: string
  groups: string[]
  token: string
  isAdmin: boolean
}

// Injectable verify function for testing
type JwtVerifyFn = (token: string, issuer: string) => Promise<{ payload: Record<string, any> }>

export async function validateOidcToken(
  authHeader: string | undefined,
  oidcIssuer: string,
  jwtVerifyFn?: JwtVerifyFn,
): Promise<OidcUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const verify = jwtVerifyFn ?? defaultJwtVerify

  try {
    const { payload } = await verify(token, oidcIssuer)
    const groups = (payload.groups as string[]) ?? []
    return {
      sub: payload.sub as string,
      email: (payload.email as string) ?? `${payload.sub}@unknown`,
      groups,
      token,
      isAdmin: groups.some((g) => g.includes(ADMIN_GROUP)),
    }
  } catch {
    return null
  }
}

let cachedJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null

async function defaultJwtVerify(token: string, oidcIssuer: string) {
  if (!cachedJwks) {
    cachedJwks = jose.createRemoteJWKSet(new URL(`${oidcIssuer}/.well-known/jwks.json`))
  }
  return jose.jwtVerify(token, cachedJwks, { issuer: oidcIssuer })
}

export function authHook(oidcIssuer: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await validateOidcToken(request.headers.authorization, oidcIssuer)
    if (!user) {
      reply.code(401).send({ error: 'invalid_oidc_token' })
      return
    }
    ;(request as any).user = user
  }
}
