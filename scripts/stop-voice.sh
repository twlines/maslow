#!/bin/bash
# Stop local voice services

echo "Stopping voice services..."

# Stop whisper server
pkill -f "whisper-server" 2>/dev/null && echo "Stopped whisper.cpp server" || echo "whisper.cpp server not running"

# Stop chatterbox
pkill -f "chatterbox-tts-api/main.py" 2>/dev/null && echo "Stopped Chatterbox TTS API" || echo "Chatterbox TTS API not running"

echo "Done."
