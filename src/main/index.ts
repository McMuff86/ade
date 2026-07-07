/**
 * Electron main entry — window + app lifecycle only (no updater, no cloud).
 */

import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers, disposePtyManager } from './ipc';
import { ConfigStore } from './config/store';
import { runPtySmoke } from './pty/smoke';

let mainWindow: BrowserWindow | null = null;

// Opt-in renderer CDP endpoint for end-to-end verification (no prod impact).
const remoteDebugPort = process.env['ADE_REMOTE_DEBUG_PORT'];
if (remoteDebugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebugPort);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0E0F12',
    title: 'ade',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // open external links in the default browser, never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // dev: electron-vite serves the renderer; prod: load the built file
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// no menu clutter — keeps default shortcuts out of the way too
Menu.setApplicationMenu(null);

void app.whenReady().then(async () => {
  const store = new ConfigStore();
  registerIpcHandlers(store);
  createWindow();

  console.log('[ade] app ready — window created');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Phase A de-risk: node-pty/ConPTY smoke test, opt-in via env var
  if (process.env['ADE_PTY_SMOKE'] === '1') {
    try {
      const output = await runPtySmoke();
      console.log('[ade] pty-smoke: ade-pty-ok (marker found in ConPTY output)');
      console.log('[ade] pty-smoke output tail:', JSON.stringify(output.slice(-200)));
    } catch (err) {
      console.error('[ade] pty-smoke FAILED:', err);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// kill every live pty on quit so no orphan ConPTY process lingers
app.on('before-quit', () => {
  disposePtyManager();
});
