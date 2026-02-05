#!/bin/bash

# setup-mac.sh
# Automated setup for Telegram-Claude Bridge on macOS

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Telegram-Claude Bridge Setup ===${NC}"

# 1. Check Prereqs
echo -e "\n${YELLOW}[1/6] Checking prerequisites...${NC}"

if ! command -v brew &> /dev/null; then
    echo -e "${RED}Error: Homebrew not found. Please install Homebrew first.${NC}"
    exit 1
fi

# Check/Install Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    brew install node
else
    echo "✓ Node.js found ($(node -v))"
fi

# Check/Install Claude CLI
if ! command -v claude &> /dev/null; then
    echo "Installing Claude CLI..."
    brew install anthropics/claude/claude
else
    echo "✓ Claude CLI found"
fi

# Check/Install uv (for uvx)
if ! command -v uv &> /dev/null; then
    echo "Installing uv (for semantic search)..."
    brew install uv
else
    echo "✓ uv found (for semantic search)"
fi

# 2. Install Project Dependencies
echo -e "\n${YELLOW}[2/6] Installing project dependencies...${NC}"
npm install

# 3. Environment Setup
echo -e "\n${YELLOW}[3/6] Configuring environment...${NC}"

if [ ! -f .env ]; then
    echo "Creating .env from example..."
    cp .env.example .env
    
    echo -e "${GREEN}Please enter your Telegram Bot Token (from @BotFather):${NC}"
    read -r BOT_TOKEN
    
    echo -e "${GREEN}Please enter your Telegram User ID (from @userinfobot):${NC}"
    read -r USER_ID
    
    # Escape special chars for sed
    ESCAPED_TOKEN=$(printf '%s\n' "$BOT_TOKEN" | sed -e 's/[\/&]/\\&/g')
    
    sed -i '' "s/YOUR_BOT_TOKEN_HERE/$ESCAPED_TOKEN/" .env
    sed -i '' "s/YOUR_USER_ID_HERE/$USER_ID/" .env
    sed -i '' "s|CLAUDE_MEM_URL=.*|CLAUDE_MEM_URL=http://localhost:37777|" .env
    
    echo "✓ .env configured"
else
    echo "✓ .env already exists"
fi

# Ensure Claude-Mem settings
sed -i '' "s|# CLAUDE_MEM_URL=http://localhost:37777|CLAUDE_MEM_URL=http://localhost:37777|" .env

# 4. Authentication Check
echo -e "\n${YELLOW}[4/6] Verifying Claude authentication...${NC}"
echo "We need to verify you are logged in to Claude CLI."
echo "Running a test command..."

if ! claude "test" --max-tokens 1 &> /dev/null; then
    echo -e "${YELLOW}Not logged in. Opening browser for OAuth...${NC}"
    claude login
else
    echo "✓ Claude authentication verified"
fi

# 5. Build
echo -e "\n${YELLOW}[5/6] Building project...${NC}"
npm run build

# 6. Service Setup
echo -e "\n${YELLOW}[6/6] Launchd Service Setup...${NC}"
SERVICE_NAME="com.trevor.telegram-claude"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"

read -p "Do you want to install as a background service (launchd)? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Generate plist
    NODE_PATH=$(which node)
    CURRENT_DIR=$(pwd)
    USER_HOME=$HOME
    
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$SERVICE_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$CURRENT_DIR/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$CURRENT_DIR</string>
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
        <string>$PATH</string>
    </dict>
</dict>
</plist>
EOF
    
    echo "Generated plist at $PLIST_PATH"
    
    # Reload service
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load "$PLIST_PATH"
    
    echo -e "${GREEN}✓ Service installed and started!${NC}"
    echo "Logs: tail -f /tmp/telegram-claude.log"
else
    echo "Skipping service setup."
    echo "You can run the bot manually with: npm start"
fi

echo -e "\n${GREEN}=== Setup Complete! ===${NC}"
