import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, DiscordAPIError, HTTPError } from 'discord.js'
import { createClient } from '@supabase/supabase-js'
import { BanRegistryWorker, banRetryDelay } from '../ban-registry.js'

const m = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), gt: vi.fn(),
  maybeSingle: vi.fn(), update: vi.fn(), guild: vi.fn(), roles: vi.fn(), member: vi.fn(), bot: vi.fn(),
  ban: vi.fn(), unban: vi.fn(), fetchBan: vi.fn(), permission: vi.fn(), leader: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: m.rpc, from: m.from }) }))
vi.mock('discord.js', async importOriginal => {
  const real = await importOriginal<typeof import('discord.js')>()
  return { ...real, Client: class {
    user = { id: 'bot' }
    guilds = { fetch: m.guild, cache: new Map([['guild', {}]]) }
  } }
})
const entry = {
  id: 'entry', guild_id: 'guild', discord_user_id: 'target', reason: 'Old reason',
  requested_by: 'actor', requested_by_discord_id: 'issuer', attempts: 1, processing_token: 'claim',
  action: 'ban',
}
function worker() {
  return new BanRegistryWorker({
    database: createClient('https://example.test', 'test-key'),
    client: new Client({ intents: [] }), isLeader: m.leader, instanceId: 'instance',
  })
}
function unknownBan() {
  return new DiscordAPIError({ code: 10026, message: 'Unknown Ban' }, 10026, 404, 'GET', 'https://discord.test', {})
}
beforeEach(() => {
  vi.resetAllMocks()
  m.leader.mockReturnValue(true)
  const chain = {
    select: m.select, eq: m.eq, gt: m.gt, maybeSingle: m.maybeSingle, update: m.update,
    then: (resolve: (result: { error: null }) => void) => resolve({ error: null }),
  }
  m.from.mockReturnValue(chain)
  for (const fn of [m.select, m.eq, m.gt, m.update]) fn.mockReturnThis()
  m.rpc.mockImplementation(async (name: string) => ({
    data: name === 'claim_guardian_ban' ? [entry] : name === 'recover_guardian_global_bans' ? [{ last_id: null, account_count: 0 }] : null,
    error: null,
  }))
  m.maybeSingle
    .mockResolvedValueOnce({ data: { roles: ['moderator'] }, error: null })
    .mockResolvedValueOnce({ data: { id: 'link' }, error: null })
    .mockResolvedValueOnce({ data: { instance_id: 'instance' }, error: null })
    .mockResolvedValueOnce({ data: { id: entry.id }, error: null })
    .mockResolvedValue({ data: { is_active: true }, error: null })
  m.permission.mockReturnValue(true)
  m.member.mockResolvedValue({ id: 'target', bannable: true })
  m.bot.mockResolvedValue({ permissions: { has: m.permission } })
  m.guild.mockResolvedValue({
    ownerId: 'owner', roles: { fetch: m.roles }, members: { fetch: m.member, fetchMe: m.bot },
    bans: { create: m.ban, remove: m.unban, fetch: m.fetchBan },
  })
  m.fetchBan.mockRejectedValue(unknownBan())
  m.ban.mockResolvedValue({})
})

describe('Global durable ban worker', () => {
  it('never reconciles or bans as a follower', async () => {
    m.leader.mockReturnValue(false)
    await worker().tick()
    await worker().enqueueJoin('guild', 'target')
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.ban).not.toHaveBeenCalled()
  })
  it('reconciles current servers and counts a confirmed member removal', async () => {
    await worker().tick()
    expect(m.rpc).toHaveBeenCalledWith('recover_guardian_global_bans', { p_guild_ids: ['guild'], p_after: '' })
    expect(m.member).toHaveBeenCalledWith({ user: 'target', force: true })
    expect(m.member).not.toHaveBeenCalledWith(expect.objectContaining({ user: 'issuer' }))
    expect(m.fetchBan).toHaveBeenCalledWith({ user: 'target', force: true, cache: false })
    expect(m.ban).toHaveBeenCalledWith('target', { reason: 'Global Guardian ban registry', deleteMessageSeconds: 0 })
    expect(m.rpc).toHaveBeenCalledWith('report_guardian_registry_write', {
      p_entry: 'entry', p_token: 'claim', p_removed: true, p_action: 'ban', p_wrote: true,
    })
  })
  it('pre-bans absent accounts without incrementing boot counts', async () => {
    m.member.mockRejectedValue(new DiscordAPIError({ code: 10007, message: 'Unknown Member' }, 10007, 404, 'GET', 'https://discord.test', {}))
    await worker().tick()
    expect(m.ban).toHaveBeenCalledTimes(1)
    expect(m.rpc).toHaveBeenCalledWith('report_guardian_registry_write', expect.objectContaining({ p_removed: false }))
  })
  it('does not ban or count an already banned account during recovery', async () => {
    m.fetchBan.mockResolvedValue({})
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.member).not.toHaveBeenCalled()
    expect(m.rpc).toHaveBeenCalledWith('report_guardian_registry_write', expect.objectContaining({ p_removed: false, p_wrote: false }))
  })
  it('does no work when the persistent ban queue is empty', async () => {
    m.rpc.mockImplementation(async name => ({ data: name === 'recover_guardian_global_bans' ? [{ last_id: null, account_count: 0 }] : [], error: null }))
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
  })
  it('queues a matching global account on a member join', async () => {
    await worker().enqueueJoin('guild', 'target')
    expect(m.rpc).toHaveBeenCalledWith('enqueue_guardian_join_ban', { p_guild_id: 'guild', p_discord_id: 'target' })
  })
  it('rejects revoked website moderation access before contacting Discord', async () => {
    m.maybeSingle.mockReset().mockResolvedValueOnce({ data: { roles: ['user'] }, error: null })
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('rejects an unlinked issuer', async () => {
    m.maybeSingle.mockReset().mockResolvedValueOnce({ data: { roles: ['moderator'] }, error: null }).mockResolvedValueOnce({ data: null, error: null })
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('rejects missing bot permission and unbannable members', async () => {
    m.permission.mockReturnValue(false)
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('respects Discord role hierarchy', async () => {
    m.member.mockResolvedValue({ bannable: false })
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', last_error: expect.stringContaining('hierarchy') }))
  })
  it.each(['owner', 'bot', 'issuer'])('protects account %s', async id => {
    const original = m.rpc.getMockImplementation()
    m.rpc.mockImplementation(async name => name === 'claim_guardian_ban' ? { data: [{ ...entry, discord_user_id: id }], error: null } : original?.(name))
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
  })
  it('does not act after losing the persistent lease', async () => {
    m.maybeSingle.mockReset()
      .mockResolvedValueOnce({ data: { roles: ['moderator'] }, error: null })
      .mockResolvedValueOnce({ data: { id: 'link' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.update).not.toHaveBeenCalled()
  })
  it('does not act after the claim is replaced or disabled', async () => {
    m.maybeSingle.mockReset()
      .mockResolvedValueOnce({ data: { roles: ['moderator'] }, error: null })
      .mockResolvedValueOnce({ data: { id: 'link' }, error: null })
      .mockResolvedValueOnce({ data: { instance_id: 'instance' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
  })
  it.each([429, 500])('retries Discord HTTP %s with bounded backoff', async status => {
    m.ban.mockRejectedValue(new HTTPError(status, 'Transient', 'PUT', 'https://discord.test', {}))
    await worker().tick()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
    expect(banRetryDelay(1)).toBe(60_000)
    expect(banRetryDelay(10)).toBe(15 * 60_000)
  })
  it('does not treat a forbidden membership lookup as an absent member', async () => {
    m.member.mockRejectedValue(new DiscordAPIError({ code: 50013, message: 'Missing Permissions' }, 50013, 403, 'GET', 'https://discord.test', {}))
    await worker().tick()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('stops retrying after five failed attempts', async () => {
    const original = m.rpc.getMockImplementation()
    m.rpc.mockImplementation(async name => name === 'claim_guardian_ban' ? { data: [{ ...entry, attempts: 5 }], error: null } : original?.(name))
    m.ban.mockRejectedValue(new Error('ECONNRESET'))
    await worker().tick()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('retries only receipt writes when persistence fails after a successful removal', async () => {
    const original = m.rpc.getMockImplementation()
    let receipts = 0
    m.rpc.mockImplementation(async name => name === 'report_guardian_registry_write' && ++receipts < 3
      ? { data: null, error: { message: 'temporary database failure' } } : original?.(name))
    await worker().tick()
    expect(m.ban).toHaveBeenCalledTimes(1)
    expect(m.rpc.mock.calls.filter(([name]) => name === 'report_guardian_registry_write')).toHaveLength(3)
    expect(m.update).not.toHaveBeenCalled()
  })
  it('leaves the claim recoverable if all receipt writes fail', async () => {
    const original = m.rpc.getMockImplementation()
    m.rpc.mockImplementation(async name => name === 'report_guardian_registry_write'
      ? { data: null, error: { message: 'database unavailable' } } : original?.(name))
    await expect(worker().tick()).rejects.toThrow('persist confirmed ban')
    expect(m.ban).toHaveBeenCalledTimes(1)
    expect(m.update).not.toHaveBeenCalled()
  })
  it('does not perform recurring recovery sweeps after finishing the event batch', async () => {
    const original = m.rpc.getMockImplementation()
    m.rpc.mockImplementation(async name => name === 'claim_guardian_ban' ? { data: [], error: null } : original?.(name))
    const instance = worker()
    await instance.tick()
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(10 * 60_000)
      await instance.tick()
      await instance.tick()
      expect(m.rpc.mock.calls.filter(([name]) => name === 'recover_guardian_global_bans')).toHaveLength(1)
      instance.requestRecovery()
      await instance.tick()
      expect(m.rpc.mock.calls.filter(([name]) => name === 'recover_guardian_global_bans')).toHaveLength(2)
      m.leader.mockReturnValue(false)
      await instance.tick()
      m.leader.mockReturnValue(true)
      await instance.tick()
      expect(m.rpc.mock.calls.filter(([name]) => name === 'recover_guardian_global_bans')).toHaveLength(3)
    } finally { vi.useRealTimers() }
  })
  function configureUnban() {
    const original = m.rpc.getMockImplementation()
    m.rpc.mockImplementation(async name => name === 'claim_guardian_ban' ? { data: [{ ...entry, action: 'unban' }], error: null } : original?.(name))
    m.maybeSingle.mockReset()
      .mockResolvedValueOnce({ data: { roles: ['moderator'] }, error: null })
      .mockResolvedValueOnce({ data: { id: 'link' }, error: null })
      .mockResolvedValueOnce({ data: { instance_id: 'instance' }, error: null })
      .mockResolvedValueOnce({ data: { id: entry.id }, error: null })
      .mockResolvedValue({ data: { is_active: false }, error: null })
  }
  it('executes confirmed registry removals as Discord unbans without counting boots', async () => {
    configureUnban()
    m.fetchBan.mockResolvedValue({})
    await worker().tick()
    expect(m.unban).toHaveBeenCalledWith('target', 'Removed from global Guardian ban registry')
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.member).not.toHaveBeenCalled()
    expect(m.rpc).toHaveBeenCalledWith('report_guardian_registry_write', expect.objectContaining({ p_removed: false, p_action: 'unban', p_wrote: true }))
  })
  it('treats an already unbanned account as successful without a Discord write', async () => {
    configureUnban()
    await worker().tick()
    expect(m.unban).not.toHaveBeenCalled()
    expect(m.ban).not.toHaveBeenCalled()
    expect(m.rpc).toHaveBeenCalledWith('report_guardian_registry_write', expect.objectContaining({ p_removed: false, p_action: 'unban', p_wrote: false }))
  })
  it('reports missing permissions for unbans', async () => {
    configureUnban()
    m.permission.mockReturnValue(false)
    await worker().tick()
    expect(m.unban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
  it('does not unban an ID re-added after removal', async () => {
    configureUnban()
    m.fetchBan.mockResolvedValue({})
    m.maybeSingle.mockResolvedValue({ data: { is_active: true }, error: null })
    await worker().tick()
    expect(m.unban).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ is_enabled: false, status: 'registered' }))
  })
})
