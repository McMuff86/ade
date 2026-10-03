/**
 * Composition of the ADE host (Goal 34.6, H1f): every service, store, timer and
 * recovery step that registerIpcHandlers built inline, in the same order, with
 * platform access only through HostPorts. The desktop adapter (ipc.ts) still
 * registers the IPC handlers on top of the returned services; H1g moves them
 * into a host handler table.
 */
import { PushStore } from '../notifications/PushStore';
import { WebPushService } from '../notifications/WebPushService';
import { t as translate } from "../../shared/i18n";
import type { RuntimeModelRequest } from '../../shared/runtimeModels';
import { RunQuestionService } from '../orchestration/RunQuestionService';
import { OrganizerService } from '../organizer/OrganizerService';
import { OrganizerReminders } from '../organizer/OrganizerReminders';
import { photosDir } from '../host/profilePaths';
import { TerminalImageStore } from '../application/TerminalImageStore';
import { SpeechService } from '../settings/SpeechService';
import { ReplySpeechService } from '../settings/ReplySpeechService';
import { isSecretEnvName } from '../errors';
import { DictationService } from '../settings/DictationService';
import { DictationJobs } from '../settings/DictationJobs';
import { NativeUsageService } from '../usage/NativeUsageService';
import { UsageOverviewService } from '../usage/UsageOverviewService';
import { SpeechUsageService } from '../usage/SpeechUsageService';
import { UsageJournal } from '../usage/UsageJournal';
import { SpeechPreferences } from '../settings/SpeechPreferences';
import { HostOperationService } from '../settings/HostOperationService';
import { causeFor, HostLifecycle, LIFECYCLE_HEARTBEAT_MS, TASK_INTERRUPTION_REASON } from '../overview/hostLifecycle';
import { AgentBehaviorService } from '../memory/AgentBehaviorService';
import { RemoteSpeechService } from '../application/RemoteSpeechService';
import { DeviceResourceService } from '../application/DeviceResourceService';
import { join } from 'node:path';
import { IPC_EVENTS, type WorkspaceBundleMappings } from '../../shared/ipc';
import type { Agent } from '../../shared/types';
import { normalizeExecutionBackendId } from '../../shared/executionBackends';
import type { ConfigStore } from '../config/store';
import { SupervisionStore } from '../supervision/SupervisionStore';
import { SupervisionService } from '../supervision/SupervisionService';
import { createCoordinatorConversation } from '../conversation/CoordinatorConversation';
import { CoordinatorActionService } from '../conversation/CoordinatorActionService';
import { CoordinatorActionStore } from '../conversation/CoordinatorActionStore';
import { ConversationProjectService } from '../conversation/ConversationProjectService';
import type { ConversationService } from '../conversation/ConversationService';
import { PtyManager } from '../pty/PtyManager';
import { OrchestrationService } from '../orchestration/OrchestrationService';
import { RunArchiveStore } from '../orchestration/RunArchiveStore';
import { RunCoordinator } from '../orchestration/RunCoordinator';
import { diagnoseRuntimes } from '../diagnostics/RuntimeDiagnostics';
import { redactedErrorDetail } from '../errors';
import { RepositoryScopeService } from '../repositories/RepositoryScopeService';
import { ProjectWorkspaceService } from '../repositories/ProjectWorkspaceService';
import { WorkspaceAssignmentService } from '../application/WorkspaceAssignmentService';
import { RunInspectionService } from '../application/RunInspectionService';
import { RunFileTracker } from '../application/RunFileTracker';
import { RunFileStore } from '../application/RunFileStore';
import { ProjectBranchService } from '../repositories/ProjectBranchService';
import { ProjectGitService } from '../repositories/ProjectGitService';
import { ProjectPublishService } from '../repositories/ProjectPublishService';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { BackendGitService } from '../execution/BackendGitService';
import { BackendWorkspaceService } from '../execution/BackendWorkspaceService';
import { BackendWorkspaceFs } from '../execution/BackendWorkspaceFs';
import { PublicationService } from '../publishing/PublicationService';
import { HarnessCredentialService } from '../settings/HarnessCredentialService';
import { RuntimeModelService } from '../settings/RuntimeModelService';
import { RepositoryInspectorService } from '../repositories/RepositoryInspectorService';
import { RepositorySyncService } from '../repositories/RepositorySyncService';
import { AdeApplicationService, JournalChangeHub } from '../application/AdeApplicationService';
import { HostOperationGate } from '../application/HostOperationGate';
import { HostRestartController } from '../application/HostRestartController';
import { RemoteCommandLedger } from '../application/RemoteCommandLedger';
import { RemoteWorkspaceService } from '../application/RemoteWorkspaceService';
import { ProjectDefaultsService } from '../settings/ProjectDefaultsService';
import { RemoteWorkbenchService } from '../application/RemoteWorkbenchService';
import { RemoteTerminalService } from '../application/RemoteTerminalService';
import { RemoteProfileService } from '../application/RemoteProfileService';
import { workspaceOperations } from '../repositories/WorkspaceOperationGate';
import { IntegrationService } from '../repositories/IntegrationService';
import { HostApiServer } from '../remote/HostApiServer';
import { MobileAccessController } from '../remote/MobileAccessController';
import { RemoteAuthorizer } from '../remote/authorization';
import { consumeHostApiConfig, mobileListenerPort } from '../remote/hostApiConfig';
import { RemoteDeviceStore } from '../remote/RemoteDeviceStore';
import { TargetPathProbe } from '../portability/TargetPathProbe';
import { WorkspaceImportService } from '../portability/WorkspaceImportService';
import { ExecutionBackendHomeProvisioner } from '../portability/ExecutionBackendHomeProvisioner';
import { WorkspaceBundleController } from '../portability/WorkspaceBundleController';
import type { HostPorts } from './ports';

export async function composeHost(store: ConfigStore, ports: HostPorts) {
  const { paths } = ports;
  /** Live PTY sessions (Phase B1). Created lazily so tests can import this module. */
  let ptyManager: PtyManager | null = null;
  let conversations: ConversationService | null = null;
  let remoteTerminals: RemoteTerminalService | null = null;
  let dictationJobs: DictationJobs | null = null;
  let nativeUsage: NativeUsageService | null = null;
  let usageOverview: UsageOverviewService | null = null;
  let mobilePush: WebPushService | null = null;
  let stopTerminalRevocation: (() => void) | null = null;
  let replySpeech: ReplySpeechService | null = null;
  let orchestration: OrchestrationService | null = null;
  let runCoordinator: RunCoordinator | null = null;
  let hostApiServer: HostApiServer | null = null;
  let mobileAccess: MobileAccessController | null = null;
  let remoteWorkbench: RemoteWorkbenchService | null = null;
  let integrationService: IntegrationService | null = null;
  let retentionTimer: NodeJS.Timeout | null = null;
  let organizerReminderTimer: NodeJS.Timeout | null = null;
  const hostOperations = new HostOperationGate();
  const RETENTION_INTERVAL_MS = 60 * 60 * 1_000;
  let activationQuit: (() => boolean) | null = null;
  let hostOperation: HostOperationService | null = null;
  let hostLifecycle: HostLifecycle | null = null;
  let lifecycleTimer: ReturnType<typeof setInterval> | null = null;
  let hostOperationTimer: ReturnType<typeof setInterval> | null = null;
  // Classify how the previous owner ended before any recovery marks its work.
  hostLifecycle = new HostLifecycle(join(paths.profileDir, 'lifecycle.json'));
  const previousEnd = hostLifecycle.previous;
  if (previousEnd.cause !== 'app-quit') console.warn(`[ade] previous owner ended: ${previousEnd.cause}`);
  lifecycleTimer = setInterval(() => hostLifecycle?.heartbeat(), LIFECYCLE_HEARTBEAT_MS);
  lifecycleTimer.unref();
  const preferences = () => store.get().settings.hostOperation ?? { keepAwake: false, keepInTray: false };
  hostOperation = new HostOperationService({ preferences,
    save: hostOperation => { store.save({ settings: { ...store.get().settings, hostOperation } }); },
    activeSessions: () => ptyManager?.list().filter(session => session.status === 'running').length ?? 0,
    otherWorkActive: () => store.get().runs.some(run => run.status === 'running')
      || (ptyManager?.queueStatus().queued ?? 0) > 0 || workspaceOperations.busy() || integrationService?.busy() === true
      || conversations?.query().some(conversation => ['working', 'interrupting'].includes(conversation.status)) === true,
    startup: ports.startup, power: ports.power,
    warn: error => console.warn('[ade] host operation:', redactedErrorDetail(error)),
  });
  hostOperationTimer = setInterval(() => hostOperation?.reconcile(), 1000);
  hostOperationTimer.unref();
  const execution = new ExecutionBackendService();
  const portabilityProfileDir = paths.profileDir;
  const portabilityProbe = new TargetPathProbe({ hostPlatform: process.platform }, execution);
  const workspaceImport = new WorkspaceImportService({
    profileDir: portabilityProfileDir,
    store,
    probe: portabilityProbe,
    hostPlatform: process.platform,
    homeProvisioner: new ExecutionBackendHomeProvisioner(execution),
  });
  // Never fatal. registerIpcHandlers is awaited by index.ts, which answers a
  // rejection with app.quit() — so a single unreplayable pending.json used to
  // mean ADE would not open at all. The failure is surfaced through
  // IPC.ConfigHealth instead; apply() re-runs recovery at its head and stays
  // fail-closed, so an import cannot start on top of an unresolved journal.
  let importRecoveryFailure: string | null = null;
  try {
    await workspaceImport.recoverPending();
  } catch (error) {
    importRecoveryFailure = (error instanceof Error ? error.message : String(error))
      .split(portabilityProfileDir).join('<profile>')
      .slice(0, 300);
    console.error('[ade] workspace import recovery failed; continuing without it:', error);
  }
  const workspaceBundles = new WorkspaceBundleController({
    store,
    probe: portabilityProbe,
    importer: workspaceImport,
    hostPlatform: process.platform,
    profileDir: portabilityProfileDir,
  });
  const importSelections = new Map<string, {
    path: string;
    kind: 'bundle' | 'profile';
    ownerId: string;
    createdAt: number;
  }>();
  const mappingAuthorizations = new Map<string, {
    mappings: WorkspaceBundleMappings;
    ownerId: string;
    createdAt: number;
  }>();
  const previewOwners = new Map<string, string>();
  const importSelectionTtlMs = 10 * 60 * 1_000;
  const backendGit = new BackendGitService(execution);
  const backendWorkspaces = new BackendWorkspaceService(store, execution);
  const backendFs = new BackendWorkspaceFs(execution);
  const scopes = new RepositoryScopeService(store, { execution, git: backendGit, backendWorkspaces });
  const repositoryInspector = new RepositoryInspectorService(store, {
    commands: execution,
    git: backendGit,
  });
  // Desktop renderers receive the slim view, coalesced per event-loop tick so a
  // burst of saves (phase change + lease release + event) costs one projection
  // and one broadcast; the host API's event streams flush journal deltas from
  // the same change signal immediately (Thema 5).
  const journalChanges = new JournalChangeHub();
  let viewBroadcastPending = false;
  orchestration = new OrchestrationService(store, () => {
    journalChanges.publish();
    if (viewBroadcastPending) return;
    viewBroadcastPending = true;
    setImmediate(() => {
      viewBroadcastPending = false;
      if (!orchestration) return;
      ports.events.emit(IPC_EVENTS.OrchestrationChanged, orchestration.view());
    });
  }, new RunArchiveStore(join(paths.profileDir, 'archive', 'runs')));
  const recoveredTasks = orchestration.recoverInterruptedTasks(TASK_INTERRUPTION_REASON[previousEnd.cause]);
  if (recoveredTasks > 0) {
    console.warn(`[ade] recovered ${recoveredTasks} interrupted run task(s)`);
  }
  const recoveredPublications = orchestration.recoverInterruptedPublications();
  if (recoveredPublications > 0) {
    console.warn(`[ade] recovered ${recoveredPublications} interrupted publication(s)`);
  }
  // History retention: once after recovery, then hourly. Never fatal — a
  // failed archive write leaves the journal exactly as it was.
  const runRetention = (): void => {
    if (!orchestration) return;
    try {
      const outcome = orchestration.applyRetention();
      if (outcome.archivedRunIds.length > 0) {
        console.log(`[ade] history retention archived ${outcome.archivedRunIds.length} run(s); `
          + `config ${outcome.bytesBefore} -> ${outcome.bytesAfter} bytes`);
      } else if (outcome.skipped) {
        console.warn(`[ade] history retention skipped: ${outcome.skipped}`);
      }
    } catch (error) {
      console.error('[ade] history retention failed:', error);
    }
  };
  runRetention();
  retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
  retentionTimer.unref();
  runCoordinator = new RunCoordinator(store, orchestration, undefined, backendWorkspaces, scopes);
  runCoordinator.setNotifier(ports.notifier);
  const runQuestions = new RunQuestionService(orchestration, (taskId, waiting) => runCoordinator!.onTaskQuestionWait(taskId, waiting));
  const publications = new PublicationService(store, orchestration, backendWorkspaces, execution);
  // One SecretProtection for harness keys, device secrets and push state.
  const harnessCredentials = new HarnessCredentialService(paths.userData, ports.secrets);
  const usageJournal = new UsageJournal(join(paths.profileDir, 'usage', 'events.jsonl'));
  nativeUsage = new NativeUsageService(usageJournal);
  usageOverview = new UsageOverviewService({ nativeUsage: () => nativeUsage, claudeEnabled: () => store.get().settings.claudeAccountUsage === true });
  const speechUsage = new SpeechUsageService(usageJournal);
  const speech = new SpeechService(store, () => harnessCredentials.envFor('shell').ELEVENLABS_API_KEY);
  const dictation = new DictationService(() => harnessCredentials.envFor('shell').ELEVENLABS_API_KEY);
  speech.setUsage(speechUsage); dictation.setUsage(speechUsage);
  const recordings = new DictationJobs({
    transcribe: (audio, authorize, signal, usage) => hostOperations.use(() => dictation.transcribe(audio, authorize, signal, usage)),
    startLive: async (authorize, signal, usage, preview) => {
      const live = await dictation.startLive(authorize, signal, usage, preview);
      void hostOperations.use(() => live.result).catch(() => undefined);
      return live;
    },
  });
  dictationJobs = recordings;
  const speechPreferences = new SpeechPreferences(store, speech);
  const replies = new ReplySpeechService(speech, speechPreferences, () => [...new Set(
    (['shell', 'codex', 'claude', 'grok'] as const).flatMap(runtime => Object.entries(harnessCredentials.envFor(runtime))
      .filter(([name]) => isSecretEnvName(name)).map(([, value]) => value)),
  )]);
  replySpeech = replies;
  const replyOwners = new Set<string>();
  const agentBehavior = new AgentBehaviorService(store);
  const organizer = new OrganizerService(join(paths.profileDir, 'organizer.json'),
    revision => ports.events.emit(IPC_EVENTS.OrganizerChanged, { revision }), image => ports.images.checkDimensions(image.base64, image.width, image.height));
  const reminders = new OrganizerReminders(() => organizer.store.index(), count => ports.notifier.organizerReminder(count));
  let reminderFailure = false;
  const checkReminders = () => { try { reminders.check(); reminderFailure = false; } catch (error) {
    if (!reminderFailure) console.warn('[ade] organizer reminders unavailable:', redactedErrorDetail(error)); reminderFailure = true;
  } };
  if (organizerReminderTimer) clearInterval(organizerReminderTimer);
  organizerReminderTimer = setInterval(checkReminders, 10_000); organizerReminderTimer.unref();
  checkReminders();
  let supervision: SupervisionService | undefined;
  let coordinatorActions: CoordinatorActionService | undefined;
  const supervisionService = () => supervision ??= new SupervisionService(new SupervisionStore(join(paths.profileDir, 'supervision.json')),
    store, id => ptyManager?.getSessionMeta(id), Date.now, projectId => actionService().links(projectId));
  const conversationService = () => conversations ??= createCoordinatorConversation({ directory: paths.profileDir,
    actions: () => actionService(),
    config: store, supervision: supervisionService(), env: () => ({ ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), ...harnessCredentials.envFor('codex') }),
    changed: () => ports.events.emit(IPC_EVENTS.ConversationChanged, null) });
  const actionService = (): CoordinatorActionService => coordinatorActions ??= new CoordinatorActionService(new CoordinatorActionStore(join(paths.profileDir, 'conversation-actions.json')), {
    config: store, supervision: supervisionService(),
    authorize: (id, binding, requireOpen) => conversationService().assertActionAuthority(id, binding, requireOpen),
    afterProjectChange: (id, binding) => conversationService().continuationAuthority(id, binding),
    submit: (input, authorize, reserved) => runCoordinator!.submitSingleTask(input, authorize, reserved),
    createProject: (input, authorize, reserved) => conversationProjects.create(input, authorize, reserved),
    report: id => orchestration!.report(id), questions: id => runQuestions.view(id),
    changed: () => ports.events.emit(IPC_EVENTS.ConversationChanged, null),
  });
  const runtimeModels = new RuntimeModelService(harnessCredentials);
  ptyManager = new PtyManager(store, runCoordinator, scopes, execution, harnessCredentials, runQuestions,
    startedAt => causeFor(previousEnd, startedAt));
  ptyManager.setClientPorts(ports.events, ports.notifier);
  ptyManager.setNativeUsage(nativeUsage);
  const hostApiConfig = consumeHostApiConfig(process.env);
  const remoteDevices = new RemoteDeviceStore(join(paths.profileDir, 'remote'), ports.secrets);
  const repositorySync = new RepositorySyncService(store, () => ptyManager?.list() ?? [], execution);
  if (hostApiConfig.enabled && hostApiConfig.devices.length > 0) {
    try { remoteDevices.importBootstrap(hostApiConfig.devices); }
    catch (error) { console.warn('[ade] remote device migration failed:', redactedErrorDetail(error)); }
    hostApiConfig.devices = [];
  }
  const restartBlockers = () => {
    const reasons: string[] = [];
    if (ptyManager?.list().some((session) => session.status === 'running')) reasons.push(translate("A terminal or agent process is running."));
    const queue = ptyManager?.queueStatus();
    if (queue && (queue.active > 0 || queue.queued > 0)) reasons.push(translate("Tasks are running or waiting for a task slot."));
    if (store.get().runs.some((run) => run.status === 'running')) reasons.push(translate("A run is still active."));
    if (workspaceOperations.busy()) reasons.push(translate("A workspace is prepared or updated."));
    if (integrationService?.busy()) reasons.push(translate("An integration review is running."));
    if (conversations?.query().some((conversation) => ['working', 'interrupting'].includes(conversation.status))) reasons.push(translate("A terminal or agent process is running."));
    return reasons;
  };
  activationQuit = () => {
    if (restartBlockers().length) return false;
    hostOperations.reserve();
    return true;
  };
  const restart = new HostRestartController(hostOperations, restartBlockers, () => ports.relaunch.relaunch(),
    ports.app.version, process.platform === 'win32' && !ports.app.packaged && !process.env['ELECTRON_RENDERER_URL'] && !hostApiConfig.enabled);
  const ledger = new RemoteCommandLedger(join(paths.profileDir, 'remote', 'commands.json'),
    (entry) => remoteDevices.audit(entry),
    (id, scope) => remoteDevices.activeDevices().some((device) => device.id === id && device.scopes.includes(scope)));
  const projects = new ProjectWorkspaceService(store, () => ports.events.emit(IPC_EVENTS.CatalogChanged, { revision: Date.now() }), () => ptyManager?.list() ?? []);
  const workspaceProvision = new RemoteWorkspaceService(store, scopes, paths.profileDir, () => ptyManager?.list() ?? [], execution);
  const conversationProjects = new ConversationProjectService(store, workspaceProvision, () => ports.events.emit(IPC_EVENTS.CatalogChanged, { revision: Date.now() }));
  const projectBranches = new ProjectBranchService(store, projects, () => ptyManager?.list() ?? []);
  const projectGitActions = new ProjectGitService(store, projects, () => ptyManager?.list() ?? []);
  const projectPublish = new ProjectPublishService(projectGitActions);
  const integration = new IntegrationService(store, projects, () => ptyManager?.list() ?? [], join(paths.profileDir, 'integrations'));
  integrationService = integration;
  const workbench = new RemoteWorkbenchService(store, () => ptyManager?.list() ?? [], execution, projects);
  const resultFiles = new RunFileStore(join(paths.profileDir, 'archive', 'files'));
  ptyManager!.setTaskFileTracker(new RunFileTracker(store, workbench, resultFiles));
  const runInspection = new RunInspectionService(store, workbench, ptyManager!, (runId) => orchestration!.report(runId), resultFiles);
  remoteWorkbench = workbench;
  const deviceResources = new DeviceResourceService(store, (id) => remoteDevices.resourceAccess(id));
  remoteTerminals = new RemoteTerminalService(workbench, {
    promptCapability: (id, requirePaste) => ptyManager!.promptCapability(id, requirePaste),
    deliverPrompt: (request, authorize) => ptyManager!.deliverPrompt(request, authorize),
    writePrompt: (id, text, authorize) => ptyManager!.writePrompt(id, text, authorize),
    list: () => ptyManager?.list() ?? [],
    create: (agentId, repositoryId, bindingId, mode, model, authorize) => ptyManager!.createRemoteInteractive(agentId, repositoryId, bindingId, mode, model, authorize),
    createProject: (workspaceId, branch, choice, profileId, authorize) => ptyManager!.createProjectInteractive(workspaceId, branch, choice, profileId, authorize),
    createHome: (choice, authorize) => ptyManager!.createHomeInteractive(choice, authorize),
    options: (selection) => ptyManager!.sessionOptions(selection),
    display: (id) => ptyManager!.remoteDisplay(id),
    usage: (id) => ptyManager!.subscriptionUsage(id),
    profileContext: (id) => ptyManager!.profileContextText(id),
    attach: (id) => ptyManager!.attach(id), write: (id, data) => ptyManager!.write(id, data),
    resize: (id, cols, rows) => ptyManager!.resize(id, cols, rows), kill: (id) => ptyManager!.kill(id),
  }, (id) => remoteDevices.activeDevices().some((device) => device.id === id && device.scopes.includes('terminal:control')),
  (entry) => remoteDevices.audit(entry), (state) => ports.events.emit(IPC_EVENTS.TerminalControlChanged, state), undefined,
  (id, selection) => deviceResources.assertSelection(id, selection),
  new TerminalImageStore(join(paths.profileDir, 'terminal-images'), execution, bytes => ports.images.toPng(bytes)));
  mobilePush = new WebPushService(new PushStore(join(paths.profileDir, 'remote', 'push.json'), ports.secrets), {
    subscribe: listener => journalChanges.subscribe(listener),
    cursor: () => orchestration!.journalCursor(),
    completed: runId => store.get().runs.some(run => run.id === runId && run.status === 'completed'),
    events: cursor => orchestration!.eventsSince(cursor, 100),
    active: id => remoteDevices.activeDevices().some(device => device.id === id),
    allowed: (id, runId) => remoteDevices.mobilePreferences().enabled
      && remoteDevices.activeDevices().some(device => device.id === id && device.scopes.includes('read'))
      && store.get().runs.some(run => run.id === runId) && deviceResources.run(id, runId),
  });
  mobilePush.start();
  stopTerminalRevocation = remoteDevices.onRevoked((id) => {
    try { mobilePush?.authorityChanged(id); } catch { console.warn('[ade] push authorization changed; notification storage unavailable'); }

    remoteTerminals?.revoke(id);
    if (id === null) { for (const device of remoteDevices.inventory().devices) replies.revoke(`device:${device.id}`); }
    else replies.revoke(`device:${id}`);
    if (id === null) dictationJobs?.revokeDevices();
    else { dictationJobs?.revokeOwner(`device:${id}`); dictationJobs?.revokeOwner(`device:${id}:conversation`); dictationJobs?.revokeOwner(`device:${id}:organizer`); }
  });
  const application = new AdeApplicationService(
    store,
    orchestration,
    { status: () => ptyManager!.queueStatus() },
    {
      notifications: mobilePush,
      activity: hostOperations,
      integration,
      catalogChanged: () => ports.events.emit(IPC_EVENTS.CatalogChanged, { revision: Date.now() }),
      questions: runQuestions,
      resourceAccess: (id) => remoteDevices.resourceAccess(id),
      projects,
      assignments: new WorkspaceAssignmentService(store, projects, () => ptyManager?.list() ?? []),
      runInspection,
      projectBranches,
      projectGit: projectGitActions,
      projectPublish,
      workbench, terminals: remoteTerminals,
      speech: new RemoteSpeechService(speechPreferences, speech),
      replies,
      dictation: dictationJobs!,
      behavior: agentBehavior,
      supervision: supervisionService,
      conversations: conversationService,
      organizer,
      diagnostics: (agentId) => diagnoseConfigured(agentId),
      usage: () => usageOverview!.overview(),
      usageProjects: (range) => usageOverview!.projects(range),
      conversationActions: actionService,
      deviceActive: (id) => remoteDevices.activeDevices().some((device) => device.id === id),
      profiles: new RemoteProfileService(store, photosDir(paths), (bytes) => ports.images.profilePng(bytes), () => ports.events.emit(IPC_EVENTS.CatalogChanged, { revision: Date.now() }),
      // Same catalog the desktop picker reads (`harness:models`): the agent's default repository backend, else its home backend.
      (agent) => runtimeModels.list({ runtime: agent.runtime as RuntimeModelRequest['runtime'], backend: normalizeExecutionBackendId(agent.defaultRepositoryId
        ? store.get().repositories.find((repository) => repository.id === agent.defaultRepositoryId)?.executionBackend : agent.homeExecutionBackend) })),
      administration: { ledger, restart, git: repositorySync,
        workspaces: workspaceProvision },
      // The same coordinator/service methods the desktop IPC handlers call
      // below; the remote path adds nothing the renderer could not do, it
      // only reaches fewer channels.
      deleteCompletedRun: (runId) => runCoordinator!.deleteRun(runId, true),
      commands: {
        createRun: (input) => orchestration!.createRun(input),
        startRun: (runId, commandId) => runCoordinator!.start(runId, commandId),
        cancelRun: (runId, commandId) => runCoordinator!.cancel(runId, undefined, commandId),
        submitTask: (input) => runCoordinator!.submitSingleTask(input),
      },
      changes: journalChanges,
      commandsEnabled: () => (hostApiConfig.enabled || mobileAccess?.commandsEnabled() === true) && remoteDevices.activeDevices().length > 0,
      audit: (entry) => remoteDevices.audit(entry),
    },
  );
  mobileAccess = new MobileAccessController(application, remoteDevices, join(__dirname, '../mobile'), undefined,
    mobileListenerPort(process.env['ADE_MOBILE_PORT']), hostApiConfig.enabled);
  void mobileAccess.restore().catch((error) => console.warn('[ade] mobile restore failed:', redactedErrorDetail(error)));
  if (hostApiConfig.enabled && remoteDevices.activeDevices().some((device) => device.secret === hostApiConfig.token)) {
    console.warn('[ade] host API disabled: listener token must differ from every stored device secret');
  } else if (hostApiConfig.enabled) {
    hostApiServer = new HostApiServer(application, {
      authorizer: new RemoteAuthorizer(hostApiConfig.token, [], undefined, remoteDevices),
      port: hostApiConfig.port,
      requireDeviceReads: true,
      audit: (entry) => remoteDevices.audit(entry),
    });
    void hostApiServer.start()
      .then((address) => {
        console.log(`[ade] host API listening on ${address.host}:${address.port}`);
      })
      .catch((error) => {
        hostApiServer = null;
        console.error('[ade] host API failed to start:', error);
      });
  }
  runCoordinator.connect(
    (agentId, prompt, dispatchId, runTaskId, repositoryId, workspaceBindingId, authorize) =>
      ptyManager!.create(
        agentId,
        prompt,
        dispatchId,
        runTaskId,
        repositoryId,
        workspaceBindingId,
        authorize,
      ),
    (runTaskIds) => { ptyManager!.cancelTasks({ runTaskIds }); },
  );

  /** Resolve an agent by id or throw — every git/fs handler needs its dirs. */
  const requireAgent = (agentId: string): Agent => {
    const agent = store.get().agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`ade: agent not found "${agentId}"`);
    return agent;
  };
  const assertAgentNotLeased = (agentId: string): void => {
    const lease = orchestration!.snapshot().workspaceLeases.find(
      (candidate) => candidate.agentId === agentId && candidate.status === 'active',
    );
    if (lease) throw new Error(`ade: agent workspace is owned by active run ${lease.runId}`);
  };
  const workspaceTarget = (agentId: string, sessionId?: string): {
    agent: Agent;
    workspaceDir: string;
    executionBackend: ReturnType<typeof normalizeExecutionBackendId>;
  } => {
    const agent = requireAgent(agentId);
    if (!sessionId) {
      const descriptor = scopes.describe(agentId);
      return {
        agent,
        workspaceDir: descriptor.workspaceDir,
        executionBackend: descriptor.executionBackend,
      };
    }
    const session = ptyManager!.getSessionMeta(sessionId);
    if (!session || session.agentId !== agentId) {
      throw new Error(`ade: session does not belong to agent "${agentId}"`);
    }
    const descriptor = scopes.describe(agentId, session);
    return {
      agent,
      workspaceDir: session.workspaceDir ?? descriptor.workspaceDir,
      executionBackend: normalizeExecutionBackendId(
        session.executionBackend ?? descriptor.executionBackend,
      ),
    };
  };
  const projectDefaults = new ProjectDefaultsService(store);

  // Safe readiness checks only: version/auth commands never modify credentials.
  // Shared by the desktop channel and the tablet route (`AdeApplicationService.diagnostics`, no session there).
  const diagnoseConfigured = (agentId?: string, sessionId?: string) => {
    const session = sessionId ? ptyManager!.getSessionMeta(sessionId) : undefined;
    if (sessionId && (!session || session.agentId !== agentId)) {
      throw new Error('ade: diagnostic session does not belong to the requested agent');
    }
    return diagnoseRuntimes(
      store.get().agents,
      agentId,
      (agent) => session && session.agentId === agent.id
        ? normalizeExecutionBackendId(session.executionBackend)
        : normalizeExecutionBackendId(
            agent.defaultRepositoryId
              ? store.get().repositories.find((repository) => repository.id === agent.defaultRepositoryId)
                ?.executionBackend
              : undefined,
          ),
      execution,
      {
        hasStoredKey: (runtime) => harnessCredentials.status()
          .some((item) => item.runtime === runtime && item.hasStoredKey),
      },
    );
  };

  return {
    actionService,
    agentBehavior,
    application,
    assertAgentNotLeased,
    backendFs,
    backendGit,
    conversationService,
    diagnoseConfigured,
    execution,
    harnessCredentials,
    hostOperations,
    importRecoveryFailure,
    importSelectionTtlMs,
    importSelections,
    integration,
    mappingAuthorizations,
    organizer,
    portabilityProfileDir,
    previewOwners,
    projectBranches,
    projectDefaults,
    projectGitActions,
    projectPublish,
    projects,
    publications,
    recordings,
    remoteDevices,
    replies,
    replyOwners,
    repositoryInspector,
    repositorySync,
    requireAgent,
    runInspection,
    runQuestions,
    runtimeModels,
    scopes,
    speech,
    speechPreferences,
    supervisionService,
    workbench,
    workspaceBundles,
    workspaceProvision,
    workspaceTarget,
    get ptyManager() { return ptyManager; },
    get remoteTerminals() { return remoteTerminals; },
    get usageOverview() { return usageOverview; },
    get orchestration() { return orchestration; },
    get runCoordinator() { return runCoordinator; },
    get mobileAccess() { return mobileAccess; },
    get hostOperation() { return hostOperation; },
    reserveActivationQuit(): boolean {
      try { return activationQuit?.() === true; }
      catch { return false; }
    },
    mobileHostEnabled(): boolean { return mobileAccess?.enabled() === true; },
    markCleanShutdown(): void {
      if (lifecycleTimer) clearInterval(lifecycleTimer); lifecycleTimer = null;
      hostLifecycle?.markClean(); hostLifecycle = null;
    },
    keepDesktopInTray(): boolean { return hostOperation?.status().keepInTray === true; },
    async dispose(): Promise<void> {
      if (hostOperationTimer) clearInterval(hostOperationTimer); hostOperationTimer = null;
      hostOperation?.dispose(); hostOperation = null;
      if (organizerReminderTimer) clearInterval(organizerReminderTimer); organizerReminderTimer = null;
      await conversations?.shutdown().catch(error => console.warn('[ade] conversation shutdown incomplete:', redactedErrorDetail(error))); conversations = null;
      const replies = replySpeech; replySpeech = null;
      await replies?.dispose();
      dictationJobs?.dispose(); dictationJobs = null;
      integrationService?.stop(); integrationService = null;
      mobilePush?.dispose(); mobilePush = null;
      stopTerminalRevocation?.(); stopTerminalRevocation = null;
      remoteTerminals?.dispose(); remoteTerminals = null;
      remoteWorkbench?.dispose(); remoteWorkbench = null;
      if (retentionTimer) {
        clearInterval(retentionTimer);
        retentionTimer = null;
      }
      void mobileAccess?.dispose().catch((error) => console.warn('[ade] mobile shutdown failed:', redactedErrorDetail(error)));
      mobileAccess = null;
      void hostApiServer?.stop().catch((error) => {
        console.warn('[ade] host API failed to stop cleanly:', error);
      });
      hostApiServer = null;
      ptyManager?.disposeAll();
      ptyManager = null;
      runCoordinator = null;
      orchestration = null;
      const usage = nativeUsage; nativeUsage = null;
      await usage?.close();
    },
  };
}

export type Host = Awaited<ReturnType<typeof composeHost>>;
