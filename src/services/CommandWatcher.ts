/**
 * CommandWatcher — Firestore-based remote control channel.
 *
 * DESIGN INTENT: Lets Trevor issue commands to the Mac Mini by writing to a
 * Firestore collection from any Maslow surface (dashboard, other agent, etc.).
 * Only commands whose `requestedByTelegramId` matches the configured
 * TELEGRAM_USER_ID are executed — all others are rejected and marked as error.
 *
 * Supported commands:
 *   git-pull             — git pull origin main in WORKSPACE_PATH
 *   restart-orchestrator — launchctl kill SIGTERM the maslow-orchestrator service
 *   restart-self         — launchctl kill SIGTERM the telegram-claude service (self)
 *   shell                — arbitrary shell (ONLY if payload is whitelisted)
 *
 * The collection schema (maslow_commands/{id}):
 *   type:                  CommandType
 *   payload?:              string
 *   requestedByTelegramId: number   // must match TELEGRAM_USER_ID
 *   requestedAt:           number   // ms epoch
 *   status:                'pending' | 'running' | 'done' | 'error'
 *   result?:               string
 *   completedAt?:          number
 */

import { execSync } from 'node:child_process';
import type { Firestore } from 'firebase-admin/firestore';

// ─── Types ───────────────────────────────────────────────────────────────────

type CommandType = 'git-pull' | 'restart-orchestrator' | 'restart-self';

interface MaslowCommand {
  type: CommandType;
  payload?: string;
  requestedByTelegramId: number;
  requestedAt: number;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  completedAt?: number;
}

const COMMANDS_COLLECTION = 'maslow_commands';

// ─── Executor ────────────────────────────────────────────────────────────────

function execCommand(type: CommandType, workspacePath: string): string {
  switch (type) {
    case 'git-pull':
      return execSync(`git -C "${workspacePath}" pull origin main`, {
        timeout: 60_000,
        encoding: 'utf-8',
      }).trim();

    case 'restart-orchestrator':
      // The orchestrator launchd service label on the Mac Mini
      execSync(
        'launchctl kill SIGTERM gui/$(id -u)/com.teamaiden.maslow-orchestrator',
        { timeout: 10_000, shell: '/bin/zsh' },
      );
      return 'SIGTERM sent to com.teamaiden.maslow-orchestrator';

    case 'restart-self':
      // Schedule self-restart 2s in the future so we can write the result first
      setTimeout(() => {
        execSync(
          'launchctl kill SIGTERM gui/$(id -u)/com.trevor.telegram-claude',
          { timeout: 10_000, shell: '/bin/zsh' },
        );
      }, 2000);
      return 'SIGTERM scheduled for com.trevor.telegram-claude (in 2s)';

    default:
      throw new Error(`Unknown command type: ${type}`);
  }
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

export class CommandWatcher {
  private unsubscribe?: () => void;

  constructor(
    private readonly db: Firestore,
    private readonly authorizedTelegramId: number,
    private readonly workspacePath: string,
  ) {}

  start(): void {
    console.log(
      `[CommandWatcher] Listening on ${COMMANDS_COLLECTION} (authorized: ${this.authorizedTelegramId})`,
    );

    this.unsubscribe = this.db
      .collection(COMMANDS_COLLECTION)
      .where('status', '==', 'pending')
      .onSnapshot(
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type !== 'added' && change.type !== 'modified') continue;
            void this.handleCommand(change.doc.id, change.doc.data() as MaslowCommand);
          }
        },
        (err) => {
          console.error('[CommandWatcher] Snapshot error:', err);
        },
      );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    console.log('[CommandWatcher] Stopped.');
  }

  private async handleCommand(docId: string, command: MaslowCommand): Promise<void> {
    const ref = this.db.collection(COMMANDS_COLLECTION).doc(docId);

    // ─── Authorization check ─────────────────────────────────────────────────
    if (command.requestedByTelegramId !== this.authorizedTelegramId) {
      console.warn(
        `[CommandWatcher] Rejected command from unauthorized id ${command.requestedByTelegramId}`,
      );
      await ref.set(
        { status: 'error', result: 'Unauthorized', completedAt: Date.now() },
        { merge: true },
      );
      return;
    }

    // ─── Mark running ────────────────────────────────────────────────────────
    await ref.set({ status: 'running' }, { merge: true });

    try {
      console.log(`[CommandWatcher] Executing: ${command.type}`);
      const result = execCommand(command.type, this.workspacePath);
      console.log(`[CommandWatcher] Done: ${result}`);
      await ref.set(
        { status: 'done', result, completedAt: Date.now() },
        { merge: true },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CommandWatcher] Failed: ${msg}`);
      await ref.set(
        { status: 'error', result: msg, completedAt: Date.now() },
        { merge: true },
      );
    }
  }
}
