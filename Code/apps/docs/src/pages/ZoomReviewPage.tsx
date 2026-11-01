import { Callout } from '../components/Callout'

export function ZoomReviewPage() {
  return (
    <div className="prose-docs">
      <h1>Zoom Integration -- Test Plan for Marketplace Reviewers</h1>
      <p className="text-lg text-gray-400 mb-8">
        This page provides everything Zoom Marketplace reviewers need to test and verify the
        Coordination Manager Zoom integration.
      </p>

      <div className="overflow-x-auto mb-8">
        <table>
          <tbody>
            <tr><td><strong>App Name</strong></td><td>Coordination Manager</td></tr>
            <tr><td><strong>Developer</strong></td><td><a href="https://github.com/whitevo/Coordination-Manager-Public-Clean" target="_blank" rel="noopener noreferrer">whitevo</a></td></tr>
            <tr><td><strong>App Type</strong></td><td>OAuth (General App)</td></tr>
            <tr><td><strong>Production URL</strong></td><td><a href="https://coordinationmanager.com" target="_blank" rel="noopener noreferrer">https://coordinationmanager.com</a></td></tr>
            <tr><td><strong>Review Landing Page</strong></td><td><a href="https://coordinationmanager.com/zoom-review" target="_blank" rel="noopener noreferrer">https://coordinationmanager.com/zoom-review</a></td></tr>
            <tr><td><strong>Support Contact</strong></td><td>support@coordinationmanager.com</td></tr>
            <tr><td><strong>Developer Contact</strong></td><td>tevo@coordinationmanager.com (actively monitored)</td></tr>
          </tbody>
        </table>
      </div>

      <Callout variant="info" title="Demo video available">
        A walkthrough video of this test plan is available here:{' '}
        <a href="https://youtu.be/j08n3Z0Q78w" target="_blank" rel="noopener noreferrer">https://youtu.be/j08n3Z0Q78w</a>
      </Callout>

      {/* ── 1. App Overview ─────────────────────── */}
      <h2>1. App Overview</h2>
      <p>
        Coordination Manager is an open-source calendar coordination web app. The Zoom integration
        lets authenticated users connect their Zoom account to create Zoom meeting links directly
        from calendar events -- no need to leave the app or copy-paste links manually.
      </p>
      <p><strong>What the integration does (and only does):</strong></p>
      <ul>
        <li>Creates Zoom meetings (scheduled or instant) when a user attaches a video link to a calendar event.</li>
        <li>Reads the user's Zoom display name and email to show which Zoom account is connected.</li>
        <li>Handles app deauthorization via Zoom's compliance webhook.</li>
      </ul>
      <p>
        The app does <strong>not</strong> read, modify, or delete existing Zoom meetings, recordings,
        contacts, or any other Zoom data.
      </p>

      {/* ── 2. Scopes Requested ─────────────────────── */}
      <h2>2. Scopes Requested</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Purpose</th>
              <th>Where Used</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>meeting:write</code></td>
              <td>Create Zoom meetings on behalf of the user</td>
              <td>POST <code>/api/zoom/create-meeting</code> calls <code>POST https://api.zoom.us/v2/users/me/meetings</code></td>
            </tr>
            <tr>
              <td><code>user:read</code></td>
              <td>Read the user's Zoom display name and email to confirm which account is connected</td>
              <td>GET <code>https://api.zoom.us/v2/users/me</code> during the OAuth callback</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        No other scopes are requested. The app never accesses recordings, chat, phone, contacts, or
        account-level data.
      </p>

      {/* ── 3. Test Credentials ─────────────────────── */}
      <h2>3. Test Credentials</h2>
      <h3>Option A -- Use the reviewer landing page (recommended)</h3>
      <ol>
        <li>Go to <strong><a href="https://coordinationmanager.com/zoom-review" target="_blank" rel="noopener noreferrer">https://coordinationmanager.com/zoom-review</a></strong></li>
        <li>Click <strong>"Start Testing"</strong> -- a guest test account is created instantly (no email or password required).</li>
        <li>You will be redirected to the Settings page where you can test the Zoom OAuth flow.</li>
      </ol>

      <h3>Option B -- Manual test account</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Field</th><th>Value</th></tr>
          </thead>
          <tbody>
            <tr><td>URL</td><td><a href="https://coordinationmanager.com/zoom-review" target="_blank" rel="noopener noreferrer">https://coordinationmanager.com/zoom-review</a></td></tr>
            <tr><td>Login</td><td>Click "Start Testing" (creates a guest account automatically)</td></tr>
            <tr><td>Password</td><td>None required (anonymous guest session)</td></tr>
          </tbody>
        </table>
      </div>

      <Callout variant="info" title="Note">
        The app uses its <strong>Production Client ID</strong> for the OAuth authorization flow.
        The redirect URI in production is configured to the production API domain.
      </Callout>

      {/* ── 4. Step-by-Step Test Plan ─────────────────────── */}
      <h2>4. Step-by-Step Test Plan</h2>

      <h3>Prerequisites</h3>
      <ul>
        <li>A Zoom account (free or paid) to authorize during the OAuth flow.</li>
        <li>A modern web browser (Chrome, Firefox, Edge, or Safari).</li>
      </ul>

      <h3>Step 1: Access the Reviewer Landing Page</h3>
      <ol>
        <li>Open your browser and navigate to: <strong><a href="https://coordinationmanager.com/zoom-review" target="_blank" rel="noopener noreferrer">https://coordinationmanager.com/zoom-review</a></strong></li>
        <li>You will see a page titled <strong>"Zoom Integration Review"</strong> with a welcome message and testing instructions.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        The review landing page loads with a "Start Testing" button.
      </Callout>

      <h3>Step 2: Create a Test Account</h3>
      <ol>
        <li>Click the <strong>"Start Testing"</strong> button.</li>
        <li>A guest account is created automatically in the background.</li>
        <li>You are redirected to <strong>Settings &gt; Calendar &amp; Integrations</strong>.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        You are now logged in and see the Settings page with a "Video Conferencing" section showing
        a "Connect Zoom Account" button.
      </Callout>

      <h3>Step 3: Initiate Zoom OAuth Authorization</h3>
      <ol>
        <li>In the <strong>Video Conferencing</strong> section, click <strong>"Connect Zoom Account"</strong>.</li>
        <li>A new tab (or redirect) opens to Zoom's OAuth consent screen at <code>https://zoom.us/oauth/authorize</code>.</li>
        <li>
          The consent screen shows the app name <strong>"Coordination Manager"</strong> and the permissions being requested:
          <ul>
            <li><strong>Create meetings</strong> (<code>meeting:write</code>)</li>
            <li><strong>View your profile</strong> (<code>user:read</code>)</li>
          </ul>
        </li>
      </ol>
      <Callout variant="tip" title="Expected result">
        Zoom's OAuth consent screen appears, showing the correct app name and exactly two permission scopes.
      </Callout>

      <h3>Step 4: Authorize the App</h3>
      <ol>
        <li>Sign in to your Zoom account if prompted.</li>
        <li>Review the permissions and click <strong>"Allow"</strong>.</li>
        <li>Zoom redirects back to Coordination Manager's callback URL.</li>
        <li>The callback exchanges the authorization code for access and refresh tokens (server-side).</li>
        <li>The app fetches your Zoom profile (display name and email) using the <code>user:read</code> scope.</li>
        <li>You are redirected to the Settings page with a success message.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        The Settings page shows:
        <ul className="mt-2 mb-0">
          <li>A green success banner: "Zoom account connected successfully"</li>
          <li>Your Zoom display name and email in the integration card</li>
          <li>A "Connected" status indicator</li>
          <li>A "Disconnect Zoom" button</li>
        </ul>
      </Callout>

      <h3>Step 5: Create a Zoom Meeting (Tests <code>meeting:write</code> Scope)</h3>
      <ol>
        <li>Use the <strong>Create Coordination Calendar</strong> tool from Tools section in menu bar.</li>
        <li>With this you can create a testing calendar (give it any name, e.g., "Test Calendar").</li>
        <li>Use actions to create Meeting Time.</li>
        <li>In the event/meeting side panel, click the <strong>"Zoom"</strong> button (blue Zoom icon).</li>
        <li>The app sends a request to create a Zoom meeting via <code>POST https://api.zoom.us/v2/users/me/meetings</code>.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        <ul className="mt-0 mb-0">
          <li>A Zoom meeting is created successfully.</li>
          <li>The meeting join URL is attached to the event.</li>
          <li>The Zoom button shows a green checkmark, confirming the meeting was created.</li>
          <li>The join URL is a valid Zoom link (e.g., <code>https://zoom.us/j/...</code>).</li>
        </ul>
      </Callout>

      <h3>Step 6: Verify Meeting Details</h3>
      <ol>
        <li>After creating the meeting in Step 5, the event now displays the Zoom join URL.</li>
        <li>(Optional) Open your Zoom account at <a href="https://zoom.us/meeting" target="_blank" rel="noopener noreferrer">https://zoom.us/meeting</a> to verify the meeting appears in your upcoming meetings list.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        The created meeting appears in your Zoom account with the correct topic matching the Calendar Name.
      </Callout>

      <h3>Step 7: Verify Integration Status (Tests <code>user:read</code> Scope)</h3>
      <ol>
        <li>Navigate back to <strong>Settings &gt; Calendar &amp; Integrations</strong>.</li>
        <li>The Video Conferencing section shows your connected Zoom account info.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        The integration card displays:
        <ul className="mt-2 mb-0">
          <li>Your Zoom display name</li>
          <li>Your Zoom email address</li>
          <li>"Connected" status</li>
          <li>"Disconnect Zoom" button</li>
        </ul>
      </Callout>

      <h3>Step 8: Disconnect the Integration</h3>
      <ol>
        <li>In Settings &gt; Video Conferencing, click <strong>"Disconnect Zoom"</strong>.</li>
        <li>The integration is removed from the database immediately.</li>
        <li>All stored tokens (access and refresh) are deleted.</li>
      </ol>
      <Callout variant="tip" title="Expected result">
        <ul className="mt-0 mb-0">
          <li>The integration card reverts to showing "Connect Zoom Account" button.</li>
          <li>No Zoom account info is displayed.</li>
          <li>Attempting to create a Zoom meeting now prompts you to connect your account first.</li>
        </ul>
      </Callout>

      {/* ── 5. Deauthorization / Compliance ─────────────────────── */}
      <h2>5. Deauthorization / Compliance Webhook</h2>
      <p>
        When a user uninstalls the app from Zoom's side (Zoom Marketplace &gt; Manage &gt; Installed Apps),
        Zoom sends a <code>POST</code> webhook to:
      </p>
      <p><strong>Endpoint:</strong> <code>POST /api/zoom/deauthorize</code></p>
      <p><strong>Behavior:</strong></p>
      <ol>
        <li>Verifies the webhook originated from Zoom using the verification token.</li>
        <li>Deletes all stored tokens and integration data for the deauthorized user.</li>
        <li>Sends a compliance completion response to <code>POST https://api.zoom.us/oauth/data/compliance</code>.</li>
      </ol>
      <p>This ensures full compliance with Zoom's data handling requirements.</p>

      {/* ── 6. Security Summary ─────────────────────── */}
      <h2>6. Security Summary</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Security Measure</th><th>Details</th></tr>
          </thead>
          <tbody>
            <tr><td>Token encryption</td><td>All OAuth tokens (access + refresh) encrypted at rest with AES-256-GCM</td></tr>
            <tr><td>Token exposure</td><td>Tokens are stored and used server-side only; never sent to the frontend</td></tr>
            <tr><td>State parameter</td><td>OAuth state is HMAC-SHA256 signed to prevent CSRF attacks</td></tr>
            <tr><td>Token refresh</td><td>Automatic refresh with 5-minute buffer before expiration</td></tr>
            <tr><td>Row-Level Security</td><td>Database RLS ensures users can only access their own integration records</td></tr>
            <tr><td>Minimal scopes</td><td>Only <code>meeting:write</code> and <code>user:read</code> are requested -- no other data access</td></tr>
            <tr><td>Data deletion</td><td>Full token/data removal on disconnect or Zoom deauthorization</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── 7. Architecture Diagram ─────────────────────── */}
      <h2>7. Architecture Diagram</h2>
      <pre className="bg-surface-800 rounded-lg p-4 overflow-x-auto text-sm text-gray-300">
{`User Browser                 Coordination Manager API          Zoom API
     |                              |                            |
     |-- Click "Connect Zoom" ---->|                            |
     |                              |-- Generate signed state -->|
     |<-- Redirect to Zoom --------|                            |
     |                              |                            |
     |-- Authorize at Zoom ---------------------------------->  |
     |                              |<-- Callback with code -----|
     |                              |-- Exchange code for tokens->|
     |                              |<-- Access + Refresh tokens-|
     |                              |-- GET /users/me ----------->|
     |                              |<-- Display name + email ---|
     |                              |-- Store encrypted tokens   |
     |<-- Redirect to Settings -----|                            |
     |                              |                            |
     |-- Click "Add Zoom Meeting"->|                            |
     |                              |-- POST /users/me/meetings->|
     |                              |<-- Meeting join URL -------|
     |<-- Show join URL ------------|                            |`}
      </pre>

      {/* ── 8. API Endpoints Reference ─────────────────────── */}
      <h2>8. API Endpoints Reference</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Auth Required</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>GET</td><td><code>/api/zoom/auth-url</code></td><td>Yes (user session)</td><td>Generate Zoom OAuth authorization URL</td></tr>
            <tr><td>GET</td><td><code>/api/zoom/callback</code></td><td>No (OAuth redirect)</td><td>Handle Zoom OAuth callback, exchange code for tokens</td></tr>
            <tr><td>GET</td><td><code>/api/zoom/integration</code></td><td>Yes (user session)</td><td>Check current Zoom connection status</td></tr>
            <tr><td>DELETE</td><td><code>/api/zoom/disconnect</code></td><td>Yes (user session)</td><td>Remove Zoom integration and delete all tokens</td></tr>
            <tr><td>POST</td><td><code>/api/zoom/create-meeting</code></td><td>Yes (user session)</td><td>Create a new Zoom meeting</td></tr>
            <tr><td>POST</td><td><code>/api/zoom/deauthorize</code></td><td>No (Zoom webhook)</td><td>Handle app deauthorization webhook from Zoom</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── Footer ─────────────────────── */}
      <hr />
      <p className="text-sm text-gray-500">
        Document last updated: March 25, 2026<br />
        For questions during review, contact: <a href="mailto:tevo@coordinationmanager.com">tevo@coordinationmanager.com</a> (actively monitored)
      </p>
    </div>
  )
}
