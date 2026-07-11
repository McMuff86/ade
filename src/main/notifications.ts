/** Native completion notifications, emitted only while ADE is in the background. */

import { BrowserWindow, Notification } from 'electron';
import type { SessionMeta } from '../shared/types';
import { sessionExitNotice } from './notificationPolicy';

export function showSessionExitNotification(meta: SessionMeta, agentName: string): void {
  const notice = sessionExitNotice(meta, agentName);
  if (notice) showNotice(notice);
}

export function showManagedTaskNotification(
  agentName: string,
  outcome: 'completed' | 'failed' | 'cancelled',
  detail?: string,
): void {
  if (outcome === 'cancelled') return;
  showNotice(outcome === 'completed'
    ? { title: `${agentName} completed a task`, body: detail || 'The managed task passed validation.' }
    : { title: `${agentName} task failed`, body: detail || 'The managed task did not pass validation.' });
}

function showNotice(notice: { title: string; body: string }): void {
  try {
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
    if (windows.some((window) => window.isFocused() && !window.isMinimized())) return;

    const notification = new Notification(notice);
    notification.on('click', () => {
      const window = windows[0];
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
    notification.show();
  } catch (error) {
    console.warn('[ade] native notification failed:', error);
  }
}
