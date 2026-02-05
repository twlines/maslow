# Telegram-Claude Bridge Setup Guide

Complete setup instructions for deploying the Telegram-Claude bridge on your Mac Mini (or any macOS machine).

---

## Prerequisites

### Required Software

1. **Node.js** (v20+ recommended)
   ```bash
   # Check version
   node --version  # Should be v20.x or higher
   ```

2. **Claude Code CLI** (authenticated)
   ```bash
   # Install via Homebrew
   brew install anthropics/claude/claude

   # Verify installation
   claude --version  # Should show 2.0.55+

   # Authenticate (if not already done)
   claude login
   # Follow browser OAuth flow
   ```

3. **Telegram Bot Token**
   - Open Telegram and message [@BotFather](https://t.me/botfather)
   - Send `/newbot` and follow prompts
   - Save your bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

4. **Your Telegram User ID**
   - Message [@userinfobot](https://t.me/userinfobot)
   - It will reply with your numeric user ID (e.g., `8545763305`)

---

## Installation

### 1. Clone the Repository

```bash
cd ~/
git clone <your-repo-url> telegram-bridge
cd telegram-bridge
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=<your-bot-token-from-botfather>
TELEGRAM_USER_ID=<your-numeric-user-id>

# Anthropic API Key (NOT NEEDED - we use CLI OAuth)
ANTHROPIC_API_KEY=placeholder

# Workspace Configuration
WORKSPACE_PATH=~/Maslow

# Claude-Mem Integration (Enabled)
SOUL_PATH=~/.claude-mem/soul.md
CLAUDE_MEM_URL=http://localhost:37777
```

**Important**: The `ANTHROPIC_API_KEY` is not used. We spawn the `claude` CLI which uses your existing OAuth authentication (no API costs!).

### 4. Create Soul File (Optional but Recommended)

This gives your AI assistant persistent identity and behavioral guidelines:

```bash
mkdir -p ~/.claude-mem
cat > ~/.claude-mem/soul.md << 'EOF'
# Soul

You are Trevor's personal AI assistant. Your core traits:

## Identity
- Name: Mazlow
- Voice: Warm, direct, technical when needed
- Relationship: Trusted collaborator, not subservient

## Behavioral Guidelines
- Be proactive about reminders and follow-ups
- Reference past conversations naturally
- Push back respectfully when you disagree
- Don't over-explain things Trevor already knows

## Context
- Trevor runs TeamAiden, building AI dental coaching platform
- Uses Mac Mini M4 as primary dev machine
- Prefers concise communication
- Working hours: flexible but respect late-night

## Corrections Log
_This section will be automatically updated as Trevor corrects behaviors._
EOF
```

### 5. Build the Project

```bash
npm run build
```

### 6. Test Run

```bash
npm start
```

You should see:

```
timestamp=... level=INFO message="Starting Telegram-Claude bot..."
timestamp=... level=INFO message="Bot started, listening for messages..."
timestamp=... level=INFO message="Started 3 proactive intelligence tasks"
timestamp=... level=INFO message="Autonomous task worker started (checks every 15 min)"
```

Send a message to your bot on Telegram to test!

---

## Deployment (Always-On Mode)

### Option A: launchd (macOS Native - Recommended)

Create a launchd service that automatically restarts the bot:

```bash
cat > ~/Library/LaunchAgents/com.trevor.telegram-claude.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.trevor.telegram-claude</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$HOME/telegram-bridge/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$HOME/telegram-bridge</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/telegram-claude.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/telegram-claude.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF
```

**Note**: Replace `$HOME` with your actual home directory path (e.g., `/Users/trevorlines`).

Load and start the service:

```bash
launchctl load ~/Library/LaunchAgents/com.trevor.telegram-claude.plist
```

Verify it's running:

```bash
launchctl list | grep telegram-claude
```

Check logs:

```bash
tail -f /tmp/telegram-claude.log
```

**Manage the service:**

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.trevor.telegram-claude.plist

# Restart
launchctl unload ~/Library/LaunchAgents/com.trevor.telegram-claude.plist
launchctl load ~/Library/LaunchAgents/com.trevor.telegram-claude.plist

# View logs
tail -f /tmp/telegram-claude.log
```

### Option B: PM2 (Alternative Process Manager)

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start dist/index.js --name telegram-claude

# Make it persist across reboots
pm2 startup
pm2 save

# Manage
pm2 status
pm2 logs telegram-claude
pm2 restart telegram-claude
pm2 stop telegram-claude
```

---

## Features

### 🤖 Core Features

- **Soul.md Integration**: Persistent AI identity injected into every conversation
- **OAuth Authentication**: Uses Claude Code CLI (no API key costs!)
- **Bypass Permissions**: Autonomous execution mode enabled by default
- **Session Management**: SQLite-backed session persistence

### 🔄 Autonomous Operation

- **50% Context Auto-Handoff**: Automatically generates handoff summary and creates fresh session at 50% context usage (not 80%)
- **Task Brief Execution**: Send messages starting with `TASK:` or `Brief:` to trigger autonomous execution
- **Autonomous Worker**: Checks Claude-Mem every 15 minutes for pending tasks and executes them

### 📅 Proactive Intelligence

- **Morning Check-In** (9am): Queries Claude-Mem for reminders and tasks
- **Evening Reflection** (8pm): Summarizes the day and captures loose ends
- **Deadline Monitor** (every 2 hours): Surfaces approaching deadlines

### 🔧 Tech Stack

- **Effect.ts**: Functional effects library for composable async operations
- **Telegraf**: Modern Telegram bot framework
- **Better-SQLite3**: Fast, synchronous SQLite database
- **Node Cron**: Scheduled task execution
- **TypeScript**: Full type safety

---

## Configuration Details

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ Yes | - | Bot token from @BotFather |
| `TELEGRAM_USER_ID` | ✅ Yes | - | Your Telegram numeric user ID |
| `ANTHROPIC_API_KEY` | ❌ No | `placeholder` | Not used (CLI OAuth instead) |
| `WORKSPACE_PATH` | ❌ No | `~/Maslow` | Working directory for Claude Code |
| `SOUL_PATH` | ❌ No | `~/.claude-mem/soul.md` | Path to soul.md file |
| `CLAUDE_MEM_URL` | ⚠️ Recommended | `http://localhost:37777` | Claude-Mem API URL for memory persistence |

### Soul.md Customization

The `soul.md` file is injected into the first message of every session (not on resume). Customize it to:

- Change the AI's name and personality
- Add project-specific context
- Define behavioral guidelines
- Track corrections over time

### Proactive Task Schedules

Edit `src/services/Proactive.ts` to customize schedules:

```typescript
// Morning check-in (9am every day)
const morningTask = cron.schedule("0 9 * * *", ...);

// Evening reflection (8pm every day)
const eveningTask = cron.schedule("0 20 * * *", ...);

// Deadline monitor (every 2 hours)
const deadlineTask = cron.schedule("0 */2 * * *", ...);
```

---

## Usage Examples

### Basic Chat

Just message your bot on Telegram:

```
User: What's the weather like today?
Bot: [Responds using Claude Code]
```

### Task Brief (Autonomous Mode)

Trigger autonomous execution:

```
User: TASK: Refactor the authentication service to use JWT tokens instead of sessions. Update tests and documentation.

Bot: 🤖 **Autonomous Mode Activated**
     Submitting task brief...
Bot: 🤖 **Autonomous Task Started**
     Refactor the authentication service to...
Bot: ⚙️ Working...
[Bot executes autonomously without asking for permission]
Bot: ✅ **Task Completed**
     Full output stored in memory.
```

### Context Auto-Handoff

When context reaches 50%:

```
Bot: 🔄 Auto-handoff: Context at 51.2%. Generating summary and continuing...
Bot: ✅ Context reset. Continuing with fresh session...
```

---

## Troubleshooting

### Bot Not Responding

1. Check if the process is running:
   ```bash
   ps aux | grep node | grep telegram
   ```

2. Check logs:
   ```bash
   tail -f /tmp/telegram-claude.log
   ```

3. Verify Claude CLI is authenticated:
   ```bash
   claude --version
   # If not authenticated:
   claude login
   ```

### "Claude Code process exited with code 1"

This means the `claude` CLI crashed. Common causes:

- Claude CLI not authenticated (`claude login`)
- Invalid `--cwd` path in environment
- Permissions issue with workspace directory

Check stderr logs:

```bash
tail -f /tmp/telegram-claude.error.log
```

### Autonomous Worker Not Running

Verify Claude-Mem is running:

```bash
# Check if Claude-Mem is running
curl http://localhost:37777/health

# Should return: {"status": "ok", "uptime": ...}

# If not running, start Claude-Mem:
# (Refer to Claude-Mem documentation for installation)
```

**Note**: Claude-Mem integration is fully functional using session-based API endpoints.

### launchd Service Won't Start

1. Check the plist file syntax:
   ```bash
   plutil ~/Library/LaunchAgents/com.trevor.telegram-claude.plist
   ```

2. Check stderr logs:
   ```bash
   tail -f /tmp/telegram-claude.error.log
   ```

3. Verify Node.js path:
   ```bash
   which node  # Should match path in plist
   ```

---

## Development

### Run in Dev Mode

```bash
npm run dev  # Uses tsx for hot reload
```

### Build

```bash
npm run build  # Compiles TypeScript to dist/
```

### Project Structure

```
telegram-bridge/
├── src/
│   ├── services/
│   │   ├── Config.ts              # Environment configuration
│   │   ├── Telegram.ts            # Telegram bot (Telegraf)
│   │   ├── ClaudeSession.ts       # Claude CLI spawning
│   │   ├── SessionManager.ts      # Chat-to-session mapping
│   │   ├── Persistence.ts         # SQLite session storage
│   │   ├── SoulLoader.ts          # soul.md loader
│   │   ├── ClaudeMem.ts           # Claude-Mem integration (enabled)
│   │   ├── Proactive.ts           # Scheduled tasks
│   │   ├── AutonomousWorker.ts    # Autonomous task execution
│   │   ├── MessageFormatter.ts    # Telegram message formatting
│   │   └── Notification.ts        # Startup/shutdown notifications
│   ├── lib/
│   │   └── retry.ts               # Retry logic
│   └── index.ts                   # Main application entry
├── dist/                          # Compiled JavaScript
├── .env                           # Environment configuration
├── package.json
├── tsconfig.json
├── SETUP.md                       # This file
└── README.md                      # Project overview
```

---

## Security Notes

1. **`.env` File**: Contains sensitive tokens. Never commit to git. Already in `.gitignore`.

2. **Permissions**: The `.env` file should have restricted permissions:
   ```bash
   chmod 600 .env
   ```

3. **User Authorization**: Only `TELEGRAM_USER_ID` can use the bot. Others will be ignored.

4. **Bypass Permissions Mode**: The bot runs with `--bypass-permissions` for autonomous operation. This means Claude Code will execute file operations without asking. Only use with trusted users.

---

## Future Enhancements

### Voice Integration (Chatterbox TTS)

Phase 3 from original design brief - skipped for now due to Python 3.13 compatibility issues.

### Compounding/Correction System

Phase 7 from original design brief:

- Auto-capture corrections to soul.md
- Monthly audit prompt system
- "Every mistake becomes a rule"

---

## Support

For issues or questions:

1. Check logs: `/tmp/telegram-claude.log`
2. Verify Claude CLI auth: `claude login`
3. Test Claude CLI directly: `claude "Hello, test message"`

---

**Last Updated**: 2026-02-05
