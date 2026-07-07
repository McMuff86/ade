/**
 * PtyManager — owns every live terminal session (Phase B1).
 *
 * One node-pty process per session (ConPTY on Windows). The launched CLI *is*
 * the PTY process: when it exits, the session is `exited`. Each session keeps a
 * 256 KB ring buffer of raw output so scrollback survives tab switches and
 * renderer remounts — the pattern is ported from Superset's pty-daemon
 * SessionStore (ring buffer + replay-on-attach), minus its POSIX-only
 * fd-handoff process model. We are Windows-first: node-pty lives here in main.
 *
 * Gotchas carried over from Phase A:
 * - node-pty 1.1.0 ships prebuilds that work under Electron 43 — never force a
 *   source rebuild.
 * - pty.kill() on ConPTY prints a harmless "AttachConsole failed" stderr trace.
 * - PowerShell profile load can take ~3.5s before the first prompt appears.
 */

import { BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as pty from 'node-pty';
import { IPC_EVENTS } from '../../shared/ipc';
import { resolveLaunchCommand, LAUNCH_PROFILES } from '../../shared/runtimes';
import type { Agent, SessionMeta } from '../../shared/types';
import type { ConfigStore } from '../config/store';
import { injectMemoryBlock } from '../memory/inject';

/** Ring-buffer cap per session — enough to redraw a full agent TUI on attach. */
const RING_BUFFER_CAP = 256 * 1024;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

interface Session {
  meta: SessionMeta;
  proc: pty.IPty;
  /** FIFO of raw output chunks, capped by total byte size (RING_BUFFER_CAP). */
  buffer: Buffer[];
  bufferBytes: number;
}

let sessionSeq = 0;

export class PtyManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly store: ConfigStore) {}

  /* --------------------------------------------------------------- create */

  /**
   * Spawn a session for an agent. Resolves the launch command from the agent's
   * runtime × permission mode (customCommand / ${model} handled in
   * shared/runtimes.ts), spawns it in the agent's workspaceDir, and starts
   * streaming output to the renderer. Throws if the agent is unknown.
   */
  create(agentId: string): SessionMeta {
    const agent = this.store.get().agents.find((a) => a.id === agentId);
    if (!agent) {
      throw new Error(`pty:create — unknown agent "${agentId}"`);
    }

    // Phase D: regenerate the managed memory block in CLAUDE.md/AGENTS.md before
    // the CLI reads it. Fail-soft — a memory hiccup must never block a session.
    try {
      injectMemoryBlock(agent, this.store.get().settings.memory);
    } catch (err) {
      console.warn(`[ade] memory inject failed for agent=${agentId}:`, err);
    }

    const cwd = this.resolveCwd(agent);
    const { file, args } = this.resolveSpawn(agent);

    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      useConpty: true, // ConPTY on Windows; ignored on POSIX
    });

    const id = `s${Date.now().toString(36)}${(sessionSeq++).toString(36)}`;
    const meta: SessionMeta = {
      id,
      agentId,
      title: LAUNCH_PROFILES[agent.runtime]?.label ?? 'Shell',
      status: 'running',
      createdAt: Date.now(),
    };
    const session: Session = { meta, proc, buffer: [], bufferBytes: 0 };
    this.sessions.set(id, session);

    proc.onData((data) => {
      const chunk = Buffer.from(data, 'utf8');
      this.appendToRing(session, chunk);
      this.broadcast(IPC_EVENTS.PtyData, {
        sessionId: id,
        dataBase64: chunk.toString('base64'),
      });
    });

    proc.onExit(({ exitCode }) => {
      session.meta.status = 'exited';
      this.broadcast(IPC_EVENTS.PtyExit, { sessionId: id, exitCode });
    });

    console.log(
      `[ade] pty:create ${id} agent=${agentId} runtime=${agent.runtime} ` +
        `file=${file} args=${JSON.stringify(args)} cwd=${cwd}`,
    );
    return meta;
  }

  /* ---------------------------------------------------------------- write */

  write(sessionId: string, data: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status === 'exited') return;
    session.proc.write(data.toString('utf8'));
  }

  /* --------------------------------------------------------------- resize */

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.meta.status === 'exited') return;
    if (cols < 1 || rows < 1) return;
    try {
      session.proc.resize(cols, rows);
    } catch (err) {
      // resize can race a just-exited pty; harmless
      console.warn(`[ade] pty:resize ${sessionId} failed:`, err);
    }
  }

  /* ----------------------------------------------------------------- kill */

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.proc.kill();
      // ConPTY prints a harmless "AttachConsole failed" stderr trace here.
    } catch {
      /* already dead */
    }
    // status flips to 'exited' via the onExit handler, which also emits pty:exit
  }

  /* --------------------------------------------------------------- attach */

  /** Ring-buffer replay of raw output since spawn (base64), for (re)attach. */
  attach(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';
    return Buffer.concat(session.buffer, session.bufferBytes).toString('base64');
  }

  /* ------------------------------------------------------- lifecycle utils */

  /** Kill every live pty — call on app quit so no orphan ConPTY lingers. */
  disposeAll(): void {
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        /* already dead */
      }
    }
    this.sessions.clear();
  }

  /* -------------------------------------------------------------- internal */

  private appendToRing(session: Session, chunk: Buffer): void {
    session.buffer.push(chunk);
    session.bufferBytes += chunk.byteLength;
    while (session.bufferBytes > RING_BUFFER_CAP && session.buffer.length > 0) {
      const head = session.buffer.shift();
      if (head) session.bufferBytes -= head.byteLength;
    }
  }

  private resolveCwd(agent: Agent): string {
    const dir = agent.workspaceDir && agent.workspaceDir.trim().length > 0
      ? agent.workspaceDir
      : os.homedir();
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[ade] pty:create — could not create workspaceDir ${dir}:`, err);
    }
    return dir;
  }

  /**
   * Turn the resolved launch command into a spawnable (file, args).
   * The empty command (shell runtime) spawns the user's interactive shell.
   * A real command is run *through* the shell so PATH-based CLI shims resolve
   * on Windows (claude.cmd, codex.cmd, …) and the session ends when it exits.
   */
  private resolveSpawn(agent: Agent): { file: string; args: string[] } {
    const command = resolveLaunchCommand(agent);
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');

    if (command.trim().length === 0) {
      return { file: shell, args: [] };
    }
    if (isWin) {
      return { file: shell, args: ['-NoLogo', '-Command', command] };
    }
    return { file: shell, args: ['-l', '-c', command] };
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }
}
