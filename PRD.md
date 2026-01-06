# Telegram-Claude: Claude Code via Telegram

## Product Requirements Document

### Overview

Telegram-Claude is a bridge that enables full Claude Code functionality through Telegram, allowing the user to interact with Claude Code from their iPhone (or any Telegram client). The system runs as a local service on the user's Mac and provides a near-identical experience to the Claude Code CLI.

---

### Goals

1. **Mirror Claude Code functionality** - All capabilities available in Claude Code CLI should be accessible via Telegram
2. **Mobile accessibility** - Use Claude Code from iPhone without needing terminal access
3. **Conversation continuity** - Sessions persist and can be resumed across service restarts
4. **Minimal friction** - Natural language interaction only, no special commands required

---

### User Profile

- Single user (private bot)
- Authenticated via hardcoded Telegram user ID
- Primary use case: mobile access to Claude Code for software development tasks

---

### System Architecture

#### Components

1. **Telegram Bot** - Receives messages, sends responses
2. **Claude Agent SDK Integration** - Manages Claude Code sessions
3. **Session Persistence Layer** - Maps Telegram chats to Claude sessions, stores session state
4. **Local Service** - Long-running process on user's Mac

#### Environment

- **Runtime**: User's local Mac (macOS)
- **Working Directory Constraint**: Claude is restricted to `~/Workspace` and its subdirectories
- **Process Model**: Manually started long-running process

#### Technical Stack

| Technology | Purpose |
|------------|---------|
| **TypeScript** | Primary language for all implementation |
| **Effect** | Functional effect system for type-safe error handling, concurrency, and composition ([effect.website](https://effect.website)) |
| **Claude Agent SDK** | Claude Code session management and tool execution |
| **SQLite / File-based** | Local persistence for session mapping and metadata |
| **Node.js** | Runtime environment |

#### Why Effect?

- Type-safe error handling without exceptions
- Composable async/concurrent operations
- Built-in retry, timeout, and scheduling primitives
- Structured concurrency for managing Claude sessions and Telegram polling
- Service pattern for dependency injection (Telegram client, persistence layer, Claude SDK)

---

### Functional Requirements

#### F1: Conversation Mapping

| Requirement | Description |
|-------------|-------------|
| F1.1 | Each Telegram chat corresponds to exactly one Claude Code conversation |
| F1.2 | New Telegram chat = new Claude Code session |
| F1.3 | Chat-to-session mapping persists locally (survives service restarts) |
| F1.4 | Resuming a Telegram chat resumes the associated Claude Code session |

#### F2: Message Handling

| Requirement | Description |
|-------------|-------------|
| F2.1 | User text messages are forwarded to Claude Code as user input |
| F2.2 | User image messages are passed to Claude for vision analysis |
| F2.3 | Claude text responses are sent back to Telegram as-is (markdown preserved) |
| F2.4 | Responses exceeding Telegram's limit (~4096 chars) are truncated with ellipsis (`...`) |

#### F3: Tool Call Display

| Requirement | Description |
|-------------|-------------|
| F3.1 | Tool calls are prefixed with an emoji to distinguish from regular text |
| F3.2 | Tool call display includes: tool name, parameters, and truncated result |
| F3.3 | Format: `[emoji] Tool: <name>` followed by relevant details |

#### F4: Project Context

| Requirement | Description |
|-------------|-------------|
| F4.1 | Claude operates within `~/Workspace` directory exclusively |
| F4.2 | User can request Claude work on a specific project via natural language (e.g., "work on my telegram-claude project") |
| F4.3 | Claude uses its agentic capabilities to locate and navigate to projects |
| F4.4 | One project context per conversation (not enforced programmatically, natural behavior) |

#### F5: Context Management & Continuation

| Requirement | Description |
|-------------|-------------|
| F5.1 | System monitors context usage percentage |
| F5.2 | At 80% context usage, user is prompted to start a continuation conversation |
| F5.3 | Continuation occurs within the same Telegram chat |
| F5.4 | Previous session generates a visible "handoff" message summarizing state |
| F5.5 | Handoff message is displayed to user in Telegram before new session starts |
| F5.6 | New session receives handoff message as initial context |

#### F6: Session Persistence

| Requirement | Description |
|-------------|-------------|
| F6.1 | Claude Code sessions can be resumed after service restart |
| F6.2 | Session state is saved using Claude Agent SDK's built-in persistence |
| F6.3 | If a session cannot be restored (crash, corruption), user is notified and a fresh session begins |

#### F7: Authentication & Security

| Requirement | Description |
|-------------|-------------|
| F7.1 | Bot only responds to messages from a single authorized Telegram user ID |
| F7.2 | User ID is configured via environment variable |
| F7.3 | Messages from unauthorized users are silently ignored |
| F7.4 | Claude's filesystem access is restricted to `~/Workspace` |

#### F8: Service Notifications

| Requirement | Description |
|-------------|-------------|
| F8.1 | Service startup notification sent to Telegram |
| F8.2 | Service shutdown notification sent to Telegram (when gracefully stopped) |
| F8.3 | Critical errors are reported to Telegram |
| F8.4 | Notifications are sent to the most recently active chat (or a designated status chat) |

#### F9: File Handling

| Requirement | Description |
|-------------|-------------|
| F9.1 | When Claude creates or references files, the file path is reported in Telegram |
| F9.2 | Files are NOT automatically sent as Telegram attachments |
| F9.3 | User can access files via their Mac or request Claude to read/display contents |

---

### Non-Functional Requirements

#### NF1: Performance

- Messages should begin streaming to Telegram within 2 seconds of Claude starting a response
- Service should handle concurrent operations within a single conversation gracefully

#### NF2: Reliability

- Service should recover gracefully from network interruptions
- Telegram API failures should be retried with exponential backoff
- Session state should not be corrupted by unexpected shutdowns

#### NF3: Usability

- No slash commands required; all interaction via natural language
- Claude's responses should feel identical to CLI experience
- Error messages should be clear and actionable

---

### Configuration

All configuration via environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | Yes |
| `TELEGRAM_USER_ID` | Authorized user's Telegram ID | Yes |
| `ANTHROPIC_API_KEY` | API key for Claude | Yes |
| `WORKSPACE_PATH` | Root directory for Claude (default: `~/Workspace`) | No |

---

### Technical Implementation Notes

#### Effect Architecture

The application is structured using Effect's service pattern:

```typescript
// Core services
- TelegramService: Handles bot API, message sending/receiving
- ClaudeSessionService: Manages Agent SDK sessions, tool execution
- PersistenceService: SQLite/file-based storage for session mapping
- NotificationService: Service lifecycle notifications

// Main program
- Effect.gen workflow composing all services
- Structured concurrency for parallel Telegram polling + Claude streaming
- Effect.retry for transient failures (network, API limits)
- Effect.timeout for long-running operations
```

#### Claude Agent SDK Integration

- Use the Claude Agent SDK to create and manage Claude Code sessions
- Leverage SDK's built-in session persistence/resume capabilities
- SDK handles tool execution, context management, and conversation state
- Wrap SDK calls in Effect for consistent error handling

#### Session Storage

- Local SQLite database (preferred) or JSON file store
- Schema:
  - `telegram_chat_id` → `claude_session_id` mapping
  - Session metadata: project path, context usage %, last active timestamp, working directory
- Session transcripts stored via Agent SDK's native persistence
- Effect-based repository pattern for data access

#### Telegram Bot Implementation

- Use `node-telegram-bot-api` or `telegraf` with Effect wrappers
- Long-polling for message retrieval (simpler than webhooks for local deployment)
- Message queue (Effect.Queue) for handling responses that exceed rate limits
- Effect.Stream for processing incoming messages

#### Tool Call Formatting

Example format for tool calls in Telegram:

```
🔧 Tool: Read
   File: src/index.ts
   Result: (1247 lines)
   export function main() {
     const config = loadConfig();
     ...
```

#### Continuation Flow

1. System detects 80% context usage
2. Current Claude session generates handoff summary
3. Handoff message displayed to user: "📋 Context limit approaching. Generating handoff..."
4. Summary shown in Telegram
5. New Claude session created with handoff as system context
6. User prompted: "Continuation ready. You can continue where you left off."

---

### Out of Scope (v1)

- Multiple user support
- Telegram group chat support
- Sending files from Mac to Telegram
- Slash commands
- Cancel/interrupt running operations
- Web interface or alternative clients
- Cloud deployment

---

### Future Considerations

- Voice message transcription and input
- Inline keyboard for common actions
- Multiple project contexts per conversation
- Shared team access
- Cloud-hosted option for always-on availability

---

### Success Criteria

1. User can start a new Claude Code conversation by opening a new Telegram chat
2. User can send natural language requests and receive Claude Code responses
3. Tool calls are visible with appropriate formatting
4. Conversations persist across service restarts
5. Context continuations work seamlessly within the same chat
6. Images can be sent for Claude to analyze
7. Service runs reliably on Mac with manual start
