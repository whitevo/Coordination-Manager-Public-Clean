import type { Client } from 'discord.js'

// Sender-initiated deletion of announcement messages the bot already posted
// (guild channel posts and DMs). Called by the main API through the bot's
// internal POST /delete-messages endpoint after it has verified ownership.

export type DeleteChannelType = 'discord_channel' | 'discord_dm'

export interface DeleteItem {
  /** announcement_delivery_log row id, echoed back so the API can update the row. */
  id: string
  channelType: DeleteChannelType
  /** Channel id for discord_channel, recipient Discord user id for discord_dm. */
  targetId: string
  messageId: string
}

export interface DeleteResult {
  id: string
  ok: boolean
  error?: string
}

export interface DeleteDeps {
  deleteChannelMessage: (channelId: string, messageId: string) => Promise<void>
  deleteDmMessage: (userId: string, messageId: string) => Promise<void>
}

export const MAX_DELETE_ITEMS = 500
export const DELETE_CONCURRENCY = 5

/** Discord API error codes meaning the message (or its channel) no longer exists. */
const ALREADY_GONE_CODES = new Set<number>([10003, 10008])

const SNOWFLAKE_RE = /^\d{15,25}$/
const ID_RE = /^[A-Za-z0-9-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ParseResult =
  | { ok: true; items: DeleteItem[] }
  | { ok: false; error: string }

/** Validate the request body shape: { items: DeleteItem[] } with 1..MAX_DELETE_ITEMS entries. */
export function parseDeleteRequest(body: unknown): ParseResult {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return { ok: false, error: 'items array required' }
  }
  const rawItems: unknown[] = body.items
  if (rawItems.length === 0) return { ok: false, error: 'items must not be empty' }
  if (rawItems.length > MAX_DELETE_ITEMS) {
    return { ok: false, error: `At most ${MAX_DELETE_ITEMS} items per request` }
  }

  const items: DeleteItem[] = []
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]
    if (!isRecord(raw)) return { ok: false, error: `items[${i}] must be an object` }
    const { id, channelType, targetId, messageId } = raw
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      return { ok: false, error: `items[${i}].id is invalid` }
    }
    if (channelType !== 'discord_channel' && channelType !== 'discord_dm') {
      return { ok: false, error: `items[${i}].channelType must be discord_channel or discord_dm` }
    }
    if (typeof targetId !== 'string' || !SNOWFLAKE_RE.test(targetId)) {
      return { ok: false, error: `items[${i}].targetId is invalid` }
    }
    if (typeof messageId !== 'string' || !SNOWFLAKE_RE.test(messageId)) {
      return { ok: false, error: `items[${i}].messageId is invalid` }
    }
    items.push({ id, channelType, targetId, messageId })
  }
  return { ok: true, items }
}

function discordErrorCode(err: unknown): number | undefined {
  if (isRecord(err) && typeof err.code === 'number') return err.code
  return undefined
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
  // Keep stored errors short and single-line
  return text.replace(/[\r\n]+/g, ' ').slice(0, 300)
}

async function deleteOne(deps: DeleteDeps, item: DeleteItem): Promise<DeleteResult> {
  try {
    if (item.channelType === 'discord_channel') {
      await deps.deleteChannelMessage(item.targetId, item.messageId)
    } else {
      await deps.deleteDmMessage(item.targetId, item.messageId)
    }
    return { id: item.id, ok: true }
  } catch (err: unknown) {
    const code = discordErrorCode(err)
    if (code !== undefined && ALREADY_GONE_CODES.has(code)) {
      // Already deleted (by the sender, a moderator, or the channel is gone)
      return { id: item.id, ok: true }
    }
    return { id: item.id, ok: false, error: errorMessage(err) }
  }
}

/**
 * Delete each item with bounded concurrency. discord.js queues requests per
 * rate-limit bucket, so a small worker pool keeps bursts polite without
 * serialising 100+ DMs. Results keep the input order.
 */
export async function deleteMessages(
  deps: DeleteDeps,
  items: DeleteItem[],
  concurrency: number = DELETE_CONCURRENCY,
): Promise<DeleteResult[]> {
  const results: DeleteResult[] = new Array(items.length)
  let next = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await deleteOne(deps, items[index])
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/** Deps bound to a live discord.js client. */
export function createDiscordDeleteDeps(client: Client): DeleteDeps {
  return {
    async deleteChannelMessage(channelId, messageId) {
      const channel = await client.channels.fetch(channelId)
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        throw new Error('Channel not found or not a text channel')
      }
      await channel.messages.delete(messageId)
    },
    async deleteDmMessage(userId, messageId) {
      const user = await client.users.fetch(userId)
      const dm = await user.createDM()
      await dm.messages.delete(messageId)
    },
  }
}
