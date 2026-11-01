import { describe, it, expect, vi } from 'vitest'
import type { User } from 'discord.js'
import { linkDiscordAccount } from '../link-flow.js'
import type { LinkDeps } from '../link-flow.js'

// ─── Mock factories ───────────────────────────────────────────────────

interface IntegrationRow {
  id: string
  user_id: string
  link_key_expires_at: string
  discord_user_id: string | null
  bot_verified: boolean
}

function makeIntegration(overrides: Partial<IntegrationRow> = {}): IntegrationRow {
  return {
    id: 'int-1',
    user_id: 'cm-user-1',
    link_key_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    discord_user_id: null,
    bot_verified: false,
    ...overrides,
  }
}

/** Chainable query mock: every builder method returns the chain; terminals resolve. */
function mockChain(lookup: { data: unknown; error: unknown }, updateResult: { error: unknown } = { error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const updates: Array<Record<string, unknown>> = []
  let lastWasUpdate = false
  for (const method of ['select', 'eq', 'neq', 'is']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.update = vi.fn((values: Record<string, unknown>) => {
    updates.push(values)
    lastWasUpdate = true
    return chain
  })
  chain.maybeSingle = vi.fn().mockResolvedValue(lookup)
  // Awaiting an update chain resolves to updateResult
  ;(chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => {
    const result = lastWasUpdate ? updateResult : { data: null, error: null }
    lastWasUpdate = false
    return Promise.resolve(result).then(resolve)
  }
  return { chain, updates }
}

function makeDeps(lookup: { data: unknown; error: unknown }, updateResult?: { error: unknown }) {
  const integrations = mockChain(lookup, updateResult)
  const invites = mockChain({ data: null, error: null })
  const from = vi.fn((table: string) => (table === 'discord_integrations' ? integrations.chain : invites.chain))
  const syncGuildsForUser = vi.fn().mockResolvedValue(undefined)
  const deps = {
    supabase: { from } as unknown as LinkDeps['supabase'],
    syncGuildsForUser,
    frontendUrl: 'https://app.example',
  } satisfies LinkDeps
  return { deps, integrations, syncGuildsForUser }
}

function makeUser(id = 'discord-1'): User {
  return {
    id,
    tag: 'tester#0001',
    displayAvatarURL: () => 'https://cdn.example/avatar.png',
  } as unknown as User
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('linkDiscordAccount', () => {
  it('links, expires the key, and starts the guild sync', async () => {
    const { deps, integrations, syncGuildsForUser } = makeDeps({ data: makeIntegration(), error: null })

    const result = await linkDiscordAccount(deps, 'sc-abc', makeUser())

    expect(result.ok).toBe(true)
    expect(result.message).toContain('https://app.example/announcements?tab=discord')
    const linkUpdate = integrations.updates.find(u => u.bot_verified === true)
    expect(linkUpdate).toBeDefined()
    expect(linkUpdate?.discord_user_id).toBe('discord-1')
    expect(linkUpdate?.link_key_expires_at).toBe(linkUpdate?.bot_verified_at)
    expect(syncGuildsForUser).toHaveBeenCalledWith('int-1', 'cm-user-1', 'discord-1')
  })

  it('rejects an unknown key', async () => {
    const { deps, syncGuildsForUser } = makeDeps({ data: null, error: null })
    const result = await linkDiscordAccount(deps, 'sc-missing', makeUser())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Invalid or expired/)
    expect(syncGuildsForUser).not.toHaveBeenCalled()
  })

  it('rejects an expired key', async () => {
    const expired = makeIntegration({ link_key_expires_at: new Date(Date.now() - 1000).toISOString() })
    const { deps, integrations } = makeDeps({ data: expired, error: null })
    const result = await linkDiscordAccount(deps, 'sc-old', makeUser())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/expired/)
    expect(integrations.updates).toHaveLength(0)
  })

  it('rejects a key that was already used by another account', async () => {
    const used = makeIntegration({ bot_verified: true, discord_user_id: 'discord-other' })
    const { deps, integrations } = makeDeps({ data: used, error: null })
    const result = await linkDiscordAccount(deps, 'sc-used', makeUser())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/already used/)
    expect(integrations.updates).toHaveLength(0)
  })

  it('tells the same account it is already linked', async () => {
    const used = makeIntegration({ bot_verified: true, discord_user_id: 'discord-1' })
    const { deps, integrations } = makeDeps({ data: used, error: null })
    const result = await linkDiscordAccount(deps, 'sc-used', makeUser('discord-1'))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/already linked/)
    expect(integrations.updates).toHaveLength(0)
  })

  it('rejects an unverified key claimed by a different Discord user', async () => {
    const claimed = makeIntegration({ discord_user_id: 'discord-other' })
    const { deps } = makeDeps({ data: claimed, error: null })
    const result = await linkDiscordAccount(deps, 'sc-claimed', makeUser())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/another Discord account/)
  })

  it('reports failure and skips the sync when the update fails', async () => {
    const { deps, syncGuildsForUser } = makeDeps({ data: makeIntegration(), error: null }, { error: { message: 'boom' } })
    const result = await linkDiscordAccount(deps, 'sc-abc', makeUser())
    expect(result.ok).toBe(false)
    expect(syncGuildsForUser).not.toHaveBeenCalled()
  })
})
