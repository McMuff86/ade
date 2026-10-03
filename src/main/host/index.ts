/**
 * Entry of the ADE host (Goal 34.6). Everything reachable from here at
 * runtime must stay free of Electron; scripts/test-host-boundary.ts enforces
 * it and requires a minimum module count, which rises as composition moves in.
 *
 * H1a: the domain modules that are already Electron-free. H1b: the PTY layer
 * and the run coordinator, which now reach clients only through ports. H1c:
 * config store, identities, photo storage, harness credentials and workspace
 * provisioning, which now take profile paths and secret protection explicitly.
 * H1d: restart controller and Linux autostart, whose Electron parts are now
 * desktop ports. H1f: the host composer, which builds every service the
 * desktop used to build inline. H1g adds the handler table.
 */
export type * from './ports';
export { composeHost, type Host } from './composeHost';
export { configPath, photosDir, profilePaths } from './profilePaths';
export { AdeApplicationService, JournalChangeHub } from '../application/AdeApplicationService';
export { HostOperationGate } from '../application/HostOperationGate';
export { HostRestartController } from '../application/HostRestartController';
export { RemoteTerminalService } from '../application/RemoteTerminalService';
export { RemoteWorkspaceService } from '../application/RemoteWorkspaceService';
export { ConfigStore } from '../config/store';
export { createCoordinatorConversation } from '../conversation/CoordinatorConversation';
export { createAgent, createCategory, spawnAgentTemplate } from '../identity';
export { WebPushService } from '../notifications/WebPushService';
export { OrchestrationService } from '../orchestration/OrchestrationService';
export { RunCoordinator } from '../orchestration/RunCoordinator';
export { PtyManager } from '../pty/PtyManager';
export { OrganizerService } from '../organizer/OrganizerService';
export { HostLifecycle } from '../overview/hostLifecycle';
export { HostApiServer } from '../remote/HostApiServer';
export { MobileAccessController } from '../remote/MobileAccessController';
export { importPhoto } from '../photos';
export { HarnessCredentialService } from '../settings/HarnessCredentialService';
export { HostOperationService } from '../settings/HostOperationService';
export { LinuxLoginStartup, windowsLoginStartup } from '../settings/loginStartup';
