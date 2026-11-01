import { Endpoint, ParamTable, ResponseExample } from '../components/Endpoint'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'

export function ApiCalendarsPage() {
  return (
    <div className="prose-docs">
      <h1>Calendars API</h1>
      <p className="text-lg text-gray-400 mb-8">
        Coordination calendars are shared scheduling surfaces where participants submit their
        availability. The API lets you create, list, and inspect calendars, plus read availability
        submissions and meetings.
      </p>

      <Callout variant="info">
        All calendar endpoints require a valid API key. Read operations require the <code>read</code> scope.
        Creating calendars requires <code>write:calendars</code>.
      </Callout>

      <h2>List Calendars</h2>
      <Endpoint method="GET" path="/api/agent/calendars" description="List all coordination calendars owned by the API key holder." scope="read">
        <p className="text-xs text-gray-400 mb-2">No query parameters.</p>
        <ResponseExample status={200} body={`{
  "calendars": [
    {
      "id": "uuid",
      "hash": "abc123xyz",
      "title": "Team Standup",
      "visibility": "unlisted",
      "start_date": "2026-03-01",
      "end_date": "2026-03-07",
      "start_hour": 8,
      "end_hour": 18,
      "time_interval": 30,
      "timezone": "UTC",
      "created_at": "2026-02-28T10:00:00Z",
      "updated_at": "2026-02-28T10:00:00Z"
    }
  ]
}`} />
      </Endpoint>

      <h2>Get Calendar Details</h2>
      <Endpoint method="GET" path="/api/agent/calendars/:hash" description="Get full details for a specific calendar by its hash. You can access your own calendars or any public calendar." scope="read">
        <ParamTable params={[
          { name: 'hash', type: 'string', required: true, description: 'The calendar hash (URL path parameter)' },
        ]} />
        <ResponseExample status={200} body={`{
  "calendar": {
    "id": "uuid",
    "hash": "abc123xyz",
    "title": "Team Standup",
    "visibility": "unlisted",
    "start_date": "2026-03-01",
    "end_date": "2026-03-07",
    "start_hour": 8,
    "end_hour": 18,
    "time_interval": 30,
    "timezone": "UTC",
    "created_at": "2026-02-28T10:00:00Z",
    "updated_at": "2026-02-28T10:00:00Z"
  }
}`} />
      </Endpoint>

      <h2>Get Availability</h2>
      <Endpoint method="GET" path="/api/agent/calendars/:hash/availability" description="Get all availability submissions for a calendar. Each submission contains the participant's name and their selected time slots." scope="read">
        <ParamTable params={[
          { name: 'hash', type: 'string', required: true, description: 'The calendar hash (URL path parameter)' },
        ]} />
        <ResponseExample status={200} body={`{
  "availability": [
    {
      "id": "uuid",
      "username": "alice",
      "time_slots": ["2026-03-03_09:00", "2026-03-03_09:30", "2026-03-03_10:00", "2026-03-04_10:00", "2026-03-04_10:30"],
      "created_at": "2026-03-01T08:30:00Z",
      "updated_at": "2026-03-01T08:30:00Z"
    },
    {
      "id": "uuid",
      "username": "bob",
      "time_slots": ["2026-03-03_09:30", "2026-03-03_10:00", "2026-03-04_10:00", "2026-03-04_10:30", "2026-03-04_11:00"],
      "created_at": "2026-03-01T09:15:00Z",
      "updated_at": "2026-03-01T09:15:00Z"
    }
  ]
}`} />
      </Endpoint>

      <h2>Submit Availability</h2>
      <Endpoint method="POST" path="/api/agent/calendars/:hash/availability" description="Submit time availability for a named participant on a calendar. If the username already exists, their availability is replaced (upsert). Agents can submit availability to own calendars or public calendars." scope="write:calendars">
        <ParamTable params={[
          { name: 'hash', type: 'string', required: true, description: 'Calendar hash (URL path parameter)' },
          { name: 'username', type: 'string', required: true, description: 'Participant name (e.g. "tevo", "alice")' },
          { name: 'time_slots', type: 'string[]', required: true, description: 'Array of time slot strings in "YYYY-MM-DD_HH:MM" format. Each slot represents one time interval the participant is available.' },
        ]} />
        <h4 className="text-sm font-medium text-gray-300 mt-3 mb-2">Example Request</h4>
        <CodeBlock language="json" title="POST body">{`{
  "username": "tevo",
  "time_slots": [
    "2026-03-10_13:00",
    "2026-03-10_13:30",
    "2026-03-11_10:00",
    "2026-03-11_10:30",
    "2026-03-11_11:00"
  ]
}`}</CodeBlock>
        <ResponseExample status={201} body={`{
  "availability": {
    "id": "uuid",
    "calendar_id": "calendar-uuid",
    "username": "tevo",
    "time_slots": ["2026-03-10_13:00", "2026-03-10_13:30", "2026-03-11_10:00", "2026-03-11_10:30", "2026-03-11_11:00"],
    "created_at": "2026-03-02T12:00:00Z",
    "updated_at": "2026-03-02T12:00:00Z"
  },
  "note": "Availability for \\"tevo\\" saved with 5 time slot(s)."
}`} />
      </Endpoint>

      <h2>Create Calendar</h2>
      <Endpoint method="POST" path="/api/agent/calendars" description="Create a new coordination calendar. The calendar will be owned by the user associated with the API key." scope="write:calendars">
        <ParamTable params={[
          { name: 'title', type: 'string', required: true, description: 'Calendar title' },
          { name: 'start_date', type: 'string', required: false, description: 'Start date (YYYY-MM-DD)' },
          { name: 'end_date', type: 'string', required: false, description: 'End date (YYYY-MM-DD)' },
          { name: 'start_hour', type: 'number', required: false, description: 'First available hour (default: 8)' },
          { name: 'end_hour', type: 'number', required: false, description: 'Last available hour (default: 18)' },
          { name: 'time_interval', type: 'number', required: false, description: 'Time slot interval in minutes (default: 30)' },
          { name: 'timezone', type: 'string', required: false, description: 'IANA timezone (default: "UTC")' },
          { name: 'visibility', type: 'string', required: false, description: '"public" or "unlisted" (default: "unlisted")' },
        ]} />
        <Callout variant="info">
          Public calendars are auto-archived when they go quiet. A calendar with a date range is listed
          until its end date passes. An any-week calendar is listed for 2 weeks after creation, then for
          2 weeks after the last planned meeting; with no meeting in that window it is archived
          (<code>archived_at</code> is set) and hidden from the home page. Planning a new meeting clears
          <code>archived_at</code> and re-lists it.
        </Callout>
        <h4 className="text-sm font-medium text-gray-300 mt-3 mb-2">Example Request</h4>
        <CodeBlock language="json" title="POST body">{`{
  "title": "Q1 Planning Session",
  "start_date": "2026-03-10",
  "end_date": "2026-03-14",
  "start_hour": 9,
  "end_hour": 17,
  "time_interval": 30,
  "timezone": "Europe/London",
  "visibility": "unlisted"
}`}</CodeBlock>
        <ResponseExample status={201} body={`{
  "calendar": {
    "id": "new-uuid",
    "hash": "generated-hash",
    "title": "Q1 Planning Session",
    ...
  },
  "shareUrl": "/calendar/generated-hash"
}`} />
      </Endpoint>

      <h2>cURL Examples</h2>
      <CodeBlock language="bash" title="List calendars">{`curl -s https://api.coordinationmanager.com/api/agent/calendars \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Get availability">{`curl -s https://api.coordinationmanager.com/api/agent/calendars/abc123xyz/availability \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Submit availability">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/calendars/abc123xyz/availability \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username": "tevo",
    "time_slots": ["2026-03-10_13:00", "2026-03-10_13:30"]
  }' | jq`}</CodeBlock>

      <CodeBlock language="bash" title="Create calendar">{`curl -s -X POST https://api.coordinationmanager.com/api/agent/calendars \\
  -H "Authorization: Bearer $COORDINATION_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Sprint Planning",
    "start_date": "2026-03-10",
    "end_date": "2026-03-14",
    "timezone": "UTC"
  }' | jq`}</CodeBlock>
    </div>
  )
}
