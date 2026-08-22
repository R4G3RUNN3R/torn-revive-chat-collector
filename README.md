# Torn Revive Chat Collector

Initial research version of a Torn Chat 2.0 userscript for studying how players ask for revives.

## What v0.1 does

- Watches **all Torn Chat 2.0 conversations currently rendered in the active Torn tab**.
- Collects raw chat messages without applying revive keywords yet.
- Stores captured messages locally in IndexedDB.
- Deduplicates messages using a deterministic fingerprint.
- Records chat/channel, player name, player ID when available, exact message text, timestamps, and abroad location when the chat is a recognized travel-country chat.
- Optionally batches unsynced messages to a Google Sheet through a bound Google Apps Script Web App.
- Includes JSON and CSV export as a fallback.
- Pauses collection automatically when the Torn tab is not visible/focused.

This version deliberately does **not** send messages, perform revives, call the Torn API, or classify revive requests.

## Files

- `torn-revive-chat-collector.user.js` - installable Tampermonkey userscript.
- `src/core.js` - tested normalization, fingerprinting, chat classification, and Sheet-record helpers.
- `google-apps-script/Code.gs` - Google Sheets receiver.
- `test/core.test.js` - Node tests for the data model.

## 1. Install the userscript

Open the raw version of `torn-revive-chat-collector.user.js` in GitHub and install it with Tampermonkey.

The userscript loads `src/core.js` from this repository through `@require`, so keep the repository accessible to the browser while testing this version.

## 2. Create the Google Sheet

Create a blank Google Sheet. A tab named `Raw Chat` will be created automatically by the receiver.

From the Sheet:

1. Open **Extensions -> Apps Script**.
2. Replace the default script with the contents of `google-apps-script/Code.gs`.
3. Save the project.
4. Run `setupCollectorSheet()` once and approve the requested spreadsheet permissions.

Optional protection:

1. Run `setCollectorToken('YOUR_RANDOM_TOKEN')` once from the Apps Script editor.
2. Use the same token in the Torn collector panel.

Do not commit the token to this repository.

## 3. Deploy the Sheet receiver

In Apps Script:

1. Choose **Deploy -> New deployment**.
2. Select **Web app**.
3. Execute as: **Me**.
4. Choose the access setting required for the userscript to reach the endpoint from your browser.
5. Deploy and copy the Web App `/exec` URL.

Paste that URL into **Google Apps Script Web App URL** in the Torn collector panel and click **Save settings**.

If you configured a collector token, enter it in the token field as well.

## Sheet columns

The receiver writes the following columns:

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

The userscript observes Torn's rendered Chat 2.0 DOM beneath `#chatRoot`. It does not hook Torn's underlying WebSocket/chat transport. When a chat message element appears, the collector extracts available conversation, sender, message, and timestamp metadata and writes the record to local IndexedDB.

Google sync runs in small batches. A message is marked synced locally only after the Apps Script endpoint responds successfully. The Apps Script also deduplicates by fingerprint, protecting against retries where Google accepted a batch but the browser missed the response.

## Important limitation

"All chats" in v0.1 means all chat conversations/messages that Torn has actually rendered into the active browser page. A conversation that Torn has not loaded into the DOM cannot be collected by this DOM-only version.

## Development

Requires Node.js 20+.

```bash
npm test
npm run check
```

The installable userscript is intentionally kept free of API keys, Sheet URLs, tokens, or collected chat data.
