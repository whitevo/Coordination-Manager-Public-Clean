import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertBanAuthority, hasBanPermission, parseBanGuilds, parseBanIds } from '../guardian-ban-authority.js'

vi.mock('../../supabaseClient.js', () => ({ supabaseAdmin: {} }))

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const BOT = '323456789012345678'
const ROLE = '423456789012345678'
const OTHER = '523456789012345678'

describe('ban registry ID parsing', () => {
  it('accepts mixed separators, deduplicates, and preserves IDs above Number.MAX_SAFE_INTEGER', () => {
    expect(parseBanIds(`${USER} ${BOT},\n${USER},\t18446744073709551615`))
      .toEqual([USER, BOT, '18446744073709551615'])
  })

  it.each(['', 'not-an-id', '123', '18446744073709551616', '00000000000000000', `${USER};${BOT}`, `${USER} bad`, 123, null])(
    'rejects invalid imports atomically: %j', input => { expect(() => parseBanIds(input)).toThrow() },
  )

  it('limits imports and selected servers', () => {
    expect(() => parseBanIds(Array.from({ length: 1001 }, () => USER).join(' '))).toThrow()
    expect(() => parseBanGuilds(Array.from({ length: 21 }, () => GUILD))).toThrow()
    expect(() => parseBanGuilds([])).toThrow()
    expect(() => parseBanGuilds([123])).toThrow()
    expect(parseBanGuilds([GUILD, GUILD])).toEqual([GUILD])
  })
})

describe('Discord ban authority', () => {
  const permissions = { guildId: GUILD, ownerId: OTHER, userId: USER, memberRoles: [ROLE] }
  it('accepts Ban Members, Administrator, and the guild owner', () => {
    for (const bits of ['4', '8']) {
      expect(hasBanPermission({ ...permissions, roles: [{ id: ROLE, permissions: bits }] })).toBe(true)
    }
    expect(hasBanPermission({ ...permissions, userId: OTHER, roles: [] })).toBe(true)
    expect(hasBanPermission({ ...permissions, roles: [{ id: GUILD, permissions: '4' }] })).toBe(true)
  })

  it('rejects permissions granted only to an unrelated role', () => {
    expect(hasBanPermission({ ...permissions, roles: [{ id: OTHER, permissions: '8' }] })).toBe(false)
  })

  const mockFetch = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('GUARDIAN_BOT_TOKEN', 'test-only-token')
    mockFetch.mockReset()
    mockFetch.mockImplementation(async (url: string) => {
      let body: unknown
      if (url.endsWith(`/guilds/${GUILD}`)) body = { id: GUILD, name: 'Test server', owner_id: OTHER }
      else if (url.endsWith('/roles')) body = [{ id: ROLE, permissions: '4' }]
      else body = { roles: [ROLE] }
      return new Response(JSON.stringify(body), { status: 200 })
    })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('checks both the issuer and bot against current server roles', async () => {
    await expect(assertBanAuthority({ guildId: GUILD, discordUserId: USER, botId: BOT }))
      .resolves.toMatchObject({ id: GUILD, name: 'Test server' })
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith(`/members/${USER}`))).toBe(true)
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith(`/members/${BOT}`))).toBe(true)
  })
  it('supports global moderation by checking only the bot Discord permissions', async () => {
    await expect(assertBanAuthority({ guildId: GUILD, botId: BOT })).resolves.toMatchObject({ id: GUILD })
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith(`/members/${USER}`))).toBe(false)
  })

  it('rejects missing user or bot permissions', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: GUILD, name: 'Test', owner_id: OTHER })))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: ROLE, permissions: '0' }])))
    await expect(assertBanAuthority({ guildId: GUILD, discordUserId: USER, botId: BOT })).rejects.toThrow('needs Ban Members')
  })

  it.each([403, 404, 429, 500])('fails closed when Discord responds with %s', async status => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status }))
    await expect(assertBanAuthority({ guildId: GUILD, discordUserId: USER, botId: BOT })).rejects.toThrow()
  })

  it('rejects malformed Discord role responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: GUILD, name: 'Test', owner_id: OTHER })))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: ROLE, permissions: 'invalid' }])))
    await expect(assertBanAuthority({ guildId: GUILD, discordUserId: USER, botId: BOT })).rejects.toThrow('Invalid Discord role')
  })
})
