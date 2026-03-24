# Chat “read” and “unread” — what we changed on the server

This note is written for **anyone** who wants to understand the change—not only developers.  
If you need file names and technical detail, see **“Technical reference”** at the bottom.

---

## In plain words

We adjusted two areas so chat read/unread stays predictable:

1. **When you join a chat room (`joinChat`), the server again marks existing messages as read for that user** (same as the older behaviour).  
   Unread for that chat is cleared when you connect for live updates in that thread.

2. **When the app says “these specific messages were read,” the server respects a message list when provided.**  
   Partial read stays available via `markMessagesRead` + `messageIds`.

---

## Change 1 — Joining a chat marks existing messages read (restored)

### Behaviour

- When a user **joins** the chat socket room (`joinChat`), the server marks **all messages in that chat** as read for that user (if they are a **participant**).
- Chat **last read** timestamps are updated, and **`messagesRead`** is emitted (personal room + chat room) so the app can refresh badges.

### Note

- This matches the **previous** “open thread = clear unread for that chat” product choice.
- **Partial** read is still done via **`markMessagesRead`** with optional **`messageIds`**.

---

## Change 2 — “Mark these messages as read” is now respected

### What you might have seen before

- The app could send a list of **specific message IDs** that were shown on screen.
- The server **ignored** that list and marked **the entire chat** as read anyway.

### What we do now

- If the app sends **which messages** were read, the server updates **only those** (when a list is provided).
- If the app does **not** send a list, the server can still mark all relevant messages as read—same as the old behaviour—so nothing breaks for older clients.

### What this means for you

- Fewer cases where the system thinks you read **everything** when you only saw **part** of the thread (for example before scrolling up).

---

## Quick comparison

| Situation | Behaviour |
|-----------|-----------|
| User joins chat (`joinChat`) | All messages in that chat marked read for that user (participant only) |
| App sends `markMessagesRead` with `messageIds` | Only those messages updated |
| App sends `markMessagesRead` without `messageIds` | Whole chat marked read for that user |

---

## What stayed the same (so you’re not surprised)

- **Sending messages**, notifications, and live updates to phones still work as before.
- The **chat list** still shows an **unread count** based on which messages are actually marked read in the database.
- After you mark messages as read, the server still tells the app so badges can update.

---

## For developers — technical reference

| Topic | Detail |
|--------|--------|
| Join chat | `joinChat` in `utils/socket.js` — after join, if user is a participant: `markChatAsRead`, `markMessagesAsRead` (no `messageIds` = all messages), then `messagesRead` emit |
| Mark read | `markMessagesRead` in `utils/socket.js` passes `messageIds` into `messageService.markMessagesAsRead` → `repositories/message.repo.js` |
| `messageIds` | Non-empty array → update `ReadBy` only for those message `_id`s in that chat; missing/empty → same “all applicable messages” behaviour as legacy |

**Integrator notes**

- **`joinChat`** already marks the whole chat read for the joining user; use **`markMessagesRead`** when you need **partial** read or to sync after viewing without re-joining.
- Optional: send **`messageIds`** for partial read; omit for full-chat style mark-read.
- Server still emits **`messagesRead`** with `chatId`, `userId`, `unreadCount` for the user who read, so clients can refresh UI.

**`newMessage` socket payload (lightweight extras)**

- On **`sendMessage`**, the emitted **`newMessage`** object includes fields already on the loaded chat document—**no extra database round trip**:
  - **`Type`** and **`ChatType`** — same string value (`admin-client` or `admin-designer`) so clients can route list updates to the correct tab without refetching the chat.
  - **`EnquiryName`** — optional display hint for chat-list rows when a thread wasn’t in the cached first page.
- Existing clients that ignore unknown fields are unaffected; payload size increase is small (a few strings).

---

## Revision history

| When | What |
|------|------|
| _(add your release date or ticket)_ | Documented join-chat and message-ID read behaviour |

---

*Questions about this change can go to the team that maintains the Chandra API / chat service.*
