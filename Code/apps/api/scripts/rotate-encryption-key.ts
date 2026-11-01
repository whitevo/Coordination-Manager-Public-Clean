import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { reencryptCredential } from '../src/services/credential-encryption-rotation.js'
import { getSupabaseSecretKeyName, getSupabaseServerKey } from '../src/services/supabase-key.js'

dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
})

const PAGE_SIZE = 100
const mode = process.argv[2] ?? '--dry-run'
if (mode !== '--dry-run' && mode !== '--apply') {
  throw new Error('Usage: tsx scripts/rotate-encryption-key.ts [--dry-run|--apply]')
}

const oldKey = process.env.ROTATION_OLD_KEY
const newKey = process.env.ROTATION_NEW_KEY
if (!oldKey || !newKey) {
  throw new Error('Set ROTATION_OLD_KEY and ROTATION_NEW_KEY through a secure local environment')
}
if (!/^[0-9a-fA-F]{64}$/.test(oldKey) || !/^[0-9a-fA-F]{64}$/.test(newKey)) {
  throw new Error('Both rotation keys must be exactly 64 hexadecimal characters')
}
if (oldKey.toLowerCase() === newKey.toLowerCase()) {
  throw new Error('Old and new encryption keys must be different')
}
const mailboxKeyMode = process.env.ROTATION_MAILBOX_KEY_MODE
if (mailboxKeyMode !== 'shared' && mailboxKeyMode !== 'separate') {
  throw new Error('Set ROTATION_MAILBOX_KEY_MODE to shared or separate after checking Railway and local configuration')
}
const mailboxOldKey = mailboxKeyMode === 'shared' ? oldKey : process.env.MAILBOX_ROTATION_OLD_KEY
const mailboxNewKey = mailboxKeyMode === 'shared' ? newKey : process.env.MAILBOX_ROTATION_NEW_KEY
if (!mailboxOldKey || !mailboxNewKey) {
  throw new Error('Separate mailbox encryption requires MAILBOX_ROTATION_OLD_KEY and MAILBOX_ROTATION_NEW_KEY')
}
if (!/^[0-9a-fA-F]{64}$/.test(mailboxOldKey) || !/^[0-9a-fA-F]{64}$/.test(mailboxNewKey)) {
  throw new Error('Mailbox rotation keys must be exactly 64 hexadecimal characters')
}
if (mailboxOldKey.toLowerCase() === mailboxNewKey.toLowerCase()) {
  throw new Error('Old and new mailbox encryption keys must be different')
}
if (mailboxKeyMode === 'separate' && mailboxNewKey.toLowerCase() === newKey.toLowerCase()) {
  throw new Error('Use distinct new keys for SMTP and separate mailbox encryption')
}
if (mode === '--apply' && process.env.ROTATION_CONFIRM_WRITES_PAUSED !== 'YES') {
  throw new Error('Set ROTATION_CONFIRM_WRITES_PAUSED=YES after stopping all API instances')
}

const supabaseUrl = process.env.SUPABASE_URL
const { name: serverKeyName, value: serverKey } = getSupabaseServerKey()
if (!supabaseUrl || !serverKey || !isPrivilegedServerKey(serverKey)) {
  throw new Error(`Set SUPABASE_URL and a privileged server key in ${getSupabaseSecretKeyName()}`)
}

const targetHost = new URL(supabaseUrl).host
const client = createClient(supabaseUrl, serverKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface CredentialTable {
  name: 'user_smtp_configs' | 'mail_credentials'
  encryptedColumn: 'smtp_password_encrypted' | 'encrypted_payload'
  oldKey: string
  newKey: string
}

interface CredentialRow {
  id: string
  encryptedValue: string
}

const tables: CredentialTable[] = [
  {
    name: 'user_smtp_configs',
    encryptedColumn: 'smtp_password_encrypted',
    oldKey,
    newKey,
  },
  {
    name: 'mail_credentials',
    encryptedColumn: 'encrypted_payload',
    oldKey: mailboxOldKey,
    newKey: mailboxNewKey,
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrivilegedServerKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true

  const encodedPayload = key.split('.')[1]
  if (!encodedPayload) return false

  try {
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    return isRecord(payload) && payload.role === 'service_role'
  } catch {
    return false
  }
}

async function fetchPage(
  table: CredentialTable,
  offset: number,
): Promise<CredentialRow[]> {
  const { data, error } = await client
    .from(table.name)
    .select(`id, ${table.encryptedColumn}`)
    .order('id')
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    throw new Error(`Could not read ${table.name} (database error ${error.code})`)
  }

  const rows: CredentialRow[] = []
  for (const candidate of (data ?? []) as unknown[]) {
    if (!isRecord(candidate)) {
      throw new Error(`Unexpected row returned from ${table.name}`)
    }
    const id = candidate.id
    const encryptedValue = candidate[table.encryptedColumn]
    if (typeof id !== 'string' || typeof encryptedValue !== 'string') {
      throw new Error(`Unexpected credential fields returned from ${table.name}`)
    }
    rows.push({ id, encryptedValue })
  }
  return rows
}

async function updateCredential(
  table: CredentialTable,
  row: CredentialRow,
  encryptedValue: string,
): Promise<void> {
  const update = table.name === 'user_smtp_configs'
    ? client.from(table.name)
      .update({ smtp_password_encrypted: encryptedValue, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('smtp_password_encrypted', row.encryptedValue)
    : client.from(table.name)
      .update({ encrypted_payload: encryptedValue, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('encrypted_payload', row.encryptedValue)

  const { data, error } = await update.select('id')
  if (error) {
    throw new Error(`Could not update a row in ${table.name} (database error ${error.code})`)
  }
  if (data?.length !== 1) {
    throw new Error(`A row in ${table.name} changed during migration; stop and review before retrying`)
  }
}

async function processTable(table: CredentialTable): Promise<{ total: number; changed: number }> {
  let offset = 0
  let total = 0
  let changed = 0

  while (true) {
    const rows = await fetchPage(table, offset)
    if (rows.length === 0) break

    for (const row of rows) {
      let rotated
      try {
        rotated = reencryptCredential(row.encryptedValue, table.oldKey, table.newKey)
      } catch {
        throw new Error(`Could not decrypt or re-encrypt a credential in ${table.name} at row ${total + 1}; no secret or plaintext was logged`)
      }

      if (!rotated.alreadyEncryptedWithNewKey) {
        changed += 1
        if (mode === '--apply') {
          await updateCredential(table, row, rotated.encryptedValue)
        }
      }
      total += 1
    }

    offset += rows.length
  }

  return { total, changed }
}

console.log(`Encryption-key rotation ${mode === '--apply' ? 'APPLY' : 'DRY RUN'} for ${targetHost}`)
console.log(`Using privileged database credential from ${serverKeyName}; key values are not displayed.`)
console.log(`Mailbox encryption key mode: ${mailboxKeyMode}.`)

const results = new Map<CredentialTable['name'], { total: number; changed: number }>()
for (const table of tables) {
  results.set(table.name, await processTable(table))
}

if (mode === '--apply') {
  for (const table of tables) {
    const verification = await processTable(table)
    if (verification.changed !== 0) {
      throw new Error(`Post-migration verification failed for ${table.name}; keep both keys and investigate`)
    }
  }
}

for (const table of tables) {
  const result = results.get(table.name)!
  console.log(
    `${table.name}: ${result.total} records checked; ${result.changed} ${mode === '--apply' ? 're-encrypted' : 'would be re-encrypted'}.`,
  )
}

if (mode === '--dry-run') {
  console.log('Dry run complete; no database records were changed.')
} else {
  console.log('Migration and new-key verification complete. Keep API instances stopped until SMTP_ENCRYPTION_KEY is updated everywhere.')
}
