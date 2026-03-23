# Chat “read” and “unread” — what we changed on the server

This note is written for **anyone** who wants to understand the change—not only developers.  
If you need file names and technical detail, see **“Technical reference”** at the bottom.

---

## In plain words

We fixed two things so chat behaves more like people expect (similar to apps such as WhatsApp):

1. **Opening a chat no longer means “I’ve read everything.”**  
   Unread counts should only go down when we actually mark messages as read—not the moment you enter the conversation.

2. **When the app says “these specific messages were read,” the server now listens.**  
   Before, the server always treated it as “mark the whole chat as read,” which wasn’t always correct.

---

## Change 1 — Opening a chat does not clear unread anymore

### What you might have seen before

- You open a chat, but you haven’t really read all the messages yet.
- The **unread badge** or count still dropped to **zero** too early.
- That felt wrong because you hadn’t actually read everything.

### Why that happened

The server used to say: *“This person joined the chat room → mark every message as read for them.”*  
Joining the chat is really just *connecting for live updates*—it’s not the same as *I’ve read up to here*.

### What we do now

- **Joining** a chat only connects you for real-time updates.
- Messages are marked as read only when the app **explicitly** asks the server to do that (after you’ve actually viewed messages).

### What this means for you

- Unread numbers should **match reality** better.
- The app controls **when** “read” happens, not the act of simply opening the thread.

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

| Situation | Before | After |
|-----------|--------|--------|
| User opens a chat | Often everything marked read immediately | Only connecting for live updates; read when app says so |
| App says “these messages were read” | Whole chat marked read | Those messages (or whole chat if no list sent) |

---

## What stayed the same (so you’re not surprised)

- **Sending messages**, notifications, and live updates to phones still work as before.
- The **chat list** still shows an **unread count** based on which messages are actually marked read in the database.
- After you mark messages as read, the server still tells the app so badges can update.

---

## For developers — technical reference

| Topic | Detail |
|--------|--------|
| Join chat | `joinChat` in `utils/socket.js` — removed automatic `markChatAsRead` / `markMessagesAsRead` and the related `messagesRead` emit on join |
| Mark read | `markMessagesRead` in `utils/socket.js` passes `messageIds` into `messageService.markMessagesAsRead` → `repositories/message.repo.js` |
| `messageIds` | Non-empty array → update `ReadBy` only for those message `_id`s in that chat; missing/empty → same “all applicable messages” behaviour as legacy |

**Integrator notes**

- After `joinChat`, the app should call **`markMessagesRead`** when the user has actually read messages.
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
