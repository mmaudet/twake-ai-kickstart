import type { FastifyInstance } from 'fastify'
import type { Tenant } from '@prisma/client'
import type { OidcUser } from '../middleware/auth.js'
import type { UmbrellaService } from '../services/umbrella-service.js'
import type { PrismaClient } from '@prisma/client'

export async function umbrellaRoutes(app: FastifyInstance) {
  const umbrellaService = (app as any).umbrellaService as UmbrellaService
  const prisma = (app as any).prisma as PrismaClient

  // POST /umbrella-token — Create umbrella token
  app.post('/umbrella-token', async (request, reply) => {
    const user = (request as any).user as OidcUser
    const tenant = (request as any).tenant as Tenant
    const { user: targetUser, scopes } = request.body as { user: string; scopes: string[] }

    const result = await umbrellaService.createUmbrellaToken(targetUser ?? user.email, scopes, tenant.id)

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: targetUser ?? user.email,
        action: 'umbrella_created',
        details: { scopes },
        ip: request.ip,
      },
    })

    return {
      umbrella_token: result.umbrellaToken,
      expires_at: result.expiresAt.toISOString(),
      scopes: result.scopes,
    }
  })

  // POST /umbrella-token/introspect — Introspect umbrella token
  app.post('/umbrella-token/introspect', async (request, reply) => {
    const { umbrella_token } = request.body as { umbrella_token: string }

    const result = await umbrellaService.introspect(umbrella_token)

    if (!result) {
      return reply.code(401).send({ error: 'invalid_umbrella_token' })
    }

    return {
      active: result.active,
      user: result.userId,
      scopes: result.scopes,
      issued_at: result.issuedAt.toISOString(),
      expires_at: result.expiresAt.toISOString(),
    }
  })

  // DELETE /umbrella-token/:token — Revoke umbrella token
  app.delete('/umbrella-token/:token', async (request, reply) => {
    const user = (request as any).user as OidcUser
    const tenant = (request as any).tenant as Tenant
    const { token } = request.params as { token: string }

    try {
      await umbrellaService.revokeUmbrellaToken(token)

      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.email,
          action: 'umbrella_revoked',
          ip: request.ip,
        },
      })

      reply.code(204).send()
    } catch {
      reply.code(404).send({ error: 'invalid_umbrella_token' })
    }
  })
}
