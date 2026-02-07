# Maslow App: Private Workspace with a Presence

## Vision

Not a messaging app. A **workspace with a thinking partner who's always in the room**. Voice-first, encrypted, with a living memory of your projects and ideas. Maslow doesn't wait to be asked — it thinks alongside you, challenges your assumptions, connects dots across projects, and manages work with you.

Built on your M4 Mac. Speaks in Robert Redford's voice. Knows your soul.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              CLIENT (Single Expo Codebase)        │
│         iOS + Android + Web from one repo         │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐      │
│  │  Talk    │  │  Review  │  │   Build    │      │
│  │  Mode    │  │  Mode    │  │   Mode     │      │
│  │(presence │  │(timeline │  │(kanban,    │      │
│  │ + voice) │  │ + synth) │  │ execution) │      │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘      │
│       └──────────┬───┴──────────────┘              │
│                  │ E2E Encrypted WS + REST         │
└──────────────────┼────────────────────────────────┘
                   │
┌──────────────────┼────────────────────────────────┐
│            MASLOW SERVER (Effect/Layer)             │
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │  AppServer.ts — HTTP/WS API              │     │
│  │  ├── Real-time chat + streaming voice    │     │
│  │  ├── Kanban CRUD + AI-driven cards       │     │
│  │  ├── Decision journal + assumption log   │     │
│  │  ├── Cross-project synthesis             │     │
│  │  ├── Message history (encrypted SQLite)  │     │
│  │  └── Auth (token, single user)           │     │
│  └──────────────────────────────────────────┘     │
│       │            │              │                │
│  ┌────┴─────┐ ┌────┴─────┐ ┌─────┴──────┐        │
│  │ Claude   │ │ Pipecat  │ │ Chatterbox │        │
│  │ CLI      │ │ Pipeline │ │ TTS API    │        │
│  │(thinking)│ │(realtime │ │(async voice│        │
│  │          │ │ voice)   │ │ + cloning) │        │
│  └──────────┘ └──────────┘ └────────────┘        │
│       │                                           │
│  ┌────┴─────────────────────────────────┐        │
│  │  Thinking Partner Layer               │        │
│  │  ├── Living project documents         │        │
│  │  ├── Assumption tracker               │        │
│  │  ├── Decision journal                 │        │
│  │  ├── Cross-project connector          │        │
│  │  ├── Proactive briefings              │        │
│  │  └── Fragment stitcher (voice/text)   │        │
│  └──────────────────────────────────────┘        │
│                                                   │
│  Existing services: Telegram, SessionManager,     │
│  Persistence, Voice, SoulLoader, ClaudeMem        │
└───────────────────────────────────────────────────┘
```

---

## Repo Structure

```
maslow/
├── apps/
│   └── mobile/                # Single Expo codebase → iOS, Android, Web
│       ├── app/               # Expo Router
│       │   ├── (tabs)/
│       │   │   ├── talk.tsx       # Presence + voice (home screen)
│       │   │   ├── review.tsx     # Timeline + synthesis
│       │   │   └── build.tsx      # Kanban + execution
│       │   ├── project/
│       │   │   └── [id].tsx       # Project thread view
│       │   └── _layout.tsx
│       ├── components/
│       │   ├── PresenceWaveform.tsx
│       │   ├── TimelineCard.tsx
│       │   ├── KanbanBoard.tsx
│       │   ├── DecisionCard.tsx
│       │   └── VoiceVisualizer.tsx
│       ├── services/
│       │   ├── api-client.ts
│       │   ├── crypto.ts
│       │   ├── voice.ts
│       │   └── notifications.ts
│       └── app.json
│
├── packages/
│   └── shared/                # Shared types, crypto, API types
│       ├── types/
│       ├── crypto/            # noble-curves X25519 + AES-256-GCM
│       └── api/
│
├── src/                       # Maslow server (existing + new)
│   ├── services/
│   │   ├── AppServer.ts       # NEW — HTTP/WS API for apps
│   │   ├── Kanban.ts          # NEW — AI-driven project board
│   │   ├── ProjectDocs.ts     # NEW — project document management
│   │   ├── ThinkingPartner.ts # NEW — synthesis, assumptions, decisions
│   │   ├── ClaudeSession.ts   # existing
│   │   ├── Voice.ts           # existing (async STT/TTS)
│   │   ├── Telegram.ts        # existing (stays as backup channel)
│   │   ├── SessionManager.ts  # existing
│   │   ├── Persistence.ts     # existing (extended for new schemas)
│   │   └── ...
│   └── index.ts
│
├── scripts/
│   ├── start-voice.sh         # existing
│   ├── setup-voice.sh         # existing
│   └── setup-pipecat.sh       # NEW — streaming voice pipeline
└── package.json
```

---

## Three Modes

### Talk Mode (Home Screen)
The default. Maslow is present.

- **Presence waveform** — organic ambient glow/pulse showing Maslow's state:
  - Warm glow = idle, listening
  - Breathing pulse = thinking
  - Active waveform = speaking
- **Tap anywhere and talk** — voice is primary, text input pulls up from bottom
- **Voice visualization** — your voice on left, Maslow on right, interweaving
- **Haptic rhythm on mobile** — gentle pulse when Maslow starts speaking, guiding conversational turns
- **Real-time voice via Pipecat** — <800ms latency on M4, streaming STT/TTS, VAD for natural turn-taking
- **Async voice notes** — Chatterbox with Redford clone for Marco Polo style when real-time isn't needed

### Review Mode (Timeline)
The curated story of your work.

- **Vertical timeline** — not chat bubbles, summary cards:
  - Conversations collapse into one-line syntheses ("Discussed Aiden auth — decided JWT")
  - Tool use is invisible by default (solves message curation)
  - Kanban movements inline ("Moved 'Voice Integration' to Done")
  - Voice calls as replayable entries
  - Files/images as visual thumbnails
- **Expand any card** for full conversation detail
- **"Things we haven't talked about"** section — Maslow's tracked assumptions and open questions per project
- **Decision journal** — every significant choice logged with context, alternatives, reasoning
- **Cross-project connections** — "The encryption pattern from the chat app applies to Aiden's patient data"

### Build Mode (Workspace)
Execution. Kanban + project threads.

- **Workspace map** — projects as visual objects, not just a list. Tap to open.
- **Each project = a full workspace** — its own conversation thread, instruction set, brief, reference docs, decisions log, assumptions register, and auto-maintained state summary. Separate Claude session with all project documents loaded as context.
- **Project docs sidebar** — swipe right in any project to see its living documents. Edit the brief, update the instruction set, review assumptions. Maslow keeps these current as you work.
- **AI-driven kanban:**
  - Maslow creates cards from conversation ("I'll track that" → card appears)
  - Maslow moves cards as work progresses
  - Cards "peel off" from chat and float to the board (microinteraction)
  - "Before we build this — is this still the right priority?" prompts on card start
- **Columns:** Backlog, In Progress, Done (customizable per project)
- **Cards:** title, description, labels, due date, linked decisions, conversation refs
- **Projects:** Maslow, Aiden, Platinum Dental, Secure Chat, and whatever else comes up

---

## Thinking Partner Layer

The intelligence that makes Maslow more than a chatbot.

### Fragment Stitcher
You drop ideas as fragments — voice notes, texts, photos. Maslow places each in project context, connects to prior thoughts, surfaces tensions with previous decisions. Nothing is lost.

### Living Project Documents
Not chat history — an evolving synthesis. Each project gets its own persistent workspace:

- **Instruction Set** — the rules of engagement for this project. Tech stack, conventions, constraints, "always do X, never do Y." Maslow follows these and updates them as decisions are made.
- **Brief** — the living design document. Starts from whatever you provide (a downloaded PDF, a voice note, a conversation), evolves as the project evolves. Not frozen — Maslow keeps it current.
- **Reference Docs** — links, screenshots, API specs, competitor analysis, inspiration. Anything you drop into a project conversation gets filed here.
- **Decisions Log** — every significant choice with context, alternatives, reasoning, and tradeoffs. Linked to the Decision Journal in Review mode.
- **Assumptions Register** — what we're betting on but haven't validated. Maslow surfaces these proactively.
- **State Summary** — auto-generated current state: what's done, what's in progress, what's blocked, what's next.

Visible in Review mode, updated continuously. When you say "work on Aiden," Maslow loads the full project context — no re-explaining.

### Devil's Advocate Mode
When brainstorming or making architecture decisions, Maslow proactively argues the other side. Learns when you want pushback (ideation) vs. execution (coding). Toggle or automatic.

### Assumption Tracker
Per-project list of unstated assumptions. "You're assuming single-user." "You're assuming local-first." Subtle cards in the Review mode — not urgent, but visible. The things you haven't examined.

### Decision Journal
Every significant choice logged:
- What was decided
- What alternatives were considered
- Why this path was chosen
- What the tradeoffs are
- What's changed since then

Six months from now: "Why did we do it this way?" → full context, not a chat search.

### Cross-Project Connector
Background process reviews all active projects, surfaces:
- Reusable work ("Build the crypto as a shared package")
- Contradictions ("You chose JWT here but sessions there")
- Pattern matches ("You solved this before in project X")

Appears as ambient notifications, not interruptions.

---

## Daily Rhythm

### Morning
Open the app. Maslow has a 90-second voice briefing ready:
"Morning. Here's where we left off. Aiden's auth module is blocked on your JWT decision. The voice integration shipped. I noticed overnight — the kanban schema won't handle recurring tasks, and Platinum Dental needs those. Want to talk about it or should I draft a fix?"

### During Work
Build mode. Maslow executes, minimal interruption. But notices when you're stuck 30 minutes on the same problem and surfaces: "You solved something similar in the session manager retry pattern. Might apply here."

### Evening
Ambient lock screen notification: "Good day. Three cards Done. One new question in the Aiden assumptions list."

### Random Moments
Driving, idea hits. Voice note from phone: "What if we open-source the voice pipeline?" Maslow stitches it into project context, creates a Backlog card. Next time you sit down, it's waiting.

---

## Notification Intelligence

Three tiers, not a firehose:

| Tier | Behavior | Examples |
|------|----------|---------|
| **Urgent** | Vibrate + sound | Build failed, critical error, time-sensitive |
| **Ambient** | Silent lock screen banner, stays until seen | Task completed, project update, connection noticed |
| **Digest** | Single morning/evening voice briefing | Where things stand, what's on deck, what Maslow noticed |

This replaces the "curate messages" task entirely. Maslow decides what deserves your attention and when.

---

## Onboarding

First app open. No tutorial. No setup wizard.

Maslow speaks, in Redford's voice: "Hey. I'm Maslow. We've been talking on Telegram — this is home now. What should we work on first?"

It already knows you from soul.md and conversation history. The relationship continues, it just moved into a better space.

---

## Microinteractions & Design Details

### Presence Waveform
Not a green dot. An organic, bioluminescent pulse in the app's accent purple (#7C5CFC). Alive in the dark. Changes shape/intensity with Maslow's state.

### Message Arrival
Messages don't pop — they *settle in*. Card placed on a table. Drop shadow, 200ms ease-out.

### Streaming Text
First words appear in real-time as Maslow generates them. Like watching someone write on a whiteboard. Not "typing..."

### Voice-to-Text Morphing
Send a voice note → waveform morphs into text as transcription completes. Fluid, no spinners.

### Card Creation from Chat
Maslow creates a kanban card → it visually "peels off" from the conversation and floats to the Build tab. You see the connection between thought and action.

### Color System (Dark Mode Default)
```
Background:       #0F0F0F (near-black)
Surface:          #1A1A1A (cards, panels)
Surface Elevated: #252525 (modals, menus)
Border:           #333333
Text Primary:     #E5E5E5
Text Secondary:   #999999
Accent:           #7C5CFC (purple — bioluminescent)
Accent Hover:     #9B7FFF
Success:          #34D399
Warning:          #FBBF24
Error:            #F87171
Sent Bubble:      #7C5CFC
Received Bubble:  #1A1A1A
AI Thinking:      #2D2044 (muted purple)
```

### Typography
```
Primary:  Inter
Mono:     JetBrains Mono (code, keys)
Chat:     15px / 1.4 line-height
Timestamp: 11px / muted
Header:   17px / semibold
AI Status: 13px / italic / accent
```

---

## Build Phases

### Phase 1: Foundation (Week 1)
Server API + encrypted storage + Expo web chat.

- `src/services/AppServer.ts` — HTTP/WS server (runs alongside Telegram bot)
  - WebSocket: real-time chat, streaming Claude responses
  - REST: auth, message history, project CRUD
  - Token auth (single user)
- Encrypted SQLite schema: messages, projects, decisions, project_documents
- `packages/shared/crypto/` — noble-curves X25519 + AES-256-GCM from day one
- Expo project at `apps/mobile/` with Expo Router
- Talk mode: basic presence screen + text chat working end-to-end
- **Validate:** Type in browser, Claude responds via WebSocket

### Phase 2: Threads + Kanban (Week 2)
Projects as conversation threads + AI-driven board.

- `src/services/Kanban.ts` — board/card CRUD, Claude tool integration
- `src/services/ThinkingPartner.ts` — decision journal, assumption tracker
- `src/services/ProjectDocs.ts` — project document management (briefs, instruction sets, references, state summaries)
- Each project = separate Claude session with full document context loaded
- Kanban UI in Build mode
- Timeline UI in Review mode (curated summaries, not raw chat)
- Maslow creates/moves cards from conversation
- **Validate:** Create project, chat in its thread, see cards move

### Phase 3: Mobile + Biometric (Week 3)
Same codebase → iOS.

- Expo build for iOS
- FaceID/biometric lock via expo-local-authentication
- Push notifications (three-tier: urgent, ambient, digest)
- Haptic feedback for conversational rhythm
- Secure key storage (expo-secure-store)
- **Validate:** Full app running on your phone, FaceID unlock

### Phase 4: Real-Time Voice (Week 4)
Phone calls with Maslow.

- Pipecat integration for streaming voice pipeline
  - Silero VAD (voice activity detection)
  - MLX Whisper (streaming STT, native Apple Silicon)
  - Kokoro TTS (sub-250ms first audio) or Chatterbox on MPS
  - WebRTC transport (SmallWebRTCTransport)
- "Call Maslow" button → presence waveform becomes call UI
- Voice visualization: your waveform left, Maslow's right
- Fix Chatterbox MPS loading for voice clone support in calls
- Async voice notes stay on Chatterbox (Redford clone)
- **Validate:** Tap, talk, hear Maslow respond in <1 second

### Phase 5: Thinking Partner + Polish (Week 5)
The intelligence layer.

- Cross-project synthesis (background process, ambient notifications)
- Morning/evening voice briefings (auto-generated digest)
- Fragment stitcher (random voice notes → placed in project context)
- Assumption surfacing per project
- Devil's advocate mode (toggle or automatic based on context)
- Decision journal UI in Review mode
- Onboarding conversation (first launch)
- Microinteraction polish (card settling, text streaming, waveform morphing)
- **Validate:** Maslow proactively surfaces a connection you didn't ask about

---

## What We Keep

- Telegram bot — quick-access backup channel, stays working
- Voice services (whisper.cpp + Chatterbox) — async voice notes + cloning
- Claude CLI integration — the thinking engine
- Effect/Layer architecture — server foundation
- soul.md — personality and relationship continuity

## What's New

- `AppServer.ts` — HTTP/WS API for apps
- `Kanban.ts` — AI-driven project management
- `ProjectDocs.ts` — per-project instruction sets, briefs, references, decisions, state summaries
- `ThinkingPartner.ts` — synthesis, assumptions, decisions, connections
- `apps/mobile/` — single Expo codebase (iOS + Android + Web)
- `packages/shared/` — types, crypto, API client
- Pipecat integration — real-time streaming voice
- Three-mode UI: Talk, Review, Build

---

## Open Decisions

1. **Pipecat TTS:** Kokoro (faster, no cloning) vs Chatterbox on MPS (slower, Redford voice). Could use Kokoro for real-time and Chatterbox for async.
2. **Expo web quality:** Expo web output may need supplementing with react-native-web tweaks for desktop polish. Evaluate in Phase 1.
3. **Claude session per project:** One long-running session or fresh sessions with handoff summaries? Current handoff system works — extend it to multi-project.
