import { BrowserWindow, webContents } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRendererWindow } from '../rendererWindows';
import { isTrustedRendererUrl } from '../security';
import { MicrophoneAccess } from './MicrophoneAccess';

export const desktopMicrophone = new MicrophoneAccess((id, url) => {
  const contents = webContents.fromId(id);
  if (!contents || contents.isDestroyed() || !isRendererWindow(BrowserWindow.fromWebContents(contents))) return false;
  const trusted = (value: string) => isTrustedRendererUrl(value, process.env.ELECTRON_RENDERER_URL,
    pathToFileURL(join(__dirname, '../renderer/index.html')).toString());
  return trusted(url) && trusted(contents.getURL());
});
