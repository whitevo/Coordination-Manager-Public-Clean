import { Endpoint, ParamTable, ResponseExample } from '../components/Endpoint'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'

export function ApiMailboxPage() {
  return (
    <div className="prose-docs">
      <h1>Mailbox API</h1>
      <p className="text-lg text-gray-400 mb-8">
        The mailbox API manages connected Gmail and Outlook accounts, synced message data, drafts,
        preferences, and automation rules for a single user. The API is centered around the local
        mailbox projection that keeps provider state synchronized without exposing raw provider internals.
      </p>

      <Callout variant="info">
        All mailbox routes use the authenticated user session and are scoped to the signed-in account.
        GET OAuth callbacks use a browser-bound, expiring, single-use transaction instead of an
        Authorization header. All other endpoints, including POST callbacks, require a valid session.
      </Callout>

      <h2>Account Lifecycle</h2>
      <Endpoint
        method="GET"
        path="/api/mailbox/oauth/:provider/auth-url"
        description="Create a provider-specific OAuth URL for Gmail or Outlook account linking."
        scope="session"
      >
        <p>
          Send this request with credentials enabled to accept the HttpOnly browser-binding cookie,
          then open the returned URL in the same browser. Connections expire after 10 minutes.
          Use a same-site API hostname; cross-site deployments can block the SameSite=Lax cookie.
          Starting another connection for the same provider replaces its browser cookie.
        </p>
        <ParamTable
          params={[
            { name: 'provider', type: 'string', required: true, description: 'Provider name, currently "gmail" or "outlook".' },
          ]}
        />
        <ResponseExample
          status={200}
          body={`{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}`}
        />
      </Endpoint>

      <Endpoint
        method="GET"
        path="/api/mailbox/accounts"
        description="List connected mailbox accounts for the current user, with status, sync state, and provider metadata."
        scope="read"
      >
        <ResponseExample
          status={200}
          body={`{
  "accounts": [
    {
      "id": "acct_123",
      "provider": "gmail",
      "email": "me@gmail.com",
      "status": "connected",
      "sync_cursor": "pageToken-abc",
      "sync_error": null,
      "last_synced_at": "2026-09-23T12:00:00Z"
    }
  ]
}`}
        />
      </Endpoint>

      <Endpoint
        method="POST"
        path="/api/mailbox/accounts/:id/sync"
        description="Trigger an account sync and optionally refresh only new messages from the provider."
        scope="write"
      >
        <ParamTable
          params={[
            { name: 'id', type: 'string', required: true, description: 'Mailbox account id.' },
            { name: 'new_mail_only', type: 'boolean', required: false, description: 'Only fetch messages newer than the existing cursor and do not continue a backfill.' },
            { name: 'reset_cursor', type: 'boolean', required: false, description: 'Force a fresh import from the configured historical window.' },
          ]}
        />
        <ResponseExample
          status={202}
          body={`{
  "status": "syncing",
  "account_id": "acct_123",
  "message": "Mailbox sync started."
}`}
        />
      </Endpoint>

      <Endpoint
        method="POST"
        path="/api/mailbox/accounts/:id/reset-cursor"
        description="Reset the stored sync cursor so a later sync starts from the configured historical window."
        scope="write"
      >
        <ParamTable
          params={[
            { name: 'id', type: 'string', required: true, description: 'Mailbox account id.' },
          ]}
        />
        <ResponseExample
          status={200}
          body={`{
  "status": "ok",
  "account_id": "acct_123",
  "message": "Sync cursor reset."
}`}
        />
      </Endpoint>

      <h2>Messages and Threads</h2>
      <Endpoint
        method="GET"
        path="/api/mailbox/messages"
        description="List normalized mailbox messages with filters for folders, tags, read state, and thread membership."
        scope="read"
      >
        <ParamTable
          params={[
            { name: 'page', type: 'number', required: false, description: 'Page number for paginated results.' },
            { name: 'limit', type: 'number', required: false, description: 'Max items to return in one page.' },
            { name: 'folder', type: 'string', required: false, description: 'Inbox, sent, archive, trash, or similar provider-derived folder.' },
            { name: 'tag', type: 'string', required: false, description: 'Filter by mailbox tag or label.' },
          ]}
        />
        <ResponseExample
          status={200}
          body={`{
  "messages": [
    {
      "id": "msg_123",
      "thread_id": "thread_456",
      "subject": "Quarterly planning",
      "from": "alice@example.com",
      "snippet": "Can we review the roadmap this week?",
      "is_read": false,
      "folder": "inbox"
    }
  ],
  "page": 1,
  "limit": 25,
  "total": 142
}`}
        />
      </Endpoint>

      <Endpoint
        method="GET"
        path="/api/mailbox/threads/:threadId"
        description="Fetch a full mailbox thread, including message history and relevant metadata."
        scope="read"
      >
        <ParamTable
          params={[
            { name: 'threadId', type: 'string', required: true, description: 'Thread identifier in the local mailbox projection.' },
          ]}
        />
        <ResponseExample
          status={200}
          body={`{
  "thread": {
    "id": "thread_456",
    "subject": "Quarterly planning",
    "participants": ["alice@example.com", "me@gmail.com"],
    "messages": [
      {
        "id": "msg_123",
        "from": "alice@example.com",
        "body_plain": "Can we review the roadmap this week?",
        "is_read": false
      }
    ]
  }
}`}
        />
      </Endpoint>

      <Endpoint
        method="POST"
        path="/api/mailbox/messages/:id/read"
        description="Mark a message as read or unread and persist the update in the mailbox projection."
        scope="write"
      >
        <ParamTable
          params={[
            { name: 'id', type: 'string', required: true, description: 'Message id.' },
            { name: 'read', type: 'boolean', required: false, description: 'Set to true to mark as read; false to mark as unread.' },
          ]}
        />
        <ResponseExample
          status={200}
          body={`{
  "status": "ok",
  "message_id": "msg_123",
  "is_read": true
}`}
        />
      </Endpoint>

      <Endpoint
        method="POST"
        path="/api/mailbox/messages/:id/tags"
        description="Add or remove mailbox tags for a message while preserving the local inbox state."
        scope="write"
      >
        <ParamTable
          params={[
            { name: 'id', type: 'string', required: true, description: 'Message id.' },
            { name: 'tags', type: 'string[]', required: true, description: 'Tag names to add or clear for the message.' },
          ]}
        />
        <ResponseExample
          status={200}
          body={`{
  "status": "ok",
  "message_id": "msg_123",
  "tags": ["follow-up", "team"]
}`}
        />
      </Endpoint>

      <Endpoint
        method="POST"
        path="/api/mailbox/messages/bulk-action"
        description="Apply ordered actions to messages owned by the authenticated user. Aggregate fields remain backward-compatible; contract version 1 adds one outcome per requested message and action."
        scope="write"
      >
        <ParamTable params={[
          { name: 'message_ids', type: 'string[]', required: true, description: 'Message UUIDs, deduplicated and capped at the server batch limit.' },
          { name: 'actions', type: '{ action: string, value: string }[]', required: true, description: 'Ordered executable actions; tag actions require a selected tag.' },
          { name: 'cascade', type: 'boolean', required: false, description: 'Allow applied actions to trigger Receive action rules. Defaults to false.' },
        ]} />
        <ResponseExample status={200} body={`{
  "contract_version": 1,
  "processed_messages": 1,
  "applied": 1,
  "failed": 1,
  "errors": ["trash: Provider outcome could not be confirmed"],
  "results": [{
    "message_id": "22222222-2222-4222-8222-222222222222",
    "actions": [
      {"action_index": 0, "action": "mark_read", "value": "", "status": "applied"},
      {"action_index": 1, "action": "trash", "value": "", "status": "uncertain", "error": "Provider outcome could not be confirmed"}
    ]
  }],
  "warnings": []
}`} />
        <p><code>applied</code> means the existing action handler completed; it is not a causal revision or transaction receipt. <code>uncertain</code> can include a provider effect followed by a database failure and must not be automatically retried. <code>unavailable</code> does not distinguish missing from unauthorized IDs.</p>
        <p>Action-event, cascade, and audit recording issues appear as warning codes without converting known-applied effects into failed actions. A later refresh is not proof of remote provider completion. Clients without version-1 outcomes continue using the aggregate response.</p>
      </Endpoint>

      <h2>Drafts and Sending</h2>
      <Endpoint
        method="GET"
        path="/api/mailbox/drafts"
        description="List saved drafts for the current user and account context."
        scope="read"
      >
        <ResponseExample
          status={200}
          body={`{
  "drafts": [
    {
      "id": "draft_1",
      "to": "alice@example.com",
      "subject": "Re: Quarterly planning",
      "body": "Yes, I can review the roadmap today.",
      "status": "draft"
    }
  ]
}`}
        />
      </Endpoint>

      <Endpoint
        method="POST"
        path="/api/mailbox/drafts/:id/send"
        description="Send an existing draft through the connected provider. Human confirmation is required before this action is executed."
        scope="write"
      >
        <ParamTable
          params={[
            { name: 'id', type: 'string', required: true, description: 'Draft id to send.' },
          ]}
        />
        <ResponseExample
          status={202}
          body={`{
  "status": "queued",
  "draft_id": "draft_1",
  "provider_message_id": "gmail-msg-881"
}`}
        />
      </Endpoint>

      <h2>Preferences, People, and Rules</h2>
      <Endpoint
        method="GET"
        path="/api/mailbox/preferences/html-trust"
        description="Read the per-user trusted HTML domain allowlist used to determine which email senders render sanitized HTML in the UI."
        scope="read"
      >
        <ResponseExample
          status={200}
          body={`{
  "trusted_domains": [
    "example.com",
    "notion.so"
  ]
}`}
        />
      </Endpoint>

      <Endpoint
        method="GET"
        path="/api/mailbox/rules"
        description="List configured mailbox automation rules and their current mode for the active user."
        scope="read"
      >
        <ResponseExample
          status={200}
          body={`{
  "rules": [
    {
      "id": "rule_1",
      "name": "Archive internal notifications",
      "mode": "active",
      "conditions": ["from_domain = internal.example.com"],
      "actions": ["archive"]
    }
  ]
}`}
        />
      </Endpoint>

      <Endpoint
        method="GET"
        path="/api/mailbox/analytics"
        description="Get mailbox-wide analytics for the current account set, including counts by folder, tag, and rule activity."
        scope="read"
      >
        <ResponseExample
          status={200}
          body={`{
  "summary": {
    "total_messages": 1420,
    "unread": 23,
    "inbox": 184,
    "archived": 1098
  }
}`}
        />
      </Endpoint>

      <h2>Rate Limits</h2>
      <p>
        Mailbox traffic uses a dedicated limiter set separate from the global rate limit, because sync,
        send, and automation actions can trigger provider calls or AI usage. The current budget is tracked
        in the docs <code>/limits</code> page and enforced in the API service config.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-700">
            <th className="text-left py-2 px-3 text-gray-400 font-medium">Area</th>
            <th className="text-left py-2 px-3 text-gray-400 font-medium">Limit</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-surface-700/50">
            <td className="py-2 px-3 text-gray-300">Mailbox general read/write</td>
            <td className="py-2 px-3 text-gray-300">600 requests / 15 min</td>
          </tr>
          <tr className="border-b border-surface-700/50">
            <td className="py-2 px-3 text-gray-300">Mailbox account sync</td>
            <td className="py-2 px-3 text-gray-300">20 requests / 15 min</td>
          </tr>
          <tr className="border-b border-surface-700/50">
            <td className="py-2 px-3 text-gray-300">Mailbox send</td>
            <td className="py-2 px-3 text-gray-300">40 requests / 15 min</td>
          </tr>
          <tr className="border-b border-surface-700/50">
            <td className="py-2 px-3 text-gray-300">Automation run / bulk action</td>
            <td className="py-2 px-3 text-gray-300">60 requests / 15 min</td>
          </tr>
        </tbody>
      </table>

      <h2>cURL Example</h2>
      <CodeBlock language="bash" title="List mailbox accounts">{`curl -s https://api.coordinationmanager.com/api/mailbox/accounts \
  -H "Authorization: Bearer $COORDINATION_SESSION_TOKEN" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Trigger sync">{`curl -s -X POST https://api.coordinationmanager.com/api/mailbox/accounts/ACCT_ID/sync \
  -H "Authorization: Bearer $COORDINATION_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"new_mail_only": true}' | jq`}</CodeBlock>

      <Callout variant="info">
        For deeper architectural context, sync behavior, storage model, and security boundaries, see the
        <a href="/docs/guides/mailbox-architecture"> Mailbox Architecture Guide</a>.
      </Callout>
    </div>
  )
}
