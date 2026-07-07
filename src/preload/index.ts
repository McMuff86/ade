/**
 * Preload — the only bridge between renderer and main.
 * Exposes typed invoke/on wrappers on window.ade. No raw ipcRenderer crosses
 * the bridge, and channel names are validated against the shared contract.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type AdeApi,
  type IpcEventMap,
  type IpcInvokeMap,
} from '../shared/ipc';

const invokable = new Set<string>(INVOKE_CHANNELS);
const subscribable = new Set<string>(EVENT_CHANNELS);

const api: AdeApi = {
  invoke: (channel, ...args) => {
    if (!invokable.has(channel)) {
      return Promise.reject(new Error(`ade: unknown invoke channel "${String(channel)}"`));
    }
    return ipcRenderer.invoke(channel, args[0]) as Promise<
      IpcInvokeMap[typeof channel]['res']
    >;
  },
  on: (channel, listener) => {
    if (!subscribable.has(channel)) {
      throw new Error(`ade: unknown event channel "${String(channel)}"`);
    }
    const wrapped = (_event: IpcRendererEvent, payload: IpcEventMap[typeof channel]): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('ade', api);
