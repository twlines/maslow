# Telegram-Claude Bridge

**Claude Code via Telegram** - Full-featured Telegram bot with autonomous operation, persistent identity, and zero API costs.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Effect](https://img.shields.io/badge/Effect-3.12-purple.svg)](https://effect.website/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Overview

Turn your Telegram into a powerful AI development assistant powered by Claude Code. This bridge enables full Claude Code functionality through Telegram with unique autonomous features:

- 🤖 **Autonomous Operation**: Hand off task briefs and let Claude work independently
- 🧠 **Persistent Identity**: soul.md file defines AI personality and behavior
- 💾 **Claude-Mem Integration**: Automatic session persistence and memory retrieval
- 💰 **Zero API Costs**: Uses Claude Code CLI OAuth authentication
- 🔄 **Smart Context Management**: Auto-handoff at 50% context usage
- 📅 **Proactive Intelligence**: Morning check-ins, evening reflections, deadline monitoring
- ⚡ **Effect.ts Architecture**: Composable, type-safe async operations

---

## Quick Start

```bash
# Prerequisites
brew install anthropics/claude/claude
claude login  # Authenticate with Claude

# Install
git clone <your-repo-url> telegram-bridge
cd telegram-bridge
# One-liner to set up everything
./scripts/setup-mac.sh
```

The script will:

1. Install dependencies (Node, Claude CLI, uv)
2. Guide you through authentication
3. Set up the environment
4. Build the project
5. Register the persistent background service

See [SETUP.md](SETUP.md) for complete installation instructions.

---

## Features

### 🤖 Autonomous Operation

**50% Context Auto-Handoff**
Automatically generates handoff summary and creates fresh session when context reaches 50% (not 80%). No manual intervention required.

**Task Brief Execution**
Send messages starting with `TASK:` or `Brief:` to trigger autonomous execution:

```
TASK: Refactor the auth service to use JWT. Update tests and docs.

→ Bot executes completely autonomously
→ Makes decisions without asking
→ Reports progress as it works
→ Stores findings in memory
```

**Memory-Driven Autonomous Worker**
Checks Claude-Mem every 15 minutes for pending tasks and executes them independently.

### 💾 Claude-Mem Integration

**Automatic Session Persistence**
Every conversation is automatically saved to Claude-Mem with:

- Session initialization on first message
- Project name extraction from current directory
- Conversation summaries stored on completion

**Memory Retrieval**
Recent context from previous sessions is automatically available for proactive intelligence features (morning check-ins, deadline monitoring).

### 🧠 Persistent Identity (soul.md)

Define your AI assistant's personality, context, and behavioral guidelines in `~/.claude-mem/soul.md`:

```markdown
# Soul

You are Trevor's personal AI assistant.

## Identity

- Name: Mazlow
- Voice: Warm, direct, technical when needed

## Behavioral Guidelines

- Be proactive about reminders
- Reference past conversations
- Push back respectfully when you disagree

## Corrections Log

_Updated automatically as you correct behaviors_
```

This file is injected into every new session, creating true persistent identity.

### 📅 Proactive Intelligence

**Morning Check-In (9am)**
Queries Claude-Mem for pending reminders and tasks to start your day.

**Evening Reflection (8pm)**
Summarizes what you worked on and captures anything left undone.

**Deadline Monitor (Every 2 Hours)**
Surfaces approaching deadlines automatically.

### 💰 Zero API Costs

Uses Claude Code CLI with OAuth authentication instead of API keys. Your existing Claude subscription covers all usage—no per-token charges!

### ⚡ Modern Tech Stack

- **Effect.ts**: Functional effects library for composable async operations
- **Telegraf**: Modern Telegram bot framework
- **Better-SQLite3**: Fast, synchronous SQLite for session persistence
- **TypeScript**: Full type safety across the codebase
- **Node Cron**: Scheduled task execution for proactive intelligence

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Telegram App                               │
│                      (Your Phone/Desktop)                         │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Telegram Bot API
┌──────────────────────────────────────────────────────────────────┐
│                      telegram-bridge                              │
│                 (Node.js on Mac Mini/Server)                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐      │
│  │ SessionManager │  │ Proactive      │  │ Autonomous     │      │
│  │ (50% handoff)  │  │ Intelligence   │  │ Worker         │      │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘      │
│          │                   │                   │                │
│          └───────────────────┼───────────────────┘                │
│                              ▼                                    │
│                   ┌────────────────┐                              │
│                   │  soul.md       │ ← Persistent Identity        │
│                   │  (injected)    │                              │
│                   └───────┬────────┘                              │
│                           ▼                                       │
│                   ┌────────────────┐                              │
│                   │  Claude CLI    │ ← OAuth (No API costs)       │
│                   │  (spawned)     │                              │
│                   └────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Documentation

- **[SETUP.md](SETUP.md)** - Complete installation and deployment guide
- **[Architecture](#architecture)** - System design and layer composition
- **[Contributing](#contributing)** - How to contribute
- **[Roadmap](#roadmap)** - Future features and plans

---

## Deployment

### macOS (launchd)

```bash
# Create daemon
cat > ~/Library/LaunchAgents/com.trevor.telegram-claude.plist << EOF
[... see SETUP.md for full template ...]
EOF

# Load service
launchctl load ~/Library/LaunchAgents/com.trevor.telegram-claude.plist
```

See [SETUP.md](SETUP.md) for complete deployment instructions including systemd for Linux.

---

## Comparison with Alternatives

| Feature                    | This Bridge                  | Angusstone7/claude-code-telegram | Custom API Integration   |
| -------------------------- | ---------------------------- | -------------------------------- | ------------------------ |
| **Auth Method**            | CLI OAuth                    | CLI OAuth                        | API Key (paid)           |
| **API Costs**              | $0                           | $0                               | $10-50/month             |
| **Autonomous Mode**        | ✅ 50% handoff               | ❌ Manual only                   | ⚠️ Custom implementation |
| **Persistent Identity**    | ✅ soul.md                   | ❌                               | ⚠️ Custom implementation |
| **Proactive Intelligence** | ✅ Morning/evening/deadlines | ❌                               | ⚠️ Custom implementation |
| **Task Brief Execution**   | ✅ Autonomous worker         | ❌                               | ⚠️ Custom implementation |
| **Tech Stack**             | TypeScript + Effect.ts       | Python + Docker                  | Varies                   |

**Why This Bridge?**

- More autonomous features than alternatives
- Modern TypeScript + Effect.ts architecture
- True persistent identity via soul.md
- Proactive intelligence built-in
- Designed for "go ham" autonomous operation

---

## Roadmap

### Completed ✅

- [x] Basic Telegram bridge with Telegraf
- [x] Claude CLI spawning and JSONL parsing
- [x] soul.md persistent identity injection
- [x] 50% context auto-handoff
- [x] Autonomous task worker
- [x] Task brief detection and execution
- [x] Proactive intelligence (morning/evening/deadlines)
- [x] SQLite session persistence
- [x] launchd deployment configuration
- [x] Claude-Mem integration (session-based API) ⭐ NEW

### Planned 📋

- [ ] Comprehensive test suite
- [ ] Voice integration (Chatterbox TTS)
- [ ] Compounding/correction system (auto-update soul.md)
- [ ] Multi-user support
- [ ] Docker deployment option

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Built with [Effect.ts](https://effect.website/) - Functional effects library
- Telegram integration via [Telegraf](https://telegraf.js.org/)
- Powered by [Claude Code](https://claude.ai/code) - Anthropic's AI coding assistant
- Inspired by [Angusstone7/claude-code-telegram](https://github.com/Angusstone7/claude-code-telegram)

---

**Made with ❤️ for autonomous AI assistants**
