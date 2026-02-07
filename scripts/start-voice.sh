#!/bin/bash
# Start local voice services (whisper.cpp STT + Chatterbox TTS)
# Both run in the background. Use 'scripts/stop-voice.sh' to stop them.

set -e

WHISPER_DIR="$HOME/whisper.cpp"
CHATTERBOX_DIR="$HOME/chatterbox-tts-api"
VENV_DIR="$HOME/chatterbox-venv"
WHISPER_MODEL="base.en"
WHISPER_PORT=8080
CHATTERBOX_PORT=4123

LOG_DIR="$HOME/.maslow/logs"
mkdir -p "$LOG_DIR"

# Start whisper.cpp server
if lsof -i ":$WHISPER_PORT" -sTCP:LISTEN > /dev/null 2>&1; then
  echo "whisper.cpp server already running on port $WHISPER_PORT"
else
  echo "Starting whisper.cpp server on port $WHISPER_PORT..."
  "$WHISPER_DIR/build/bin/whisper-server" \
    --model "$WHISPER_DIR/models/ggml-${WHISPER_MODEL}.bin" \
    --host 127.0.0.1 \
    --port "$WHISPER_PORT" \
    --inference-path "/v1/audio/transcriptions" \
    --convert \
    > "$LOG_DIR/whisper.log" 2>&1 &
  echo "  PID: $! (log: $LOG_DIR/whisper.log)"
fi

# Start Chatterbox TTS API server
if lsof -i ":$CHATTERBOX_PORT" -sTCP:LISTEN > /dev/null 2>&1; then
  echo "Chatterbox TTS API already running on port $CHATTERBOX_PORT"
else
  echo "Starting Chatterbox TTS API on port $CHATTERBOX_PORT..."
  source "$VENV_DIR/bin/activate"
  cd "$CHATTERBOX_DIR"
  PORT="$CHATTERBOX_PORT" HOST="127.0.0.1" \
    python3.11 main.py \
    > "$LOG_DIR/chatterbox.log" 2>&1 &
  echo "  PID: $! (log: $LOG_DIR/chatterbox.log)"
fi

echo ""
echo "Voice services starting. Check logs at $LOG_DIR/"
echo "  STT: http://localhost:$WHISPER_PORT/v1/audio/transcriptions"
echo "  TTS: http://localhost:$CHATTERBOX_PORT/v1/audio/speech"
