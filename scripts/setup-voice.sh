#!/bin/bash
# Setup script for local voice services (whisper.cpp + Chatterbox TTS)
# Run once to install everything needed for voice integration.

set -e

WHISPER_DIR="$HOME/whisper.cpp"
CHATTERBOX_DIR="$HOME/chatterbox-tts-api"
VENV_DIR="$HOME/chatterbox-venv"
WHISPER_MODEL="base.en"

echo "=== Setting up voice services ==="

# 1. whisper.cpp (STT)
if [ -f "$WHISPER_DIR/build/bin/whisper-server" ]; then
  echo "whisper.cpp already built."
else
  echo "Building whisper.cpp..."
  if [ ! -d "$WHISPER_DIR" ]; then
    git clone https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
  fi
  cd "$WHISPER_DIR"
  cmake -B build
  cmake --build build -j --config Release
  echo "whisper.cpp built successfully."
fi

# Download model
if [ -f "$WHISPER_DIR/models/ggml-${WHISPER_MODEL}.bin" ]; then
  echo "Whisper model '$WHISPER_MODEL' already downloaded."
else
  echo "Downloading whisper model '$WHISPER_MODEL'..."
  bash "$WHISPER_DIR/models/download-ggml-model.sh" "$WHISPER_MODEL"
fi

# 2. Chatterbox TTS API (TTS)
if [ -d "$CHATTERBOX_DIR" ]; then
  echo "Chatterbox TTS API already cloned."
else
  echo "Cloning Chatterbox TTS API..."
  git clone https://github.com/travisvn/chatterbox-tts-api.git "$CHATTERBOX_DIR"
fi

# Python venv
if [ -d "$VENV_DIR" ]; then
  echo "Python venv already exists."
else
  echo "Creating Python 3.11 venv..."
  python3.11 -m venv "$VENV_DIR"
fi

echo "Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu -q
pip install -r "$CHATTERBOX_DIR/requirements.txt" -q

echo ""
echo "=== Setup complete ==="
echo "Run 'scripts/start-voice.sh' to start voice services."
