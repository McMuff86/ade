/**
 * One ADE-managed window per agent dashboard. The page runs in its own
 * persistent partition (logins survive restarts) with the same deny-all
 * permission posture as the main renderer. Navigation is locked to the
 * dashboard's origin; everything else leaves through the system browser.
 */

import { BrowserWindow, app, session, shell } from 'electron';
import { isSafeExternalUrl } from '../security';

interface DashboardEntry {
  win: BrowserWindow;
  /** Mutable: reopening with a reconfigured dashboard moves the lock. */
  allowedOrigin: string;
}

export class DashboardWindows {
  private readonly entries = new Map<string, DashboardEntry>();
  private readonly hardenedPartitions = new Set<string>();

  open(agentId: string, agentName: string, url: URL): void {
    const existing = this.entries.get(agentId);
    if (existing && !existing.win.isDestroyed()) {
      existing.allowedOrigin = url.origin;
      void existing.win.loadURL(url.toString());
      existing.win.focus();
      return;
    }

    const partition = `persist:ade-dashboard-${agentId}`;
    if (!this.hardenedPartitions.has(partition)) {
      const dashboardSession = session.fromPartition(partition);
      dashboardSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
      });
      dashboardSession.setPermissionCheckHandler(() => false);
      this.hardenedPartitions.add(partition);
    }

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      backgroundColor: '#0E0F12',
      title: `ade · ${agentName} dashboard`,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        devTools: !app.isPackaged,
      },
    });
    // The page must never retitle the window into impersonating ADE UI.
    win.on('page-title-updated', (event) => event.preventDefault());

    const entry: DashboardEntry = { win, allowedOrigin: url.origin };
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isSafeExternalUrl(target)) {
        void shell.openExternal(target).catch((error) => {
          console.warn('[ade] dashboard external link failed:', error);
        });
      }
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
      let origin: string | null = null;
      try {
        origin = new URL(target).origin;
      } catch {
        origin = null;
      }
      if (origin === entry.allowedOrigin) return;
      event.preventDefault();
      if (origin && isSafeExternalUrl(target)) {
        void shell.openExternal(target).catch((error) => {
          console.warn('[ade] dashboard external link failed:', error);
        });
      }
    });
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.on('closed', () => {
      if (this.entries.get(agentId)?.win === win) this.entries.delete(agentId);
    });

    this.entries.set(agentId, entry);
    void win.loadURL(url.toString());
  }
}
