# Terms of Service

**Coordination Manager**
*Effective Date: February 7, 2026*
*Last Updated: September 13, 2026*

---

## 1. Acceptance of Terms

By accessing or using Coordination Manager ("the App", "the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

---

## 2. Description of Service

Coordination Manager is a web-based coordination application for planning time, scheduling meetings, managing connected mailboxes, distributing messages, and supporting online communities. It allows users to:

- Sign in via Google authentication.
- Sync and view Google Calendar data.
- Plan personal time and availability.
- Manage availability and schedule meetings.
- Coordinate events with other users.
- Connect a Gmail or Outlook mailbox, search and organize it, and configure automation rules (including optional AI-assisted rule suggestions and email scoring).
- Draft and distribute messages across connected channels.
- Configure Discord Guardian moderation tools for communities they manage.
- Use optional AI-assisted features to help draft messages, suggest scheduling, and configure automations.

The Service is provided as an **open-source project** under active development.

---

## 3. Account & Authentication

### 3.1 Google Account

You may sign in with a valid Google account for full feature access. By signing in, you authorise the App to access your basic profile information. Google Calendar and Gmail connections are optional, separate consent flows that request the permissions needed for the feature you choose to connect.

### 3.2 Traveler (Guest) Account

You may use the App without any account by continuing as a **Traveler**. Traveler accounts:

- Require no email, password, or personal information.
- Are assigned a randomly generated identity.
- Can create and manage **unlisted** calendars only.
- Are **automatically deleted after 64 days**, including all associated calendars and events.
- **Cannot be recovered** if the browser session is lost.

By using a Traveler account, you acknowledge and accept these limitations.

### 3.3 Account Responsibility

You are responsible for:

- Maintaining the security of your Google account (if applicable).
- All activity that occurs under your account within the App.
- Ensuring your use complies with Google's Terms of Service (if using Google sign-in).
- Understanding that Traveler account data cannot be recovered once the session is lost.
- Confirming that you are legally able to use the Service in your jurisdiction. The Service is not directed toward children, and we do not knowingly accept accounts from children under 13 or below the applicable digital-consent age where additional consent is required.

### 3.4 Account Termination

You may delete your account at any time through the App settings. We reserve the right to suspend or terminate accounts that violate these Terms.

---

## 4. Acceptable Use

You agree **not** to:

- Use the Service for any unlawful purpose.
- Attempt to gain unauthorised access to other users' data.
- Interfere with or disrupt the Service or its infrastructure.
- Use automated tools to scrape or extract data from the Service.
- Impersonate another person or misrepresent your identity.
- Use the Service to send spam or unsolicited communications.
- Use Mailbox automation rules, the AI assistant, or the Mailbox send feature to send spam, phishing, or bulk unsolicited email, or to send mail impersonating an address you do not control.
- Attempt to bypass daily AI usage limits or automation safeguards (for example, scripting requests to exceed the documented per-account limits).

---

## 5. Open Source & Licensing

### 5.1 Application Code

Coordination Manager is developed as an open-source project under the **MIT License**. The public source code is available at:

**[github.com/whitevo/Coordination-Manager-Public-Clean](https://github.com/whitevo/Coordination-Manager-Public-Clean)**

The production system that runs coordinationmanager.com is maintained in a separate private repository that is not publicly accessible. We selectively merge valuable community contributions from the public repository into production and release appropriate non-sensitive improvements to the public repository.

### 5.2 Trademarks

"Coordination Manager" and "Voltaire Swarm" are trademarks of Voltaire Swarm OÜ. The MIT license covers the source code only -- it does not grant rights to use these names, logos, or branding. See the project's [TRADEMARKS.md](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/TRADEMARKS.md) for details. Forks must rebrand.

### 5.3 Contributions

Code and documentation contributions are accepted under the project's [Contributor Licence Agreement (CLA)](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/CLA.md). By submitting a contribution, you confirm you have the right to submit it and you grant Voltaire Swarm OÜ the licence described in the CLA.

### 5.4 Self-Hosting

You are free to fork and self-host the application under the terms of the MIT License, including running as many private instances as you need. These Terms of Service apply only to the hosted instance operated by Voltaire Swarm OÜ at coordinationmanager.com.

---

## 6. Data Ownership and Use

### 6.1 You own your data

You retain ownership of the data you create or submit through the Service, including availability slots, meetings, calendar entries, and profile information ("Your Data").

### 6.2 Limited licence to us

You grant Voltaire Swarm OÜ a limited, worldwide, royalty-free licence to host, store, transmit, display, and process Your Data solely to:

- Operate and provide the Service to you and to participants you share calendars with;
- Maintain backups, perform security operations, and comply with legal obligations; and
- Produce aggregated and anonymised statistics about Service usage, where individual users cannot be identified.

We do not sell Your Data, share it with advertisers, or use it to train AI models on your personal information.

### 6.3 Data portability and export

You may export your data at any time through the Service's API or account settings. Self-service export is intended to satisfy your data portability rights under applicable data protection law.

### 6.4 Aggregate and anonymised analytics

We may use de-identified and aggregated data derived from the Service (for example, total number of meetings scheduled, average response times, governance participation rates) for product improvement, research, and public reporting. Such aggregated data does not identify you and is not Your Data for the purposes of this section.

### 6.5 Privacy

Your use of the Service is also governed by our [Privacy Policy](PRIVACY_POLICY.md). By using the Service, you consent to the collection and use of your information as described there.

---

## 7. Calendar and Connected Service Data

### 7.1 Google Calendar access

If you connect Google Calendar, the App accesses your calendar data only with your explicit permission and solely to provide scheduling functionality. You can revoke access at any time via your [Google Account Permissions](https://myaccount.google.com/permissions). Google Calendar remains the authoritative source of your event data.

### 7.2 Cardano wallet authentication

If you sign in with a Cardano wallet (CIP-30), we record your wallet address as a pseudonymous identifier for your account. We do not have access to your wallet's private keys, signing capability beyond the authentication challenge, or your funds.

### 7.3 Discord integration

If you link a Discord server to the Service or use the Coordination Manager bots:

- **Server administrators** acting as moderators or guardians have access to bot interaction logs and moderation data only for the server(s) they administer.
- Moderators must explicitly accept the moderator role to gain this access. By accepting, they agree to handle that data in compliance with applicable law and these Terms.
- Participants interacting with the bot in a moderated server should expect that their relevant interactions may be visible to that server's moderators for moderation purposes.
- Discord-platform data handling is also governed by [Discord's Terms of Service](https://discord.com/terms) and [Privacy Policy](https://discord.com/privacy).

### 7.4 Mailbox integration (Gmail / Outlook)

If you connect a Gmail or Outlook account to the Mailbox feature:

- You authorise the App to read, organize (archive, trash, label), and send mail through that account via OAuth, only to provide the Mailbox feature you requested.
- You may configure **automation rules** that act on your mail (for example: tag, archive, or trash matching messages), including rules that use an AI "Assessment Check" to score messages against context and intent you write. You are responsible for the rules you activate; a rule only takes real action once you set its mode to Active.
- You may only send mail from your own connected account address -- the Service does not allow sending as an address you do not control.
- You can disconnect a mailbox account at any time from Mailbox Settings. Disconnecting removes our stored copy of that account's data; it never modifies or deletes anything in your actual Gmail/Outlook mailbox.
- Gmail/Outlook platform data handling is also governed by [Google's Terms of Service](https://policies.google.com/terms) or [Microsoft's Services Agreement](https://www.microsoft.com/en-us/servicesagreement), as applicable.

### 7.5 AI-assisted features

The Service includes optional AI-assisted features (compose help, calendar and availability suggestions, time-management suggestions, and Mailbox automation/assessment), powered by third-party AI providers (OpenAI, with an ASI1-mini fallback from the ASI Alliance / Fetch.ai):

- **AI output may be inaccurate, incomplete, or inappropriate for your situation.** You are responsible for reviewing any AI-generated suggestion, draft, or automation rule before relying on it or activating it.
- **AI-suggested Mailbox automation rules are never self-activating.** The Service always saves an AI-suggested rule in a trial ("preview only") mode; only you can switch a rule to Active so it takes real action on your mailbox.
- Daily use of AI-assisted features is limited per account to control cost and prevent abuse.
- Data sent to AI providers to generate a response is described in the [Privacy Policy](PRIVACY_POLICY.md#39-ai-assistant-interactions).
- We provide no warranty on the accuracy, availability, or fitness for purpose of any AI-generated content, consistent with Section 8 below.

---

## 8. Availability & Warranties

### 8.1 "As Is" Service

The Service is provided **"as is"** and **"as available"** without warranties of any kind, whether express or implied, including but not limited to:

- Fitness for a particular purpose.
- Uninterrupted or error-free operation.
- Accuracy or reliability of any data.

### 8.2 Service Changes

As an actively developed project, the Service may change at any time. We may add, modify, or remove features without prior notice.

### 8.3 Downtime

We do not guarantee uptime. The Service may be unavailable due to maintenance, updates, or circumstances beyond our control.

---

## 9. Limitation of Liability

To the maximum extent permitted by law:

- The App and its maintainers shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.
- Our total liability for any claim relating to the Service shall not exceed the amount you paid for the Service (which is zero for the free tier).
- We are not liable for any actions taken based on scheduling information provided by the App.

---

## 10. Modifications to Terms

We may update these Terms from time to time. Changes will be reflected in the "Last Updated" date at the top. Continued use of the Service after changes constitutes acceptance of the updated Terms.

Policy-facing and open-source release changes are tracked in our [public repository](https://github.com/whitevo/Coordination-Manager-Public-Clean).

---

## 11. Governing Law

These Terms are governed by the laws of the **Republic of Estonia**, where Voltaire Swarm OÜ is established, without regard to its conflict-of-laws principles. Mandatory consumer-protection rights available to you under the law of your country of residence (including, where applicable, EU consumer law) are not affected.

The courts of Estonia have exclusive jurisdiction over disputes arising from or relating to these Terms or the Service, except where mandatory law gives you the right to bring proceedings in another forum.

---

## 12. Operator and Contact

The hosted Service is operated by:

**Voltaire Swarm OÜ**
Registered in Estonia

- **General contact:** tevo@coordinationmanager.com
- **Privacy & data requests:** privacy@coordinationmanager.com
- **Legal & trademark:** legal@coordinationmanager.com
- **Security:** security@coordinationmanager.com (see [SECURITY.md](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/SECURITY.md))
- **Public issues:** [github.com/whitevo/Coordination-Manager-Public-Clean/issues](https://github.com/whitevo/Coordination-Manager-Public-Clean/issues)

---

*Coordination Manager is an open-source project stewarded by Voltaire Swarm OÜ. Public source code is available under the MIT License at [github.com/whitevo/Coordination-Manager-Public-Clean](https://github.com/whitevo/Coordination-Manager-Public-Clean).*
