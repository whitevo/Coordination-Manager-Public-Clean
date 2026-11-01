import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'

export function ExamplesPage() {
  return (
    <div className="prose-docs">
      <h1>Code Examples</h1>
      <p className="text-lg text-gray-400 mb-8">
        Complete, copy-pasteable examples for integrating with the Coordination Manager Agent API
        in Python, JavaScript/TypeScript, and cURL.
      </p>

      <h2>Python — Full Workflow</h2>
      <p>
        This example connects to the API, lists calendars, fetches availability, finds the best
        meeting time, and creates a meeting draft.
      </p>
      <CodeBlock language="python" title="full_workflow.py">{`"""
Full meeting scheduling workflow using the Coordination Manager Agent API.

Requirements:
  pip install requests python-dotenv
"""
import os
from collections import Counter
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv

load_dotenv()

API_URL = os.getenv("COORDINATION_API_URL", "https://api.coordinationmanager.com")
API_KEY = os.getenv("COORDINATION_API_KEY", "")

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}


def api_get(path: str) -> dict:
    resp = requests.get(f"{API_URL}/api/agent{path}", headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


def api_post(path: str, data: dict) -> dict:
    resp = requests.post(f"{API_URL}/api/agent{path}", headers=HEADERS, json=data, timeout=15)
    resp.raise_for_status()
    return resp.json()


# 1. Verify connection
info = api_get("/me")
print(f"✅ Connected as '{info['agentName']}' (scopes: {info['scopes']})")

# 2. List calendars
calendars = api_get("/calendars")["calendars"]
print(f"📅 Found {len(calendars)} calendar(s)")

if not calendars:
    # Create a demo calendar
    result = api_post("/calendars", {
        "title": "Agent Demo Calendar",
        "start_date": "2026-03-10",
        "end_date": "2026-03-14",
        "start_hour": 9,
        "end_hour": 17,
        "timezone": "UTC",
    })
    print(f"Created calendar: {result['calendar']['title']}")
    calendar_hash = result["calendar"]["hash"]
else:
    calendar_hash = calendars[0]["hash"]
    print(f"Using calendar: {calendars[0]['title']} ({calendar_hash})")

# 3. Fetch availability
availability = api_get(f"/calendars/{calendar_hash}/availability")["availability"]
print(f"👥 {len(availability)} participant(s) submitted availability")

# 4. Find best meeting time
if len(availability) >= 2:
    slot_counter: Counter = Counter()
    for sub in availability:
        for slot in sub.get("time_slots", []):
            # slots are "YYYY-MM-DD_HH:MM"
            date, time = slot.split("_")
            slot_counter[(date, time)] += 1

    best_slots = [(s, c) for s, c in slot_counter.items() if c >= 2]
    best_slots.sort(key=lambda x: (-x[1], x[0]))

    if best_slots:
        (date, time), count = best_slots[0]
        start_dt = datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + timedelta(minutes=60)

        meeting = api_post(f"/calendars/{calendar_hash}/meetings", {
            "title": "Auto-Scheduled Standup",
            "description": f"Proposed by agent. {count}/{len(availability)} participants available.",
            "start_time": start_dt.strftime("%Y-%m-%dT%H:%M:00Z"),
            "end_time": end_dt.strftime("%Y-%m-%dT%H:%M:00Z"),
            "duration_minutes": 60,
        })
        print(f"✅ Meeting created: {meeting['meeting']['title']}")
        print(f"📝 {meeting.get('note', '')}")
    else:
        print("⚠️  No overlapping slots found")
else:
    print("⏳ Waiting for more participants to submit availability")

# 5. Submit feedback
feedback = api_post("/feedback", {
    "message": "The auto-scheduling workflow ran successfully!",
})
print(f"💬 Feedback submitted: {feedback['feedback']['id']}")`}</CodeBlock>

      <h2>JavaScript / TypeScript — Fetch API</h2>
      <CodeBlock language="typescript" title="workflow.ts">{`const API_URL = process.env.COORDINATION_API_URL || 'https://api.coordinationmanager.com'
const API_KEY = process.env.COORDINATION_API_KEY!

async function api(method: string, path: string, body?: object) {
  const res = await fetch(\`\${API_URL}/api/agent\${path}\`, {
    method,
    headers: {
      'Authorization': \`Bearer \${API_KEY}\`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(\`\${res.status}: \${await res.text()}\`)
  return res.json()
}

// List calendars
const { calendars } = await api('GET', '/calendars')
console.log(\`Found \${calendars.length} calendar(s)\`)

// Get availability for the first calendar
if (calendars.length > 0) {
  const hash = calendars[0].hash
  const { availability } = await api('GET', \`/calendars/\${hash}/availability\`)
  console.log(\`\${availability.length} participant(s)\`)

  // Create a meeting draft
  const meeting = await api('POST', \`/calendars/\${hash}/meetings\`, {
    title: 'Team Sync',
    start_time: '2026-03-05T10:00:00Z',
    end_time: '2026-03-05T11:00:00Z',
    duration_minutes: 60,
  })
  console.log('Meeting created:', meeting.meeting.title)

  // Submit availability for a participant
  const avail = await api('POST', \`/calendars/\${hash}/availability\`, {
    username: 'agent-user',
    time_slots: ['2026-03-10_10:00', '2026-03-10_10:30', '2026-03-10_11:00'],
  })
  console.log('Availability submitted:', avail.availability.username)
}

// Create an announcement template
const template = await api('POST', '/announcements/templates', {
  title: 'Meeting Scheduled',
  body: 'The team sync has been scheduled for March 5th at 10:00 UTC.',
})
console.log('Template created:', template.template.id)

// Update a template (partial — only include fields to change)
const updated = await api('PUT', \`/announcements/templates/\${template.template.id}\`, {
  body: 'Meeting moved to March 6th at 11:00 UTC.',
})
console.log('Template updated:', updated.template.updated_at)`}</CodeBlock>

      <h2>cURL — Quick Reference</h2>
      <Callout variant="tip" title="Set your key once">
        Export your API key to avoid repeating it:{' '}
        <code>export COORDINATION_API_KEY="cm_agent_your_key_here"</code>
      </Callout>

      <CodeBlock language="bash" title="Verify connection">{`curl -s https://api.coordinationmanager.com/api/agent/me \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="List calendars">{`curl -s https://api.coordinationmanager.com/api/agent/calendars \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Get availability">{`curl -s https://api.coordinationmanager.com/api/agent/calendars/YOUR_HASH/availability \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Create calendar">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/calendars \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "New Calendar", "start_date": "2026-03-10", "end_date": "2026-03-14"}' | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Create meeting">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/calendars/YOUR_HASH/meetings \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Sprint Planning",
    "start_time": "2026-03-05T09:00:00Z",
    "end_time": "2026-03-05T10:00:00Z",
    "duration_minutes": 60
  }' | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Submit availability">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/calendars/YOUR_HASH/availability \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username": "tevo",
    "time_slots": ["2026-03-10_13:00", "2026-03-10_13:30"]
  }' | jq`}</CodeBlock>

      <CodeBlock language="bash" title="List Google Calendar events">{`curl -s "https://api.coordinationmanager.com/api/agent/calendar-sources/events?timeMin=2026-03-09T00:00:00Z&timeMax=2026-03-16T00:00:00Z" \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Create announcement template">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/announcements/templates \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Update", "body": "New features shipped!"}' | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Update announcement template">{`curl -s -X PUT https://api.coordinationmanager.com/api/agent/announcements/templates/TEMPLATE_ID \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Updated Title", "body": "Revised announcement body."}' | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Delete announcement template">{`curl -s -X DELETE https://api.coordinationmanager.com/api/agent/announcements/templates/TEMPLATE_ID \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Submit feedback">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/feedback \
  -H "Authorization: Bearer $COORDINATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Great API!"}' | jq`}</CodeBlock>

      <h2>OpenAPI Spec</h2>
      <p>
        The Agent API serves an OpenAPI 3.0 specification that can be imported into tools like
        Swagger UI, Postman, or used directly by LLM function-calling frameworks:
      </p>
      <CodeBlock language="bash" title="Fetch OpenAPI spec">{`curl -s https://api.coordinationmanager.com/api/agent/openapi.json | jq`}</CodeBlock>
    </div>
  )
}
