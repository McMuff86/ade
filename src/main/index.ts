/**
 * Electron main entry — window + app lifecycle only (no updater, no cloud).
 */

import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpcHandlers, disposePtyManager } from './ipc';
import { ConfigStore } from './config/store';
import { runPtySmoke } from './pty/smoke';
import { registerPhotoProtocolHandler, registerPhotoProtocolScheme } from './photos';
import { isSafeExternalUrl, isTrustedRendererUrl } from './security';

// Must run before app `ready` — declares ade-photo:// as a privileged scheme.
registerPhotoProtocolScheme();
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;

// Opt-in renderer CDP endpoint for end-to-end verification (no prod impact).
const remoteDebugPort = !app.isPackaged ? process.env['ADE_REMOTE_DEBUG_PORT'] : undefined;
if (remoteDebugPort && /^\d{2,5}$/.test(remoteDebugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebugPort);
}

// Opt-in user-data override so integration runs use a clean throwaway dir
// instead of the real config/photos/workspaces (no prod impact).
const userDataOverride = process.env['ADE_USER_DATA_DIR'];
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

function createWindow(): void {
  const packagedRendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
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
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
      // CDP-driven verification runs with the window occluded; without this,
      // rAF/timers stall in the hidden renderer and terminal writes defer
      // until the window is visible again. Normal runs keep throttling on.
      backgroundThrottling: !remoteDebugPort,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open ordinary web links externally; reject custom protocols and popups.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url).catch((error) => {
        console.warn('[ade] failed to open external link:', error);
      });
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, devUrl, packagedRendererUrl)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // dev: electron-vite serves the renderer; prod: load the built file
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
  app.setAppUserModelId('com.adimuff.ade');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  const store = new ConfigStore();
  registerIpcHandlers(store);
  registerPhotoProtocolHandler();
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
