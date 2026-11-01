import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { AuthenticatedRequest } from '../../middleware/auth.js'
import { errorHandler } from '../../middleware/error-handler.js'
import { BanPermissionError } from '../../services/guardian-ban-authority.js'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), authority: vi.fn(), linked: vi.fn(), bot: vi.fn(), guilds: vi.fn(),
  insert: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), maybeSingle: vi.fn(),
  single: vi.fn(), in: vi.fn(), limit: vi.fn(),
  update: vi.fn(),
}))
vi.mock('../../supabaseClient.js', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('../../middleware/auth.js', () => ({
  hasRole: (req: AuthenticatedRequest, role: string) => req.userRoles?.includes(role) ?? false,
}))
vi.mock('../../services/guardian-ban-authority.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../services/guardian-ban-authority.js')>()
  return { ...original, assertBanAuthority: mocks.authority, linkedDiscordUser: mocks.linked, guardianBotId: mocks.bot, guardianGuilds: mocks.guilds }
})
import router from '../guardian-bans.js'
const ACTOR = '550e8400-e29b-41d4-a716-446655440000'
const PREVIEW = '550e8400-e29b-41d4-a716-446655440001'
const GUILD = '123456789012345678'
const USER = '223456789012345678'
const BOT = '323456789012345678'
const TARGET = '423456789012345678'
const OWNER = '523456789012345678'
const SECOND = '623456789012345678'
const payload = { preview_id: PREVIEW, confirmed: true }
const ready = () => ({
  id: PREVIEW, status: 'ready', created_by: ACTOR, actor_discord_id: USER,
  discord_ids: [TARGET], guild_ids: [GUILD], cursor: 1, member_counts: { [TARGET]: 1 },
  expires_at: new Date(Date.now() + 60_000).toISOString(), confirmation_requested: false,
})

function app(roles = ['moderator']) {
  const server = express()
  server.use(express.json())
  server.use((req: AuthenticatedRequest, _res, next) => { req.userId = ACTOR; req.userRoles = roles; next() })
  server.use('/ban-list', router)
  server.use(errorHandler)
  return server
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.linked.mockResolvedValue(USER)
  mocks.bot.mockResolvedValue(BOT)
  mocks.authority.mockResolvedValue({ id: GUILD, name: 'Server', owner_id: OWNER })
  mocks.rpc.mockResolvedValue({ data: 1, error: null })
  mocks.guilds.mockResolvedValue([{ id: GUILD, name: 'Server' }])
  const chain = {
    select: mocks.select, eq: mocks.eq, order: mocks.order, range: mocks.range, in: mocks.in,
    maybeSingle: mocks.maybeSingle, insert: mocks.insert, single: mocks.single, limit: mocks.limit, update: mocks.update,
    then: (resolve: (result: { error: null }) => void) => resolve({ error: null }),
  }
  mocks.from.mockReturnValue(chain)
  for (const fn of [mocks.select, mocks.eq, mocks.order, mocks.insert, mocks.update]) fn.mockReturnThis()
  mocks.range.mockResolvedValue({ data: [], count: 0, error: null })
  mocks.limit.mockResolvedValue({ data: [], error: null })
  mocks.in.mockResolvedValue({ data: [], error: null })
  mocks.single.mockResolvedValue({ data: { id: PREVIEW }, error: null })
  mocks.maybeSingle.mockResolvedValue({ data: ready(), error: null })
})

describe('Global Guardian ban workflow', () => {
  it('requires website moderator permissions for all surfaces', async () => {
    for (const path of ['/entries', `/preview/${PREVIEW}`]) expect((await request(app(['user'])).get(`/ban-list${path}`)).status).toBe(403)
    expect((await request(app(['user'])).post('/ban-list/preview').send({ discord_ids: TARGET })).status).toBe(403)
    expect((await request(app(['user'])).post('/ban-list/confirm').send(payload)).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    for (const path of ['/remove', '/matching-ids', '/search']) {
      expect((await request(app(['user'])).post(`/ban-list${path}`).send({ discord_ids: TARGET, confirmed: true })).status).toBe(403)
    }
  })
  it('creates a deduplicated persistent review across every connected server, without banning', async () => {
    mocks.guilds.mockResolvedValue([{ id: SECOND }, { id: GUILD }])
    const response = await request(app()).post('/ban-list/preview').send({
      discord_ids: `${TARGET}, ${TARGET}`, guild_ids: ['spoof'], created_by: 'spoof',
    })
    expect(response.status).toBe(202)
    expect(response.body.preview_id).toBe(PREVIEW)
    expect(mocks.insert).toHaveBeenCalledWith({
      created_by: ACTOR, actor_discord_id: USER, discord_ids: [TARGET], guild_ids: [GUILD, SECOND],
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.authority).not.toHaveBeenCalled()
  })
  it('requires a verified link for submission', async () => {
    mocks.linked.mockRejectedValue(new BanPermissionError('Link Discord first'))
    expect((await request(app()).post('/ban-list/preview').send({ discord_ids: TARGET })).status).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it.each([BOT, USER, 'invalid'])('rejects protected or malformed input %s', async id => {
    expect((await request(app()).post('/ban-list/preview').send({ discord_ids: id })).status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('rejects submission when no bot servers exist', async () => {
    mocks.guilds.mockResolvedValue([])
    expect((await request(app()).post('/ban-list/preview').send({ discord_ids: TARGET })).status).toBe(400)
  })
  it('does not report a failed preview insert as success', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: 'migration missing' } })
    expect((await request(app()).post('/ban-list/preview').send({ discord_ids: TARGET })).status).toBe(503)
  })
  it('returns completed membership counts and current registry matches', async () => {
    mocks.in.mockResolvedValue({ data: [{ discord_user_id: TARGET }], error: null })
    const response = await request(app()).get(`/ban-list/preview/${PREVIEW}`)
    expect(response.body.rows).toEqual([{ discord_user_id: TARGET, member_servers: 1, already_registered: true }])
    expect(mocks.eq).toHaveBeenCalledWith('created_by', ACTOR)
  })
  it.each(['processing', 'failed'])('never presents incomplete %s lookups as zero', async status => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...ready(), status, member_counts: {} }, error: null })
    expect((await request(app()).get(`/ban-list/preview/${PREVIEW}`)).body.rows[0].member_servers).toBeNull()
  })
  it('denies access to previews not owned by the requester', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await request(app()).post('/ban-list/confirm').send(payload)).status).toBe(404)
    expect(mocks.eq).toHaveBeenCalledWith('created_by', ACTOR)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires explicit confirmation of a server-owned preview', async () => {
    for (const body of [{ ...payload, confirmed: false }, { ...payload, preview_id: 'invalid' }]) {
      expect((await request(app()).post('/ban-list/confirm').send(body)).status).toBe(400)
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('confirms without requiring the issuer to be a Discord member or provide a reason', async () => {
    const response = await request(app()).post('/ban-list/confirm').send(payload)
    expect(response.status).toBe(202)
    expect(response.body.queued).toBe(true)
    expect(mocks.authority).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith({ status: 'confirming', confirmation_requested: true, cursor: 0, last_error: null })
    expect(mocks.eq).toHaveBeenCalledWith('status', 'ready')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    { status: 'processing' }, { status: 'failed' }, { expires_at: '2020-01-01T00:00:00Z' },
  ])('blocks unfinished or expired previews: %j', async changes => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...ready(), ...changes }, error: null })
    expect((await request(app()).post('/ban-list/confirm').send(payload)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('blocks a changed Discord link', async () => {
    mocks.linked.mockResolvedValue(SECOND)
    expect((await request(app()).post('/ban-list/confirm').send(payload)).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires another preview if the set of servers changed', async () => {
    mocks.guilds.mockResolvedValue([{ id: GUILD }, { id: SECOND }])
    expect((await request(app()).post('/ban-list/confirm').send(payload)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('is idempotent after confirmation even if the response was lost', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...ready(), status: 'confirmed' }, error: null })
    expect((await request(app()).post('/ban-list/confirm').send(payload)).body.added).toBe(0)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('surfaces a registry write failure', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: ready(), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })
    expect((await request(app()).post('/ban-list/confirm').send(payload)).status).toBe(503)
  })
  it('reports a conflict rather than success when a preview changed during confirmation', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: ready(), error: null }).mockResolvedValueOnce({ data: null, error: null })
    expect((await request(app()).post('/ban-list/confirm').send(payload)).status).toBe(409)
  })
  it('returns global accounts with no server filter and exposes operational failures separately', async () => {
    mocks.range.mockResolvedValue({ data: [{ discord_user_id: TARGET, boot_count: 2, created_at: '2026-01-01' }], count: 1, error: null })
    mocks.limit.mockResolvedValue({ data: [{ guild_id: GUILD, discord_user_id: TARGET, last_error: 'Hierarchy' }], error: null })
    const response = await request(app()).get('/ban-list/entries?offset=100')
    expect(response.status).toBe(200)
    expect(response.body.entries[0].boot_count).toBe(2)
    expect(response.body.failures[0].last_error).toBe('Hierarchy')
    expect(mocks.range).toHaveBeenCalledWith(100, 199)
    expect(mocks.eq).not.toHaveBeenCalledWith('guild_id', expect.anything())
  })
  it('rejects invalid pagination and unavailable registry reads', async () => {
    expect((await request(app()).get('/ban-list/entries?offset=-1')).status).toBe(400)
    mocks.range.mockResolvedValue({ data: null, error: {} })
    expect((await request(app()).get('/ban-list/entries')).status).toBe(503)
  })
  it('removes old server-specific mutation surfaces', async () => {
    expect((await request(app()).post('/ban-list/import').send({})).status).toBe(404)
    expect((await request(app()).delete(`/ban-list/entries/${ACTOR}`)).status).toBe(404)
  })
  it('returns exact filtered IDs with server-side pagination without changing the registry', async () => {
    mocks.in.mockReturnThis()
    const response = await request(app()).post('/ban-list/search').send({ discord_ids: `${TARGET}, ${SECOND}`, offset: '100' })
    expect(response.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('is_active', true)
    expect(mocks.in).toHaveBeenCalledWith('discord_user_id', [TARGET, SECOND])
    expect(mocks.range).toHaveBeenCalledWith(100, 199)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('selects matching active accounts across pagination', async () => {
    mocks.in.mockResolvedValue({ data: [{ discord_user_id: TARGET }], error: null })
    const response = await request(app()).post('/ban-list/matching-ids').send({ discord_ids: `${TARGET} ${SECOND}` })
    expect(response.body.ids).toEqual([TARGET])
    expect(mocks.eq).toHaveBeenCalledWith('is_active', true)
    expect(mocks.range).not.toHaveBeenCalled()
  })
  it('removes deduplicated IDs and queues global unbans with verified provenance', async () => {
    mocks.guilds.mockResolvedValue([{ id: GUILD }, { id: SECOND }])
    const response = await request(app()).post('/ban-list/remove').send({
      discord_ids: `${TARGET}, ${TARGET}`, confirmed: true, p_actor: 'spoof', guild_ids: [],
    })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ removed: 1, unbans_queued: true })
    expect(mocks.rpc).toHaveBeenCalledWith('remove_guardian_global_bans', {
      p_discord_ids: [TARGET], p_guild_ids: [GUILD, SECOND], p_actor: ACTOR, p_actor_discord: USER,
    })
  })
  it('requires confirmation, validated IDs, and a verified link to remove', async () => {
    expect((await request(app()).post('/ban-list/remove').send({ discord_ids: TARGET })).status).toBe(400)
    expect((await request(app()).post('/ban-list/remove').send({ discord_ids: 'bad', confirmed: true })).status).toBe(400)
    mocks.linked.mockRejectedValue(new BanPermissionError('Link Discord first'))
    expect((await request(app()).post('/ban-list/remove').send({ discord_ids: TARGET, confirmed: true })).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('reports a removal database failure and does not imply unban success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database down' } })
    const response = await request(app()).post('/ban-list/remove').send({ discord_ids: TARGET, confirmed: true })
    expect(response.status).toBe(503)
    expect(response.body.unbans_queued).toBeUndefined()
  })
})
