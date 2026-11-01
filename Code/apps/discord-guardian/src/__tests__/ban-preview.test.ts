import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, DiscordAPIError } from 'discord.js'
import { createClient } from '@supabase/supabase-js'
import { BanPreviewWorker } from '../ban-preview.js'

const m = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), guild: vi.fn(),
  roles: vi.fn(), bot: vi.fn(), permission: vi.fn(), member: vi.fn(), leader: vi.fn(),
  select: vi.fn(), maybeSingle: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: m.rpc, from: m.from }) }))
vi.mock('discord.js', async importOriginal => ({
  ...await importOriginal<typeof import('discord.js')>(),
  Client: class { user = { id: 'bot' }; guilds = { fetch: m.guild, cache: new Map([['guild', {}]]) } },
}))
const job = () => ({
  id: 'preview', discord_ids: ['target'], guild_ids: ['guild'], cursor: 0,
  member_counts: {}, actor_discord_id: 'issuer', processing_token: 'claim',
  confirmation_requested: false, created_by: 'actor',
})
function worker() {
  return new BanPreviewWorker({
    database: createClient('https://example.test', 'test'), client: new Client({ intents: [] }),
    isLeader: m.leader, instanceId: 'instance',
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  const chain = { update: m.update, eq: m.eq, select: m.select, maybeSingle: m.maybeSingle,
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }) }
  m.from.mockReturnValue(chain)
  m.update.mockReturnThis()
  m.eq.mockReturnThis()
  m.select.mockReturnThis()
  m.maybeSingle.mockResolvedValueOnce({ data: { roles: ['moderator'] }, error: null }).mockResolvedValueOnce({ data: { id: 'link' }, error: null })
  m.rpc.mockResolvedValue({ data: [job()], error: null })
  m.leader.mockReturnValue(true)
  m.permission.mockReturnValue(true)
  m.bot.mockResolvedValue({ permissions: { has: m.permission } })
  m.member.mockResolvedValue({ id: 'target' })
  m.guild.mockResolvedValue({
    ownerId: 'owner', roles: { fetch: m.roles }, members: { fetchMe: m.bot, fetch: m.member },
  })
})
describe('Persistent membership preview', () => {
  it('counts membership without writing registry entries or executing bans', async () => {
    await worker().tick()
    expect(m.rpc).toHaveBeenCalledWith('claim_guardian_ban_preview', { p_instance_id: 'instance' })
    expect(m.from).toHaveBeenCalledTimes(1)
    expect(m.from).toHaveBeenCalledWith('guardian_ban_previews')
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1, member_counts: { target: 1 }, status: 'ready' }))
    expect(m.eq).toHaveBeenCalledWith('processing_token', 'claim')
  })
  it('counts only Unknown Member responses as absent', async () => {
    m.member.mockRejectedValue(new DiscordAPIError({ code: 10007, message: 'Unknown Member' }, 10007, 404, 'GET', 'https://discord.test', {}))
    await worker().tick()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', member_counts: { target: 0 } }))
  })
  it('surfaces permission failures without producing a zero count', async () => {
    m.member.mockRejectedValue(new DiscordAPIError({ code: 50013, message: 'Missing Permissions' }, 50013, 403, 'GET', 'https://discord.test', {}))
    await worker().tick()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ cursor: 0, status: 'failed', last_error: expect.any(String) }))
  })
  it('retries transient failures from the last persisted cursor', async () => {
    m.member.mockRejectedValue(new Error('ECONNRESET'))
    await worker().tick()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ cursor: 0, status: 'pending' }))
  })
  it('processes at most ten pairs per chunk and resumes accumulated counts', async () => {
    m.rpc.mockResolvedValue({ data: [{ ...job(), guild_ids: Array.from({ length: 12 }, (_, i) => `guild${i}`), cursor: 1, member_counts: { target: 1 } }], error: null })
    await worker().tick()
    expect(m.member).toHaveBeenCalledTimes(10)
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ cursor: 11, status: 'pending', member_counts: { target: 11 } }))
  })
  it.each(['owner', 'bot', 'issuer'])('fails preview for protected account %s', async id => {
    m.rpc.mockResolvedValue({ data: [{ ...job(), discord_ids: [id] }], error: null })
    await worker().tick()
    expect(m.member).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('does not process without a leader lease', async () => {
    m.leader.mockReturnValue(false)
    await worker().tick()
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('fails preview when the bot cannot ban in a server', async () => {
    m.permission.mockReturnValue(false)
    await worker().tick()
    expect(m.member).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', last_error: expect.stringContaining('Ban Members') }))
  })
  it('revalidates all server permissions and issuer access before atomically confirming', async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ ...job(), confirmation_requested: true, member_counts: { target: 1 } }], error: null })
    await worker().tick()
    expect(m.member).not.toHaveBeenCalled()
    expect(m.rpc).toHaveBeenCalledWith('confirm_guardian_global_bans', { p_preview: 'preview', p_actor: 'actor', p_token: 'claim' })
    expect(m.update).not.toHaveBeenCalled()
  })
  it('does not add IDs if bot permission is revoked before confirmation', async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ ...job(), confirmation_requested: true }], error: null })
    m.permission.mockReturnValue(false)
    await worker().tick()
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('rejects a changed server set at confirmation', async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ ...job(), confirmation_requested: true, guild_ids: ['changed'] }], error: null })
    await worker().tick()
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', last_error: expect.stringContaining('servers changed') }))
  })
  it('rejects revoked website permission at confirmation', async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ ...job(), confirmation_requested: true }], error: null })
    m.maybeSingle.mockReset().mockResolvedValue({ data: { roles: ['user'] }, error: null })
    await worker().tick()
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('resumes confirmation after a transient issuer database failure', async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ ...job(), confirmation_requested: true }], error: null })
    m.maybeSingle.mockReset().mockResolvedValue({ data: null, error: { message: 'database restarting' } })
    await worker().tick()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirming', cursor: 0, last_error: expect.any(String) }))
  })
})
