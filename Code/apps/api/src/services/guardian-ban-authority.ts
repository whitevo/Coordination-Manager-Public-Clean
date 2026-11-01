import { supabaseAdmin } from '../supabaseClient.js'
import { ApplicationError, ValidationError } from '../middleware/error-handler.js'

const BAN_MEMBERS = 4n
const ADMINISTRATOR = 8n
const MAX_SNOWFLAKE = 18446744073709551615n
export const MAX_BAN_IMPORT = 1000
export class BanPermissionError extends ApplicationError {
  constructor(message: string) {
    super(message, 403, 'GUARDIAN_BAN_FORBIDDEN')
  }
}

export function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= MAX_SNOWFLAKE
}

export function parseBanIds(input: unknown): string[] {
  if (typeof input !== 'string' || input.length > 25_000) {
    throw new ValidationError('Paste up to 1000 Discord IDs separated by spaces, commas, or newlines')
  }
  const tokens = input.split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > MAX_BAN_IMPORT) {
    throw new ValidationError('Provide between 1 and 1000 Discord IDs per import')
  }
  if (tokens.some(token => !isDiscordId(token))) {
    throw new ValidationError('Every Discord ID must be a 17-20 digit unsigned snowflake; no accounts were registered')
  }
  return [...new Set(tokens)]
}

export function parseBanGuilds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20 || !input.every(isDiscordId)) {
    throw new ValidationError('Select between 1 and 20 valid Discord servers')
  }
  return [...new Set(input)]
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface DiscordRole { id: string; permissions: string }
interface DiscordMember { roles: string[] }
export interface BanGuild { id: string; name: string; owner_id: string }

export function hasBanPermission(options: {
  guildId: string
  ownerId: string
  userId: string
  memberRoles: string[]
  roles: DiscordRole[]
}): boolean {
  if (options.userId === options.ownerId) return true
  let permissions = 0n
  for (const role of options.roles) {
    if (role.id === options.guildId || options.memberRoles.includes(role.id)) {
      permissions |= BigInt(role.permissions)
    }
  }
  return (permissions & (BAN_MEMBERS | ADMINISTRATOR)) !== 0n
}

async function discordGet(path: string): Promise<unknown> {
  const token = process.env.GUARDIAN_BOT_TOKEN
  if (!token) throw new ApplicationError('Guardian bot is not configured', 503, 'GUARDIAN_NOT_CONFIGURED')
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 403 || response.status === 404) {
    throw new BanPermissionError('Discord membership or permission could not be verified')
  }
  if (!response.ok) {
    throw new ApplicationError(
      response.status === 429 ? 'Discord is rate limiting permission checks; retry later' : 'Discord permission check failed',
      502,
      'DISCORD_PERMISSION_CHECK_FAILED',
    )
  }
  return response.json()
}

function parseRoles(value: unknown): DiscordRole[] {
  if (!Array.isArray(value) || !value.every(role =>
    object(role) && isDiscordId(role.id) && typeof role.permissions === 'string' && /^\d+$/.test(role.permissions))) {
    throw new ApplicationError('Invalid Discord role response', 502, 'DISCORD_RESPONSE_INVALID')
  }
  return value.map(role => ({ id: String(role.id), permissions: String(role.permissions) }))
}

function parseMember(value: unknown): DiscordMember {
  if (!object(value) || !Array.isArray(value.roles) || !value.roles.every(isDiscordId)) {
    throw new ApplicationError('Invalid Discord member response', 502, 'DISCORD_RESPONSE_INVALID')
  }
  return { roles: value.roles }
}

export async function linkedDiscordUser(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.from('discord_integrations')
    .select('discord_user_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('bot_verified', true)
    .maybeSingle()
  if (error) throw new ApplicationError('Failed to verify Discord link', 503, 'DISCORD_LINK_LOOKUP_FAILED')
  if (!isDiscordId(data?.discord_user_id)) throw new BanPermissionError('Link and verify your Discord account before managing bans')
  return data.discord_user_id
}

export async function guardianBotId(): Promise<string> {
  const bot = await discordGet('/users/@me')
  if (!object(bot) || !isDiscordId(bot.id)) {
    throw new ApplicationError('Invalid Guardian bot response', 502, 'DISCORD_RESPONSE_INVALID')
  }
  return bot.id
}

export async function assertBanAuthority(options: {
  guildId: string
  discordUserId?: string
  botId: string
}): Promise<BanGuild> {
  const guild = await discordGet(`/guilds/${options.guildId}`)
  if (!object(guild) || !isDiscordId(guild.id) || !isDiscordId(guild.owner_id) || typeof guild.name !== 'string') {
    throw new ApplicationError('Invalid Discord server response', 502, 'DISCORD_RESPONSE_INVALID')
  }
  const roles = parseRoles(await discordGet(`/guilds/${options.guildId}/roles`))
  const botMember = parseMember(await discordGet(`/guilds/${options.guildId}/members/${options.botId}`))
  const permissions = { guildId: options.guildId, ownerId: guild.owner_id, roles }
  if (options.discordUserId) {
    const member = parseMember(await discordGet(`/guilds/${options.guildId}/members/${options.discordUserId}`))
    if (!hasBanPermission({ ...permissions, userId: options.discordUserId, memberRoles: member.roles })) {
      throw new BanPermissionError('Your linked Discord account needs Ban Members or Administrator permission on every selected server')
    }
  }
  if (!hasBanPermission({ ...permissions, userId: options.botId, memberRoles: botMember.roles })) {
    throw new BanPermissionError('Demon X needs Ban Members permission on every server')
  }
  return { id: guild.id, name: guild.name, owner_id: guild.owner_id }
}

export async function guardianGuilds(): Promise<Array<{ id: string; name: string }>> {
  const guilds: Array<{ id: string; name: string }> = []
  let after = ''
  for (;;) {
    const response = await discordGet(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`)
    if (!Array.isArray(response) || !response.every(guild =>
      object(guild) && isDiscordId(guild.id) && typeof guild.name === 'string')) {
      throw new ApplicationError('Invalid Discord server list', 502, 'DISCORD_RESPONSE_INVALID')
    }
    guilds.push(...response.map(guild => ({ id: String(guild.id), name: String(guild.name) })))
    if (response.length < 200) return guilds
    const nextAfter = String(response[response.length - 1].id)
    if (nextAfter === after) throw new ApplicationError('Discord server pagination stalled', 502, 'DISCORD_RESPONSE_INVALID')
    after = nextAfter
  }
}
