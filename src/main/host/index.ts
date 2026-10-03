/**
 * Entry of the ADE host (Goal 34.6). Everything reachable from here at
 * runtime must stay free of Electron; scripts/test-host-boundary.ts enforces
 * it and requires a minimum module count, which rises as composition moves in.
 *
 * H1a: the domain modules that are already Electron-free. H1b: the PTY layer
 * and the run coordinator, which now reach clients only through ports. Later
 * H1 stages add the host composer and the handler table here.
 */
export type * from './ports';
export { AdeApplicationService, JournalChangeHub } from '../application/AdeApplicationService';
export { HostOperationGate } from '../application/HostOperationGate';
export { RemoteTerminalService } from '../application/RemoteTerminalService';
export { createCoordinatorConversation } from '../conversation/CoordinatorConversation';
export { WebPushService } from '../notifications/WebPushService';
export { OrchestrationService } from '../orchestration/OrchestrationService';
export { RunCoordinator } from '../orchestration/RunCoordinator';
export { PtyManager } from '../pty/PtyManager';
export { OrganizerService } from '../organizer/OrganizerService';
export { HostLifecycle } from '../overview/hostLifecycle';
export { HostApiServer } from '../remote/HostApiServer';
export { MobileAccessController } from '../remote/MobileAccessController';
export { HostOperationService } from '../settings/HostOperationService';
