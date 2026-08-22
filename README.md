# Torn Revive Chat Collector

Research userscript for studying how Torn players ask for revives.

## What v0.2 does

- Discovers **every chat Torn has currently instantiated/loaded in the active page**, rather than relying on one old message class.
- Supports both older Chat 2.0 class patterns and the current 2026 virtualized chat layout (`scrollWrapper__`, `box__`, `virtualItem__`, `senderContainer__`, `body__`).
- Uses the stable Torn chat textarea (`textarea[placeholder="Type your message here..."]`) as an additional discovery anchor.
- Attaches a dedicated `MutationObserver` to each discovered chat/message container.
- Scans messages already rendered when a chat is discovered and rescans when React virtualizes or rerenders the list.
- Collects raw chat messages without applying revive keywords yet.
- Stores captured messages locally in IndexedDB and deduplicates them with deterministic fingerprints.
- Records chat/channel, player name, player ID when available, exact message text, timestamps, page URL, and abroad location when the conversation label identifies a Torn travel country.
- Optionally batches unsynced messages to a Google Sheet through a bound Google Apps Script Web App.
- Includes JSON and CSV export as a fallback.
- Shows diagnostics for instantiated chats, chat-list items, captured conversations, and coverage state.
- Captures/syncs only while the Torn page is visible, focused, and has recent direct user interaction.

This version deliberately does **not** send messages, perform revives, call the Torn API, auto-open chats, or hook Torn/Sendbird WebSockets.

## What "all chats" means

The collector attempts to discover every chat Torn has instantiated in the current page, including multiple simultaneous private/group chats and normal channel chats. It watches the page for chats created later and attaches to them automatically.

A DOM-only userscript cannot guarantee every individual message from a conversation Torn has never loaded into the page. Closed/unloaded conversations may expose only chat-list or unread state until Torn loads the conversation itself. v0.2 therefore reports its current coverage rather than claiming an invisible background stream exists.

The script does not programmatically open closed chats and does not hook the underlying Sendbird/WebSocket transport.

## Files

- `torn-revive-chat-collector.user.js` - installable Tampermonkey userscript.
- `src/core.js` - tested normalization, fingerprinting, chat classification, and Sheet-record helpers.
- `src/chat-dom.js` - tested resilient chat discovery/virtualized-DOM adapter.
- `google-apps-script/Code.gs` - Google Sheets receiver.
- `test/core.test.js` - Node tests for the data model.
- `test/chat-dom.test.js` - Node tests for chat discovery and current/legacy selector coverage.

## 1. Install the userscript

Open the raw version of `torn-revive-chat-collector.user.js` in GitHub and install/update it with Tampermonkey.

The userscript loads `src/core.js` and `src/chat-dom.js` from this repository through `@require`, so the repository must remain accessible to the browser.

## 2. Create the Google Sheet

Create a blank Google Sheet. A tab named `Raw Chat` will be created automatically by the receiver.

From the Sheet:

1. Open **Extensions -> Apps Script**.
2. Replace the default script with the contents of `google-apps-script/Code.gs`.
3. Save the project.
4. Run `setupCollectorSheet()` once and approve the requested spreadsheet permissions.

The collector token is optional. Leaving it blank is supported for the initial research deployment. Never commit a token or deployed Web App URL to this repository.

## 3. Deploy the Sheet receiver

In Apps Script:

1. Choose **Deploy -> New deployment**.
2. Select **Web app**.
3. Execute as: **Me**.
4. Choose the access setting required for the userscript to reach the endpoint from your browser.
5. Deploy and copy the generated Web App `/exec` URL.
6. Paste that URL into **Google Apps Script Web App URL** in the Torn collector panel and click **Save settings**.

## Sheet columns

| Column | Purpose |
| --- | --- |
| Date | Message date derived from Torn timestamp when available |
| Time | Message time derived from Torn timestamp when available |
| Chat / Channel | Conversation title seen in Torn |
| Chat Type | global, trade, hospital, jail, faction, company, travel, private, etc. |
| Abroad Location | Recognized Torn travel country when applicable |
| Player | Sender name |
| Player ID | Sender Torn ID when exposed by the rendered chat DOM |
| Message | Exact captured message text |
| Message Timestamp | Timestamp exposed by Torn when available |
| Captured At | Local collection timestamp |
| Page URL | Torn page active when captured |
| Conversation ID | DOM conversation identifier or stable name fallback |
| Source Message ID | Torn DOM message identifier when exposed |
| Fingerprint | Deduplication identifier |

## How collection works

The userscript repeatedly discovers chat contexts in the currently active Torn page. It combines stable input discovery with legacy wrappers and current 2026 virtualized chat roots. For every loaded chat it locates the message scroll/list container, scans rendered message items, and attaches a dedicated observer so subsequent renders are processed as well.

Google sync runs in small batches. A message is marked synced locally only after the Apps Script endpoint responds successfully. The Apps Script also deduplicates by fingerprint, protecting against retries where Google accepted a batch but the browser missed the response.

## Development

Requires Node.js 20+.

```bash
npm test
```

CI also syntax-checks the userscript, `src/core.js`, and `src/chat-dom.js`.

The repository intentionally contains no Sheet URL, API key, collector token, or collected chat data.
