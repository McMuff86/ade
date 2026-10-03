/**
 * Ports through which the ADE host reaches platform services (Goal 34.6, H1).
 *
 * The host composes the domain without importing Electron; whoever starts it
 * supplies these ports. Today that is the Electron desktop adapter in the same
 * process. Later stages give the independent host its own implementations
 * (OS keyring vault, image child process, service-manager restart).
 */
import type { SessionMeta } from '../../shared/types';
import type { DeviceSecretProtection } from '../remote/RemoteDeviceStore';
import type { LoginStartup, SleepBlocker } from '../settings/HostOperationService';

/** Host → client events. The desktop delivers them only via rendererWindows.ts. */
export interface HostEvents {
  emit(channel: string, payload: unknown): void;
}

/** Native notices. Presentation belongs to the client that shows them. */
export interface HostNotifier {
  sessionExit(meta: SessionMeta, agentName: string): void;
  runApproval(runName: string, workTaskCount: number, validatedCommitCount: number): void;
  managedTask(agentName: string, outcome: 'completed' | 'failed' | 'cancelled', detail?: string): void;
  organizerReminder(count: number): void;
}

/** Ports for a host without clients (tests): events and notices go nowhere. */
export const NO_HOST_EVENTS: HostEvents = { emit: () => undefined };
export const NO_HOST_NOTIFIER: HostNotifier = {
  sessionExit: () => undefined, runApproval: () => undefined, managedTask: () => undefined, organizerReminder: () => undefined,
};

/** Image decoding for organizer pictures, terminal images and profile photos. */
export interface ImagePort {
  /** Throws unless the base64 image decodes to exactly width × height. */
  checkDimensions(base64: string, width: number, height: number): void;
  /** Re-encodes a PNG or JPEG as PNG; throws if it cannot be read. */
  toPng(bytes: Buffer): Buffer;
  /** Square profile photo, 256/128/64 px, the first PNG of at most 32 KB. */
  profilePng(bytes: Buffer): Buffer;
}

/** Encrypts stored device, push and harness secrets. */
export type SecretProtection = DeviceSecretProtection;

/** Prevents system sleep while work is active. */
export type PowerPort = SleepBlocker;

/** Opening ADE at login. */
export type StartupPort = LoginStartup;

/** Restarts the whole ADE process (remote host restart). */
export interface RelaunchPort {
  relaunch(): void;
}

export interface AppInfo {
  version: string;
  packaged: boolean;
}

/** Profile locations; `profileDir` is `<userData>/ade`. */
export interface ProfilePaths {
  userData: string;
  profileDir: string;
}

export interface HostPorts {
  events: HostEvents;
  notifier: HostNotifier;
  images: ImagePort;
  secrets: SecretProtection;
  power: PowerPort;
  startup: StartupPort;
  relaunch: RelaunchPort;
  app: AppInfo;
  paths: ProfilePaths;
}
