# Privacy Policy

**Coordination Manager**
*Effective Date: February 7, 2026*
*Last Updated: September 13, 2026*

---

## 1. Introduction

Coordination Manager ("the App", "the Service") is an open-source coordination application for planning time, scheduling meetings, managing connected mailboxes, distributing messages, and supporting online communities. It is operated by **Voltaire Swarm OÜ**, a private limited company registered in Estonia ("we", "us", "our"). This Privacy Policy explains what data we collect, how we use it, who we share it with, and the rights you have over it.

Voltaire Swarm OÜ is the **data controller** for personal data processed through the hosted instance at <https://coordinationmanager.com>. If you self-host the software, you are the controller for your own deployment.

We are committed to transparency — both in how we handle your data and in how our software is built.

---

## 2. Open Source Transparency

Coordination Manager is developed as an **open-source project** under the **MIT License**. The public source code is available for review, audit, and contribution:

- **Public repository:** [github.com/whitevo/Coordination-Manager-Public-Clean](https://github.com/whitevo/Coordination-Manager-Public-Clean)
- **Licence:** [LICENSE](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/LICENSE)

The production platform that operates coordinationmanager.com is maintained in a separate private repository that is not publicly accessible. We selectively merge valuable community contributions from the public repository into production, and we periodically release appropriate non-sensitive improvements back to the public repository.

You can inspect exactly how your data is processed. We believe open-source development is the strongest form of privacy assurance — you don't have to take our word for it; you can verify it yourself.

---

## 3. Information We Collect

### 3.1 Google Account Users

When you sign in with Google, we receive:

- **Name** — Your display name from your Google profile.
- **Email address** — Your primary Google email.
- **Profile picture** — Your Google profile avatar (if available).
- **Google user ID** — A unique identifier from Google.

We do **not** receive or store your Google account password.

### 3.2 Traveler (Guest) Accounts

When you continue as a Traveler, we collect:

- **No personal information** — No email, no name, no password.
- A randomly generated **Traveler name** is assigned to you (e.g., *Wandering Falcon 42*).
- A session token is stored in your browser to maintain access.

Traveler accounts are **fully anonymous**. We cannot identify who you are, and we cannot recover your account if you lose your browser session.

**Traveler data is automatically deleted after 64 days.**

### 3.3 Cardano Wallet Sign-In

If you sign in using a Cardano-compatible browser wallet (CIP-30, such as Lace, Eternl, Typhon, or Yoroi):

- We record your **wallet address** as a pseudonymous identifier for your account.
- We do **not** receive your private keys, mnemonic, or signing capability beyond the one-time authentication challenge.
- We do **not** access your funds, transaction history, or other on-chain activity.

A wallet address is **pseudonymous personal data** under the EU General Data Protection Regulation (GDPR): on its own it does not identify you by name, but it can be linked to your account, and on-chain analysis by third parties may further identify you. We treat wallet addresses with the same care as other personal data: they are included in your data export and deleted when you delete your account.

### 3.4 Discord Linking and Bot Interactions

If you link your account to Discord or interact with our Discord bots:

- We store your Discord user ID and server/channel context relevant to the integration.
- Server administrators who hold the **moderator role** for a given server may view bot interaction and moderation data for that server only, after explicitly accepting the moderator role.
- We do not access your DMs unrelated to the bot, your private Discord servers, or your wider Discord activity.

### 3.5 Calendar Data

If you grant calendar permissions (e.g., Google Calendar), we access:

- **Calendar events** — Event titles, times, durations, and participant information from your connected calendars.
- **Availability data** — Free/busy information for scheduling purposes.

This data is used solely to provide scheduling functionality within the App.

### 3.6 Application Data

Data you create within the App:

- **User preferences** — Timezone, notification settings, display preferences.
- **Meetings and events** — Meetings you create or are invited to through the App.
- **Availability settings** — Your configured available hours and scheduling preferences.

### 3.7 Automatically Collected Data

- **Usage and server logs** — Basic server logs for error tracking, abuse prevention, and performance monitoring. These are kept for a limited period and minimised where possible.
- **No third-party advertising or behavioural-tracking trackers.** We do not embed analytics, advertising, or marketing tags from third parties.

### 3.8 Mailbox Integration (Gmail / Outlook)

If you connect a Gmail or Outlook account to the Mailbox feature, we access it via OAuth with your explicit consent and store:

- **A normalized copy of your messages and threads** -- subject, sender/recipient addresses, timestamps, a sanitized version of the HTML/text body, and attachment metadata -- so search, filters, and automation rules can run without re-fetching from the provider on every action.
- **Contacts and correspondence patterns** derived from messages you send and receive (for the People/Contacts view).
- **Calendar invitations detected in your mail**, so they can optionally be added to a coordination calendar or Time Manager entry.
- **Automation rules and AI "Assessment Check" configuration** you create (conditions, actions, and any context/intent text you write for AI-scored checks).
- **OAuth access/refresh tokens**, encrypted at rest (AES-256-GCM) and never exposed to the browser or logged in plaintext.

Gmail/Outlook remain the source of truth for your mailbox; disconnecting an account or deleting it from Settings removes our stored copy of its messages, contacts, automation rules, and credentials. Requested OAuth scopes are limited to reading, organizing (archive/trash/label), and sending mail on your behalf -- we do not request access to unrelated Google/Microsoft services.

### 3.9 AI Assistant Interactions

Coordination Manager includes optional AI-assisted features (compose help, calendar and availability suggestions, time-management suggestions, and Mailbox automation/assessment). When you use one of these features:

- Your typed prompt, relevant page context (for example the calendar you are viewing, or the email you have open in Mailbox), and a short recent conversation history are sent to our AI provider (OpenAI, or the ASI1-mini fallback model from the ASI Alliance / Fetch.ai) to generate a response.
- For **Mailbox automation "Assessment Check" rules**, a bounded excerpt of the relevant email (subject, sender, and up to ~4,000 characters of body text) plus the context/intent text you configured is sent per evaluation so the AI can score whether the email matches your rule.
- These requests are processed **transiently to generate a response**; they are not used by us to train any model, and our provider agreements are with API products that do not train on customer API data by default (unlike some consumer chat products). We do not control third-party providers' own retention policies beyond their published terms, linked in Section 6.
- AI-suggested mailbox automation rules can never be activated or run over your full mailbox by the AI itself -- our server always forces new AI-suggested rules into a trial ("preview only") mode; only you can switch a rule to Active.
- Daily usage of AI features is limited per account to control cost and abuse, not to profile your usage.

### 3.10 Cookies and Local Browser Storage

We do **not** use cookies or local storage for advertising, cross-site tracking, or behavioural profiling, and we do not currently show a cookie-consent banner because we do not set any non-essential tracking cookies.

- **Authentication tokens** -- By default, Supabase authentication tokens are kept in `sessionStorage` and are removed when the browser session closes. If you explicitly select **Remember me on this device**, the tokens are kept in `localStorage`, shared across tabs, and limited by a 14-day inactivity timeout. Authentication storage is strictly necessary for the Service to function and is not used for tracking.
- **`localStorage`** -- Used for remembered authentication only when you opt in, and to remember in-app preferences on the device you are using. Preferences include selected timezone(s), date format, and UI display choices such as collapsed or expanded panels.
- **`sessionStorage`** -- Used by default for authentication tokens and for in-progress form input such as an unsent announcement draft. It lasts only for the browser session and is never sent to our servers except when required to authenticate a request or when you submit stored form content.
- **No IP-based or geolocation tracking for timezone detection.** Where the App detects your timezone automatically, it reads it from your browser/OS via the standard `Intl.DateTimeFormat` API. This runs entirely on your device -- no IP lookup, geolocation request, or network call is involved, and nothing is sent to us as part of detection itself.
- All of the above is stored locally in your browser, not on our servers, and is cleared if you clear your browser storage or (for Traveler sessions) when the associated account expires or you log out.

---

## 4. How We Use Your Information

### 4.1 Optional Integrations and Separate Consent

Creating an account or signing in does not automatically connect your external calendars, mailbox, or Discord account. These integrations are optional and remain disconnected until you choose the relevant feature and complete its separate authorization or confirmation steps.

- **Google sign-in** gives the App access to the basic profile information described in Section 3.1. It does not by itself authorize Google Calendar or Gmail access.
- **Google Calendar sync** requires a separate Google OAuth consent step for calendar permissions.
- **Gmail and Outlook Mailbox sync** each require a separate provider OAuth consent step for mailbox permissions. Connecting a calendar does not connect a mailbox, and connecting a mailbox does not connect a calendar.
- **Discord features** require you to initiate account or server linking and complete the applicable confirmation steps.
- **Optional AI-assisted processing** occurs only when you invoke an AI-assisted feature or activate a Mailbox Assessment Check rule, as described in Section 3.9.

You can use the Service without connecting these optional integrations. You can also disconnect an integration or revoke its provider permissions without deleting your Coordination Manager account. Disconnecting may disable the related feature and is subject to the deletion and retention terms in Section 5.2.

We use your information exclusively to:

- **Authenticate your identity** via Google OAuth 2.0, Cardano wallet signatures, or Traveler session tokens.
- **Display your profile** within the application.
- **Sync your calendar** data for scheduling features, only after you connect a calendar source.
- **Coordinate meetings** by comparing availability across participants.
- **Sync and organize your mailbox** (Gmail/Outlook), when you connect one, including running automation rules you configure.
- **Power optional AI-assisted features** (compose help, calendar/availability suggestions, time-management suggestions, mailbox automation and email assessment) when you invoke them, by sending the minimum relevant context to our AI provider per request, as described in Section 3.9.
- **Send notifications** about schedule changes and upcoming events.
- **Operate Discord integrations** you have explicitly enabled.
- **Protect the Service** — abuse prevention, rate limiting, security incident response.
- **Produce de-identified, aggregated analytics** for product improvement, governance research, and public reporting (no individual identification).

We do **not**:

- Sell your data to third parties.
- Use your data for advertising.
- Share your data with unrelated services.
- Train AI/ML models on your personal data.

### 4.2 Google API Services Limited Use Compliance

The use and transfer of raw or derived user data received from Google Workspace APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

We request the following Google API scopes only when you choose to connect the corresponding feature:

| Google OAuth scope | Why Coordination Manager requests it |
|--------------------|--------------------------------------|
| `https://www.googleapis.com/auth/calendar.readonly` | Read your calendars, events, and free/busy availability to calculate suitable meeting times and detect scheduling conflicts. |
| `https://www.googleapis.com/auth/calendar.events` | Create and update calendar events only for meetings you explicitly confirm. |
| `https://www.googleapis.com/auth/gmail.modify` | Import and display your email in Mailbox, and perform user-directed actions such as applying labels, archiving, marking messages read or unread, and deleting messages. |
| `https://www.googleapis.com/auth/gmail.send` | Send an email on your behalf only when you compose and explicitly send it through Coordination Manager. |
| `https://www.googleapis.com/auth/userinfo.email` | Identify which Google account is connected and display its email address in settings, so you can distinguish connected accounts. |

Google Calendar data is used only for the user-facing calendar, availability, time-management, and meeting features you request. Gmail data is used only for the user-facing Mailbox features you request, including message synchronization, display, search, organization, sending, calendar-invitation detection, and user-configured automation. Section 3.9 explains the limited Gmail content sent to an AI provider only when you invoke an AI-assisted Mailbox feature or enable an AI Assessment Check rule.

We do not sell Google user data, use it for advertising or creditworthiness, or use it to train generalized AI or ML models. Humans do not read Google user data except when you give explicit consent for support, when access is necessary to investigate abuse or a security incident, when required by law, or when the data has been aggregated and anonymized for internal operations. We do not transfer Google user data to unrelated third parties.

---

## 5. Data Storage & Security

### 5.1 Infrastructure

- **Authentication** is handled by [Supabase](https://supabase.com), which manages secure token exchange with Google. Your Google credentials never pass through our application servers.
- **Database** is hosted on Supabase (PostgreSQL) with row-level security policies.
- All data is transmitted over **HTTPS/TLS** encryption.
- **Mailbox OAuth tokens and any manually entered mail server credentials are encrypted at rest** (AES-256-GCM) with a server-held key, separate from the database backup, and are never returned to the browser or written to logs.

### 5.2 Data Retention

- **Google accounts**: Your data is retained as long as your account is active. You may **delete your account** at any time through the App settings, which removes all associated data.
- **Traveler accounts**: All data (profile, calendars, events) is **automatically deleted 64 days** after account creation. This is enforced by an automated database cleanup process.
- Calendar data is accessed in real-time and is not permanently cached beyond what is necessary for the features you use.
- **Mailbox data**: disconnecting a mailbox account, or deleting your Coordination Manager account, deletes our stored copy of that mailbox's messages, contacts, threads, automation rules, and encrypted credentials. Your Gmail/Outlook mailbox itself is never modified by disconnection -- only our local copy and the connection are removed.

---

## 6. Third-Party Services (Sub-processors)

The hosted Service relies on the following third-party providers. Each operates under its own privacy and security obligations:

| Service | Purpose | Privacy Policy |
|---------|---------|----------------|
| Supabase | Database, authentication, file storage | [Supabase Privacy Policy](https://supabase.com/privacy) |
| Vercel | Frontend hosting and edge delivery | [Vercel Privacy Policy](https://vercel.com/legal/privacy-policy) |
| Railway | Backend API hosting | [Railway Privacy Policy](https://railway.app/legal/privacy) |
| Google (OAuth & Calendar) | Authentication and calendar integration | [Google Privacy Policy](https://policies.google.com/privacy) |
| Google (Gmail, Mailbox feature) | Mailbox OAuth sign-in, message sync, sending mail on your behalf | [Google Privacy Policy](https://policies.google.com/privacy) |
| Microsoft (Outlook, Mailbox feature) | Mailbox OAuth sign-in, message sync, sending mail on your behalf | [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement) |
| OpenAI | AI-assisted features (compose, calendar, availability, time-management, mailbox automation and assessment) | [OpenAI Privacy Policy](https://openai.com/privacy/) |
| ASI Alliance / Fetch.ai (ASI1-mini) | Fallback AI model for the same AI-assisted features | [ASI Alliance Privacy Policy](https://superintelligence.io/privacy) |
| Cardano wallet providers (e.g. Lace, Eternl, Typhon, Yoroi) | Wallet sign-in via CIP-30 | See each wallet provider's policy |
| Discord | Discord bot and guardian features | [Discord Privacy Policy](https://discord.com/privacy) |
| Cloudflare Turnstile | Captcha for abuse prevention | [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) |
| ImprovMX | Email forwarding for project addresses | [ImprovMX Privacy Policy](https://improvmx.com/privacy/) |

If this list changes materially, we will update this Privacy Policy and reflect the change in the public repository history.

---

## 7. Your Rights

If you are in the European Economic Area, the United Kingdom, or another jurisdiction granting equivalent data protection rights, you have the right to:

- **Access** your stored data through the App or by contacting us.
- **Rectify** inaccurate data via the App or by contacting us.
- **Erase** your account and all associated data ("right to be forgotten").
- **Restrict** or **object to** certain processing.
- **Receive a copy** of your data in a portable, machine-readable format (data portability).
- **Revoke** Google calendar access through your [Google Account Permissions](https://myaccount.google.com/permissions).
- **Disconnect** a Gmail or Outlook mailbox at any time from Mailbox Settings, which deletes our stored copy of that account's data; you can also revoke access directly via [Google Account Permissions](https://myaccount.google.com/permissions) or your [Microsoft account app permissions](https://account.live.com/consent/Manage).
- **Turn off AI-assisted features** you don't want to use; declining them does not affect any non-AI feature of the Service.
- **Lodge a complaint** with your national data protection authority. In Estonia, this is the [Estonian Data Protection Inspectorate (AKI)](https://www.aki.ee/en).

To exercise any of these rights, contact **privacy@coordinationmanager.com**. We aim to respond within 30 days.

---

## 8. Children's Privacy

Coordination Manager is not directed toward children. We do not knowingly collect personal information from children under 13, or from children below the applicable digital-consent age in their country where additional consent is required.

If you believe a child has provided personal information through the Service, please contact **privacy@coordinationmanager.com**. We will review the request and delete the information where required by applicable law.

---

## 9. Forward-Looking Privacy Roadmap

We are actively exploring **zero-knowledge (ZK) and privacy-preserving cryptographic techniques** so that participants can compare availability and coordinate meetings without revealing more information than necessary, even to the platform operator. This is not yet implemented; we will update this Policy when such features are released. The current Service operates with conventional server-side processing as described above.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last Updated" date at the top of this page. For material changes, we will notify users through the App or via email where appropriate.

As an open-source project, policy-facing changes are tracked in our [public repository](https://github.com/whitevo/Coordination-Manager-Public-Clean).

---

## 11. Contact

If you have questions about this Privacy Policy or your data:

- **Data controller:** Voltaire Swarm OÜ (Estonia)
- **Privacy & data requests:** privacy@coordinationmanager.com
- **General contact:** tevo@coordinationmanager.com
- **Security:** security@coordinationmanager.com
- **GitHub:** [github.com/whitevo/Coordination-Manager-Public-Clean/issues](https://github.com/whitevo/Coordination-Manager-Public-Clean/issues) (for non-personal questions only)

---

*Coordination Manager is an open-source project stewarded by Voltaire Swarm OÜ. Public source code is available under the MIT License at [github.com/whitevo/Coordination-Manager-Public-Clean](https://github.com/whitevo/Coordination-Manager-Public-Clean).*
