# Telegram-Claude

Access Claude Code from your iPhone via Telegram.

A local bridge service that enables full Claude Code functionality through a private Telegram bot, allowing mobile access to Claude Code for software development tasks.

## Features

- **Full Claude Code access** - All CLI capabilities available via Telegram
- **Session persistence** - Conversations survive service restarts
- **Image support** - Send images for Claude to analyze
- **Tool call visibility** - See what tools Claude is using with formatted output
- **Context continuation** - Automatic handoff when approaching context limits
- **Natural language only** - No slash commands, just chat

## Requirements

- macOS
- Node.js
- A Telegram bot (create via [@BotFather](https://t.me/BotFather))
- Anthropic API key

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_USER_ID=your_telegram_user_id
ANTHROPIC_API_KEY=your_anthropic_api_key
WORKSPACE_PATH=~/Workspace  # optional, defaults to ~/Workspace
```

To find your Telegram user ID, message [@userinfobot](https://t.me/userinfobot).

## Usage

```bash
npm start
```

Then open a chat with your bot on Telegram and start sending messages. Each Telegram chat maps to a Claude Code session.

### Example Interactions

- "Work on my telegram-claude project"
- "What files are in the src directory?"
- "Add error handling to the main function"
- Send a screenshot for Claude to analyze

### Tool Call Display

Tool calls appear formatted in Telegram:

```
🔧 Tool: Read
   File: src/index.ts
   Result: (1247 lines)
```

## Architecture

Built with TypeScript and Effect for type-safe, composable async operations.

| Component | Purpose |
|-----------|---------|
| TelegramService | Bot API, message handling |
| ClaudeSessionService | Agent SDK session management |
| PersistenceService | SQLite storage for session mapping |
| NotificationService | Service lifecycle notifications |

## Limitations

- Single user only (private bot)
- Claude restricted to `~/Workspace` directory
- No file attachments from Mac to Telegram
- No operation cancellation

## License

MIT
