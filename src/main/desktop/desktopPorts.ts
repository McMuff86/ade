/**
 * The Electron desktop's implementations of the host ports (Goal 34.6, H1d).
 *
 * Behaviour is exactly what ipc.ts did inline before: nativeImage decoding,
 * safeStorage, powerSaveBlocker, login items, app.relaunch and app metadata. The host only
 * sees the port interfaces from host/ports.ts.
 */
import { app, nativeImage, powerSaveBlocker, safeStorage } from 'electron';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { t as translate } from '../../shared/i18n';
import { isSafeStorageSecure } from '../settings/HarnessCredentialService';
import { LinuxLoginStartup, windowsLoginStartup } from '../settings/loginStartup';
import type { AppInfo, ImagePort, PowerPort, RelaunchPort, SecretProtection, StartupPort } from '../host/ports';

export const desktopImages: ImagePort = {
  checkDimensions(base64, width, height) {
    const decoded = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
    const size = decoded.getSize();
    if (decoded.isEmpty() || size.width !== width || size.height !== height) throw new Error(translate("The picture could not be read."));
  },
  toPng(bytes) {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error(translate("You can't read a picture. Select a PNG or JPEG."));
    return image.toPNG();
  },
  profilePng(bytes) {
    const source = nativeImage.createFromBuffer(bytes);
    if (source.isEmpty()) throw new Error(translate("ade: Profile picture could not be read."));
    for (const size of [256, 128, 64]) {
      const image = source.resize({ width: size, height: size, quality: 'good' }).toPNG();
      if (image.length <= 32 * 1024) return image;
    }
    throw new Error(translate("ade: Profile picture is too big."));
  },
};

/** Electron safeStorage; Linux fails closed unless an OS-backed keyring was selected. */
export const desktopSecrets: SecretProtection = {
  available: () => isSafeStorageSecure(safeStorage.isEncryptionAvailable(), process.platform,
    process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : ''),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
};

export const desktopPower: PowerPort = powerSaveBlocker;

export const desktopRelaunch: RelaunchPort = {
  relaunch() {
    // Keep the app's local arguments, without launcher-only instrumentation
    // (Playwright's loader otherwise holds the new ready event indefinitely).
    app.relaunch({ args: process.argv.slice(1) });
    app.quit();
  },
};

export function desktopAppInfo(): AppInfo {
  return { version: app.getVersion(), packaged: app.isPackaged };
}

/** Opening ADE at desktop login; unavailable for dev, test and isolated profiles. */
export function desktopStartup(): StartupPort {
  const executable = process.platform === 'linux' && app.isPackaged && process.env['APPIMAGE'] ? process.env['APPIMAGE'] : process.execPath;
  const startupArgs = app.isPackaged ? [] : [app.getAppPath()];
  const startupAvailable = !process.env['ELECTRON_RENDERER_URL'] && !process.env['ADE_USER_DATA_DIR'] && !app.getAppPath().includes('test-results');
  const xdgConfig = process.env['XDG_CONFIG_HOME'];
  const startupDirectory = join(xdgConfig && isAbsolute(xdgConfig) ? xdgConfig : join(homedir(), '.config'), 'autostart');
  return startupAvailable && process.platform === 'linux'
    ? new LinuxLoginStartup(startupDirectory, executable, startupArgs)
    : startupAvailable && process.platform === 'win32' ? windowsLoginStartup(app, executable, startupArgs)
      : { supported: false, enabled: () => false, set: () => { throw new Error('Autostart unavailable.'); } };
}
