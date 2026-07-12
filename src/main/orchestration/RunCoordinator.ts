import type {
  AdeConfig,
  Agent,
  Run,
  RunParticipant,
  RunTask,
  SessionMeta,
  StructuredTaskResult,
} from '../../shared/types';
import { resolveTaskLaunchCommand } from '../../shared/runtimes';
import { MailboxService } from './MailboxService';
import { OrchestrationService } from './OrchestrationService';
import {
  RuntimeAdapterRegistry,
  type ManagedTaskLaunch,
} from './runtimeAdapters';
import { WorkspaceService, type WorkspacePort } from './WorkspaceService';
import { showManagedTaskNotification } from '../notifications';
import type {
  RepositoryScopePort,
  ResolvedExecutionScope,
} from '../repositories/RepositoryScopeService';

interface ConfigPort {
  get(): AdeConfig;
}

type TaskLauncher = (
  agentId: string,
  prompt: string,
  dispatchId: string,
  runTaskId: string,
  repositoryId?: string | null,
  workspaceBindingId?: string,
) => Promise<SessionMeta>;

type TaskCanceller = (runTaskIds: string[]) => void | Promise<void>;

export class RunCoordinator {
  private readonly mailbox: MailboxService;
  private readonly launches = new Map<string, ManagedTaskLaunch>();
  private readonly runChains = new Map<string, Promise<void>>();
  private taskLauncher: TaskLauncher | null = null;
  private taskCanceller: TaskCanceller | null = null;
  private readonly scopes: RepositoryScopePort;

  constructor(
    private readonly store: ConfigPort,
    private readonly orchestration: OrchestrationService,
    private readonly adapters: RuntimeAdapterRegistry = new RuntimeAdapterRegistry(),
    private readonly workspaces: WorkspacePort = new WorkspaceService(),
    scopes?: RepositoryScopePort,
  ) {
    this.mailbox = new MailboxService(orchestration);
    this.scopes = scopes ?? {
      resolve: async (agentId): Promise<ResolvedExecutionScope> => {
        const agent = this.store.get().agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error(`ade: agent not found "${agentId}"`);
        return {
          source: agent.defaultRepositoryId ? 'agent-default' : 'plain-home',
          repositoryId: agent.defaultRepositoryId,
          workspaceDir: agent.workspaceDir,
          branch: '',
        };
      },
    };
  }

  connect(taskLauncher: TaskLauncher, taskCanceller: TaskCanceller): void {
    this.taskLauncher = taskLauncher;
    this.taskCanceller = taskCanceller;
  }

  getTaskLaunch(taskId: string): ManagedTaskLaunch | undefined {
    return this.launches.get(taskId);
  }

  handlesTaskNotification(taskId: string): boolean {
    return this.orchestration.snapshot().tasks.some((task) => task.id === taskId && task.managed);
  }

  async start(runId: string): Promise<Run> {
    return this.serialized(runId, async () => {
      if (!this.taskLauncher) throw new Error('ade: orchestration task launcher is not connected');
      const snapshot = this.orchestration.snapshot();
      const run = requireRun(snapshot.runs, runId);
      if (run.status !== 'draft' || run.phase !== 'draft') {
        throw new Error('ade: only a fresh draft run can be orchestrated');
      }
      if (!run.goal.trim()) throw new Error('ade: a managed run needs a concrete goal');
      if (run.budget.maxApprovals < 1) {
        throw new Error('ade: managed orchestration needs an approval budget of at least 1');
      }
      if (snapshot.tasks.some((task) => task.runId === runId)) {
        throw new Error('ade: managed orchestration cannot start after direct tasks were created');
      }
      const participants = snapshot.participants.filter((participant) => participant.runId === runId);
      const orchestrators = participants.filter((participant) => participant.role === 'orchestrator');
      const workers = participants.filter((participant) => participant.role !== 'orchestrator');
      if (orchestrators.length !== 1) throw new Error('ade: managed orchestration needs exactly one orchestrator');
      if (workers.length === 0) throw new Error('ade: managed orchestration needs at least one lead or worker');

      const agents = new Map(this.store.get().agents.map((agent) => [agent.id, agent]));
      const roster = participants.map((participant) => ({
        participant,
        agent: requireAgent(agents, participant.agentId),
      }));
      for (const { agent } of roster) {
        const capabilities = this.adapters.capabilities(agent);
        if (capabilities.adapterId === 'file-mailbox-v1' && !resolveTaskLaunchCommand(
          agent,
          process.platform === 'win32' ? 'win32' : 'posix',
        )) {
          throw new Error(`ade: ${agent.name}'s runtime has no non-interactive managed-task transport`);
        }
        if (run.budget.maxInputTokens !== null && !capabilities.reportsTokens) {
          throw new Error(`ade: ${agent.name}'s ${capabilities.adapterId} adapter cannot enforce an input-token budget`);
        }
        if (run.budget.maxOutputTokens !== null && !capabilities.reportsTokens) {
          throw new Error(`ade: ${agent.name}'s ${capabilities.adapterId} adapter cannot enforce an output-token budget`);
        }
        if (run.budget.maxCostUsd !== null && !capabilities.reportsCost) {
          throw new Error(`ade: ${agent.name}'s ${capabilities.adapterId} adapter cannot enforce a cost budget`);
        }
      }

      const inspected = await Promise.all(roster.map(async ({ participant, agent }) => {
        const scope = await this.scopes.resolve(agent.id, { repositoryId: run.repositoryId });
        return {
          participant,
          agent,
          scope,
          workspace: await this.workspaces.inspect(scope.workspaceDir),
        };
      }));
      for (const item of inspected) {
        if (item.workspace.isRepo && !item.workspace.clean) {
          throw new Error(`ade: ${item.agent.name}'s worktree is not clean: ${item.scope.workspaceDir}`);
        }
        if (item.workspace.isRepo && !item.workspace.branch) {
          throw new Error(`ade: ${item.agent.name}'s worktree is detached; managed runs require a branch`);
        }
      }
      const repoItems = inspected.filter((item) => item.workspace.isRepo);
      if (repoItems.length > 0 && repoItems.length !== inspected.length) {
        throw new Error('ade: a managed run cannot mix git worktrees and plain workspaces');
      }
      if (repoItems.length > 1) {
        const common = repoItems[0]!.workspace.commonGitDir;
        if (repoItems.some((item) => item.workspace.commonGitDir !== common)) {
          throw new Error('ade: all managed-run worktrees must belong to the same git repository');
        }
      }

      this.orchestration.acquireWorkspaceLeases(runId, inspected.map(({ participant, agent, scope, workspace }) => ({
        participantId: participant.id,
        agentId: agent.id,
        workspaceDir: workspace.workspaceDir,
        isRepo: workspace.isRepo,
        branch: workspace.branch,
        baseSha: workspace.headSha,
        commonGitDir: workspace.commonGitDir,
        repositoryId: scope.repositoryId,
        workspaceBindingId: scope.workspaceBindingId,
      })));

      try {
        const started = this.orchestration.setManagedRunPhase(runId, 'planning');
        const orchestrator = orchestrators[0]!;
        const task = this.orchestration.createManagedTask({
          runId,
          participantId: orchestrator.id,
          title: 'Plan and decompose the run',
          phase: 'plan',
          prompt: planningPrompt(started, participants),
        });
        const orchestratorAgent = requireAgent(agents, orchestrator.agentId);
        this.mailbox.deliver(orchestratorAgent, {
          runId,
          taskId: task.id,
          toParticipantId: orchestrator.id,
          kind: 'plan',
          text: task.prompt,
        });
        await this.launchTask(task, 'plan');
        return this.orchestration.snapshot().runs.find((candidate) => candidate.id === runId)!;
      } catch (error) {
        await this.failRunCore(runId, errorMessage(error));
        throw error;
      }
    });
  }

  async cancel(runId: string, reason = 'Cancelled by user'): Promise<void> {
    await this.serialized(runId, async () => {
      const run = requireRun(this.orchestration.snapshot().runs, runId);
      if (isTerminalRun(run)) return;
      if (run.mode !== 'managed') throw new Error('ade: only managed runs use run cancellation');
      this.orchestration.cancelQueuedTasks(runId, reason);
      await this.cancelActiveTasks(runId);
      this.orchestration.setManagedRunPhase(runId, 'cancelled', reason);
      this.releaseIfDrained(runId);
    });
  }

  async resolveApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<void> {
    const approval = this.orchestration.snapshot().approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) throw new Error(`ade: approval not found "${approvalId}"`);
    await this.serialized(approval.runId, async () => {
      const run = requireRun(this.orchestration.snapshot().runs, approval.runId);
      if (run.status !== 'running' || run.phase !== 'approval') {
        throw new Error('ade: integration approval is no longer active');
      }
      const resolved = this.orchestration.resolveApproval(approvalId, decision);
      if (decision === 'reject') {
        this.orchestration.setManagedRunPhase(resolved.runId, 'cancelled', 'Integration approval rejected');
        this.releaseIfDrained(resolved.runId);
        return;
      }
      try {
        await this.beginIntegration(resolved.runId);
      } catch (error) {
        await this.failRunCore(resolved.runId, errorMessage(error));
        throw error;
      }
    });
  }

  onTaskStarted(taskId: string, session: SessionMeta): void {
    this.orchestration.onTaskStarted(taskId, session);
  }

  onTaskLaunchFailed(taskId: string, cancelled: boolean, error?: string): void {
    const task = this.orchestration.snapshot().tasks.find((candidate) => candidate.id === taskId);
    this.launches.delete(taskId);
    this.orchestration.onTaskLaunchFailed(taskId, cancelled, error);
    if (!task?.managed) return;
    this.notifyTask(task, cancelled ? 'cancelled' : 'failed', error);
    void this.serialized(task.runId, async () => {
      const run = requireRun(this.orchestration.snapshot().runs, task.runId);
      if (isTerminalRun(run)) {
        this.releaseIfDrained(task.runId);
        return;
      }
      await this.failRunCore(task.runId, error || 'Managed task launch failed');
    });
  }

  onTaskFinished(
    taskId: string,
    status: 'completed' | 'failed' | 'cancelled',
    exitCode: number,
    terminalOutput = '',
  ): void {
    const task = this.orchestration.snapshot().tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      this.launches.delete(taskId);
      if (task.managed) this.releaseIfDrained(task.runId);
      return;
    }
    if (!task.managed) {
      this.orchestration.onTaskFinished(taskId, status, exitCode);
      return;
    }
    void this.serialized(task.runId, async () => {
      const currentRun = requireRun(this.orchestration.snapshot().runs, task.runId);
      if (status !== 'completed') {
        this.launches.delete(taskId);
        this.orchestration.onTaskFinished(taskId, status, exitCode);
        this.notifyTask(task, status, `Process exit ${exitCode}`);
        if (isTerminalRun(currentRun)) {
          this.releaseIfDrained(task.runId);
        } else {
          await this.failRunCore(task.runId, `Managed task ${task.title} ${status} (exit ${exitCode})`);
        }
        return;
      }

      let launch: ManagedTaskLaunch | undefined;
      let result: StructuredTaskResult | undefined;
      let participant: RunParticipant | undefined;
      let agent: Agent | undefined;
      let recorded = false;
      try {
        launch = this.launches.get(taskId);
        if (!launch) throw new Error(`ade: missing runtime-adapter state for task ${taskId}`);
        result = this.adapters.readResult(launch, terminalOutput);
        participant = requireParticipant(
          this.orchestration.snapshot().participants,
          task.participantId,
          task.runId,
        );
        agent = requireAgent(new Map(this.store.get().agents.map((item) => [item.id, item])), participant.agentId);

        const budgetError = this.budgetError(task.runId, launch, result, true);
        if (!budgetError && result.outcome === 'succeeded') {
          await this.finalizeRepoResult(task, result, launch);
        }
        this.recordTaskResult(agent, task, participant, launch, result);
        recorded = true;
        this.launches.delete(taskId);

        if (budgetError) {
          this.orchestration.onTaskFinished(taskId, 'failed', exitCode, budgetError);
          this.notifyTask(task, 'failed', budgetError);
          await this.failRunCore(task.runId, budgetError);
          return;
        }

        if (result.outcome !== 'succeeded') {
          this.orchestration.onTaskFinished(taskId, 'failed', exitCode, result.summary);
          this.notifyTask(task, 'failed', result.summary);
          await this.failRunCore(task.runId, `${task.title}: ${result.summary}`);
          return;
        }
        await this.validateTaskResult(task, result);
        this.orchestration.onTaskFinished(taskId, 'completed', exitCode);
        this.routeResult(task, participant, result);
        await this.progress(task, result);
        this.notifyTask(task, 'completed', result.summary);
      } catch (error) {
        if (!recorded && launch && result && participant && agent) {
          try {
            this.recordTaskResult(agent, task, participant, launch, result);
          } catch (recordError) {
            console.error(`[ade] failed to persist rejected result for ${task.id}:`, recordError);
          }
        }
        this.launches.delete(taskId);
        this.orchestration.onTaskFinished(taskId, 'failed', exitCode, errorMessage(error));
        this.notifyTask(task, 'failed', errorMessage(error));
        await this.failRunCore(task.runId, errorMessage(error));
      }
    });
  }

  private recordTaskResult(
    agent: Agent,
    task: RunTask,
    participant: RunParticipant,
    launch: ManagedTaskLaunch,
    result: StructuredTaskResult,
  ): void {
    this.mailbox.recordResult(agent, task.runId, task.id, participant.id, result);
    this.orchestration.recordResult({
      runId: task.runId,
      taskId: task.id,
      participantId: task.participantId,
      adapterId: launch.adapterId,
      resultPath: launch.files.resultPath,
      result,
    });
  }

  private async finalizeRepoResult(
    task: RunTask,
    result: StructuredTaskResult,
    launch: ManagedTaskLaunch,
  ): Promise<void> {
    const lease = this.orchestration.snapshot().workspaceLeases.find(
      (item) => item.runId === task.runId && item.participantId === task.participantId && item.status === 'active',
    );
    if (!lease?.isRepo) return;
    if (!launch.workspaceHeadSha) throw new Error(`ade: task ${task.id} has no pre-launch Git HEAD`);
    if (result.commitSha) {
      throw new Error('ade: managed runtimes must not create commits; ADE owns validated task commits');
    }

    if (task.phase === 'work' || task.phase === 'integrate') {
      result.commitSha = await this.workspaces.commitChanges(
        lease.workspaceDir,
        launch.workspaceHeadSha,
        result.filesChanged,
        `ADE ${task.phase}: ${task.title}`,
      );
      return;
    }

    const inspection = await this.workspaces.inspect(lease.workspaceDir);
    if (inspection.headSha !== launch.workspaceHeadSha) {
      throw new Error(`ade: ${task.phase} task changed Git history; this phase is read-only`);
    }
  }

  private async progress(task: RunTask, result: StructuredTaskResult): Promise<void> {
    switch (task.phase) {
      case 'plan':
        await this.acceptPlan(task.runId, result);
        return;
      case 'work':
        await this.scheduleWork(task.runId);
        return;
      case 'integrate':
        await this.beginVerification(task.runId, result);
        return;
      case 'verify':
        await this.completeAfterVerification(task.runId, result);
        return;
      default:
        return;
    }
  }

  private async validateTaskResult(task: RunTask, result: StructuredTaskResult): Promise<void> {
    const snapshot = this.orchestration.snapshot();
    const lease = snapshot.workspaceLeases.find(
      (item) => item.runId === task.runId && item.participantId === task.participantId && item.status === 'active',
    );
    if (task.phase === 'plan') {
      if (result.filesChanged.length > 0 || result.commitSha) {
        throw new Error('ade: planning task modified the workspace; planning must be read-only');
      }
      const eligible = new Set(snapshot.participants
        .filter((participant) => participant.runId === task.runId && participant.role !== 'orchestrator')
        .map((participant) => participant.id));
      if (result.assignments.length === 0) throw new Error('ade: planner returned no worker assignments');
      const ids = result.assignments.map((assignment) => assignment.participantId);
      if (new Set(ids).size !== ids.length || ids.some((id) => !eligible.has(id))) {
        throw new Error('ade: planner returned duplicate, unknown, or ineligible participants');
      }
      for (const assignment of result.assignments) {
        if (assignment.dependsOn.some((id) => !ids.includes(id) || id === assignment.participantId)) {
          throw new Error(`ade: assignment ${assignment.participantId} has an invalid dependency`);
        }
      }
      assertAcyclic(result.assignments.map((assignment) => ({
        id: assignment.participantId,
        dependsOn: assignment.dependsOn,
      })));
    }
    if (task.phase === 'verify') {
      if (result.filesChanged.length > 0 || result.commitSha) {
        throw new Error('ade: verification changed the workspace; verification must be read-only');
      }
      if (result.tests.length === 0) throw new Error('ade: verification produced no command evidence');
    }
    if (lease?.isRepo) {
      if ((task.phase === 'work' || task.phase === 'integrate') &&
          result.filesChanged.length > 0 && !result.commitSha) {
        throw new Error(`ade: ${task.phase} task reported changed files without a commit`);
      }
      if (result.commitSha) {
        await this.workspaces.validateCommit(lease.workspaceDir, lease.baseSha, result.commitSha);
      }
      if (!(await this.workspaces.inspect(lease.workspaceDir)).clean) {
        throw new Error(`ade: ${task.phase} task left its leased worktree dirty`);
      }
    }
  }

  private async acceptPlan(runId: string, result: StructuredTaskResult): Promise<void> {
    if (result.filesChanged.length > 0 || result.commitSha) {
      throw new Error('ade: planning task modified the workspace; planning must be read-only');
    }
    const snapshot = this.orchestration.snapshot();
    const orchestratorLease = snapshot.workspaceLeases.find((lease) => {
      const participant = snapshot.participants.find((item) => item.id === lease.participantId);
      return lease.runId === runId && lease.status === 'active' && participant?.role === 'orchestrator';
    });
    if (orchestratorLease?.isRepo && !(await this.workspaces.inspect(orchestratorLease.workspaceDir)).clean) {
      throw new Error('ade: planning changed the orchestrator worktree; planning must be read-only');
    }
    const participants = snapshot.participants.filter((participant) => participant.runId === runId);
    const eligible = new Set(participants
      .filter((participant) => participant.role !== 'orchestrator')
      .map((participant) => participant.id));
    if (result.assignments.length === 0) throw new Error('ade: planner returned no worker assignments');
    const seen = new Set<string>();
    for (const assignment of result.assignments) {
      if (!eligible.has(assignment.participantId)) {
        throw new Error(`ade: planner assigned unknown or ineligible participant ${assignment.participantId}`);
      }
      if (seen.has(assignment.participantId)) {
        throw new Error(`ade: planner assigned participant ${assignment.participantId} more than once`);
      }
      seen.add(assignment.participantId);
    }
    for (const assignment of result.assignments) {
      if (assignment.dependsOn.some((participantId) => !seen.has(participantId))) {
        throw new Error(`ade: assignment ${assignment.participantId} has an unknown dependency`);
      }
      if (assignment.dependsOn.includes(assignment.participantId)) {
        throw new Error(`ade: assignment ${assignment.participantId} depends on itself`);
      }
    }
    assertAcyclic(result.assignments.map((assignment) => ({
      id: assignment.participantId,
      dependsOn: assignment.dependsOn,
    })));

    this.orchestration.setManagedRunPhase(runId, 'working');
    const run = requireRun(this.orchestration.snapshot().runs, runId);
    for (const assignment of result.assignments) {
      const task = this.orchestration.createManagedTask({
        runId,
        participantId: assignment.participantId,
        title: assignment.title,
        phase: 'work',
        dependsOn: assignment.dependsOn,
        prompt: workerPrompt(run, assignment),
      });
      const participant = requireParticipant(participants, assignment.participantId, runId);
      const agent = requireAgent(new Map(this.store.get().agents.map((item) => [item.id, item])), participant.agentId);
      this.mailbox.deliver(agent, {
        runId,
        taskId: task.id,
        fromParticipantId: participants.find((item) => item.role === 'orchestrator')?.id,
        toParticipantId: participant.id,
        kind: 'assignment',
        text: `${assignment.title}\n\n${assignment.prompt}`,
      });
    }
    await this.scheduleWork(runId);
  }

  private async scheduleWork(runId: string): Promise<void> {
    const snapshot = this.orchestration.snapshot();
    const run = requireRun(snapshot.runs, runId);
    if (run.phase !== 'working') return;
    const workTasks = snapshot.tasks.filter((task) => task.runId === runId && task.phase === 'work');
    if (workTasks.some((task) => task.status === 'failed' || task.status === 'cancelled')) {
      await this.failRunCore(runId, 'One or more worker tasks did not complete');
      return;
    }
    if (workTasks.length > 0 && workTasks.every((task) => task.status === 'completed')) {
      const results = snapshot.results.filter((item) => workTasks.some((task) => task.id === item.taskId));
      const leases = snapshot.workspaceLeases.filter((lease) => lease.runId === runId && lease.status === 'active');
      const rangeCounts = new Map<string, number>();
      let validatedCommitCount = 0;
      for (const result of results) {
        const lease = leases.find((item) => item.participantId === result.participantId);
        if (!lease?.isRepo) continue;
        if (!(await this.workspaces.inspect(lease.workspaceDir)).clean) {
          await this.failRunCore(runId, `${result.participantId} left its leased worktree dirty`);
          return;
        }
        if (result.filesChanged.length > 0 && !result.commitSha) {
          await this.failRunCore(runId, `${result.participantId} reported changed files without a commit`);
          return;
        }
        if (result.commitSha) {
          try {
            const range = await this.workspaces.validateCommit(lease.workspaceDir, lease.baseSha, result.commitSha);
            rangeCounts.set(result.id, range.length);
            validatedCommitCount += range.length;
          } catch (error) {
            await this.failRunCore(runId, errorMessage(error));
            return;
          }
        }
      }
      if (validatedCommitCount > 200) {
        await this.failRunCore(runId, 'Run integration exceeds 200 worker commits');
        return;
      }
      const changed = results.reduce((count, item) => count + item.filesChanged.length, 0);
      const details = workTasks.map((task) => {
        const item = results.find((result) => result.taskId === task.id);
        return `${task.title}: commit ${item?.commitSha ?? 'none'}, ` +
          `range ${item ? (rangeCounts.get(item.id) ?? 0) : 0}, ${item?.filesChanged.length ?? 0} file(s), ` +
          `risks ${item?.risks.join('; ').slice(0, 300) || 'none'}`;
      }).join('\n').slice(0, 3_000);
      try {
        this.orchestration.requestIntegrationApproval(
          runId,
          `${workTasks.length} worker task(s) completed with ${changed} changed-file report(s) and ` +
          `${validatedCommitCount} validated commit(s). ` +
          'Approve to integrate their commits into the orchestrator worktree and run integration plus verification.\n' +
          details,
        );
        this.orchestration.setManagedRunPhase(runId, 'approval');
      } catch (error) {
        await this.failRunCore(runId, errorMessage(error));
      }
      return;
    }

    const completedParticipants = new Set(workTasks
      .filter((task) => task.status === 'completed')
      .map((task) => task.participantId));
    let launched = workTasks.filter((task) =>
      task.status === 'running' || (task.status === 'queued' && this.launches.has(task.id))).length;
    while (launched < run.budget.maxConcurrentTasks) {
      const next = workTasks.find((task) =>
        task.status === 'queued' &&
        !this.launches.has(task.id) &&
        task.dependsOn.every((participantId) => completedParticipants.has(participantId)));
      if (!next) break;
      await this.launchTask(next, `work-${next.participantId}`);
      launched += 1;
    }
    const blocked = workTasks.filter((task) => task.status === 'queued' && !this.launches.has(task.id));
    const active = workTasks.some((task) => task.status === 'running' || this.launches.has(task.id));
    if (blocked.length > 0 && !active) {
      await this.failRunCore(runId, 'Worker dependency graph made no scheduling progress');
    }
  }

  private async beginIntegration(runId: string): Promise<void> {
    this.orchestration.setManagedRunPhase(runId, 'integrating');
    const snapshot = this.orchestration.snapshot();
    const run = requireRun(snapshot.runs, runId);
    const participants = snapshot.participants.filter((participant) => participant.runId === runId);
    const orchestrator = participants.find((participant) => participant.role === 'orchestrator');
    if (!orchestrator) throw new Error('ade: integration has no orchestrator participant');
    const workTasks = snapshot.tasks.filter((task) => task.runId === runId && task.phase === 'work');
    const results = snapshot.results.filter((result) => workTasks.some((task) => task.id === result.taskId));
    const leases = snapshot.workspaceLeases.filter((lease) => lease.runId === runId && lease.status === 'active');
    const integratorLease = leases.find((lease) => lease.participantId === orchestrator.id);
    if (!integratorLease) throw new Error('ade: integration workspace lease is missing');

    let applied = 0;
    if (integratorLease.isRepo) {
      const commits: string[] = [];
      for (const result of results) {
        if (result.filesChanged.length > 0 && !result.commitSha) {
          throw new Error(`ade: ${result.participantId} reported changed files without a commit`);
        }
        if (!result.commitSha) continue;
        const workerLease = leases.find((lease) => lease.participantId === result.participantId);
        if (!workerLease?.isRepo || workerLease.commonGitDir !== integratorLease.commonGitDir) {
          throw new Error('ade: worker commit is not from the leased integration repository');
        }
        const workerCommits = await this.workspaces.validateCommit(
          workerLease.workspaceDir,
          workerLease.baseSha,
          result.commitSha,
        );
        commits.push(...workerCommits);
      }
      if (commits.length > 200) throw new Error('ade: run integration exceeds 200 worker commits');
      applied = await this.workspaces.integrateCommits(integratorLease.workspaceDir, commits);
    }
    this.orchestration.markIntegrationApplied(runId, applied);

    const task = this.orchestration.createManagedTask({
      runId,
      participantId: orchestrator.id,
      title: 'Review and stabilize integrated work',
      phase: 'integrate',
      prompt: integrationPrompt(run, results, applied, integratorLease.isRepo),
    });
    const agent = requireAgent(new Map(this.store.get().agents.map((item) => [item.id, item])), orchestrator.agentId);
    this.mailbox.deliver(agent, {
      runId,
      taskId: task.id,
      toParticipantId: orchestrator.id,
      kind: 'integration',
      text: task.prompt,
    });
    await this.launchTask(task, 'integration');
  }

  private async beginVerification(runId: string, integration: StructuredTaskResult): Promise<void> {
    const snapshot = this.orchestration.snapshot();
    const run = requireRun(snapshot.runs, runId);
    const orchestrator = snapshot.participants.find(
      (participant) => participant.runId === runId && participant.role === 'orchestrator',
    );
    if (!orchestrator) throw new Error('ade: verification has no orchestrator participant');
    const lease = snapshot.workspaceLeases.find(
      (item) => item.runId === runId && item.participantId === orchestrator.id && item.status === 'active',
    );
    if (lease?.isRepo) {
      if (integration.filesChanged.length > 0 && !integration.commitSha) {
        throw new Error('ade: integration task reported changed files without a commit');
      }
      if (integration.commitSha) {
        await this.workspaces.validateCommit(lease.workspaceDir, lease.baseSha, integration.commitSha);
      }
      const inspection = await this.workspaces.inspect(lease.workspaceDir);
      if (!inspection.clean) {
        throw new Error('ade: integration task left uncommitted changes; verification will not start');
      }
    }
    this.orchestration.setManagedRunPhase(runId, 'verifying');
    const task = this.orchestration.createManagedTask({
      runId,
      participantId: orchestrator.id,
      title: 'Verify the integrated result',
      phase: 'verify',
      prompt: verificationPrompt(run, integration),
    });
    const agent = requireAgent(new Map(this.store.get().agents.map((item) => [item.id, item])), orchestrator.agentId);
    this.mailbox.deliver(agent, {
      runId,
      taskId: task.id,
      toParticipantId: orchestrator.id,
      kind: 'verification',
      text: task.prompt,
    });
    await this.launchTask(task, 'verification');
  }

  private async completeAfterVerification(runId: string, result: StructuredTaskResult): Promise<void> {
    if (result.filesChanged.length > 0 || result.commitSha) {
      throw new Error('ade: verification changed the workspace; verification must be read-only');
    }
    if (result.tests.length === 0) {
      throw new Error('ade: verification produced no command evidence');
    }
    if (result.tests.some((test) => test.status === 'failed')) {
      throw new Error('ade: verification reported one or more failed tests');
    }
    const snapshot = this.orchestration.snapshot();
    const orchestrator = snapshot.participants.find(
      (participant) => participant.runId === runId && participant.role === 'orchestrator',
    );
    const lease = snapshot.workspaceLeases.find(
      (item) => item.runId === runId && item.participantId === orchestrator?.id && item.status === 'active',
    );
    if (lease?.isRepo && !(await this.workspaces.inspect(lease.workspaceDir)).clean) {
      throw new Error('ade: verification left the integration worktree dirty');
    }
    this.orchestration.setManagedRunPhase(runId, 'completed', result.summary);
    this.orchestration.releaseWorkspaceLeases(runId);
  }

  private async launchTask(task: RunTask, label: string): Promise<void> {
    if (!this.taskLauncher) throw new Error('ade: orchestration task launcher is not connected');
    const participant = requireParticipant(
      this.orchestration.snapshot().participants,
      task.participantId,
      task.runId,
    );
    const agent = requireAgent(new Map(this.store.get().agents.map((item) => [item.id, item])), participant.agentId);
    const lease = this.orchestration.snapshot().workspaceLeases.find(
      (item) => item.runId === task.runId && item.participantId === participant.id && item.status === 'active',
    );
    if (!lease) throw new Error(`ade: active workspace lease is missing for task ${task.id}`);
    let workspaceHeadSha: string | undefined;
    if (lease.isRepo) {
      const inspection = await this.workspaces.inspect(lease.workspaceDir);
      if (!inspection.isRepo || inspection.commonGitDir !== lease.commonGitDir) {
        throw new Error(`ade: leased repository identity changed before task ${task.id}`);
      }
      if (!inspection.clean) throw new Error(`ade: leased worktree is dirty before task ${task.id}`);
      workspaceHeadSha = inspection.headSha;
    }
    const files = this.mailbox.taskFiles(agent, task.runId, task.id);
    const launch = this.adapters.prepare(
      agent,
      task,
      task.prompt,
      files,
      process.platform === 'win32' ? 'win32' : 'posix',
    );
    launch.workspaceHeadSha = workspaceHeadSha;
    this.launches.set(task.id, launch);
    try {
      const pending = this.taskLauncher(
        agent.id,
        task.prompt,
        `run-${task.runId}-${label}`,
        task.id,
        lease.repositoryId ?? null,
        lease.workspaceBindingId,
      );
      // A global PTY slot may be busy for minutes. Keep the run coordinator
      // cancellable while PtyManager owns that pending FIFO acquisition.
      void pending.catch((error) => {
        const current = this.orchestration.snapshot().tasks.find((candidate) => candidate.id === task.id);
        if (current?.status === 'queued') this.onTaskLaunchFailed(task.id, false, errorMessage(error));
      });
    } catch (error) {
      const current = this.orchestration.snapshot().tasks.find((candidate) => candidate.id === task.id);
      if (current?.status === 'queued') this.onTaskLaunchFailed(task.id, false, errorMessage(error));
      throw error;
    }
  }

  private routeResult(
    task: RunTask,
    participant: RunParticipant,
    result: StructuredTaskResult,
  ): void {
    if (task.phase !== 'work') return;
    const snapshot = this.orchestration.snapshot();
    const orchestrator = snapshot.participants.find(
      (candidate) => candidate.runId === task.runId && candidate.role === 'orchestrator',
    );
    if (!orchestrator) return;
    const agent = this.store.get().agents.find((candidate) => candidate.id === orchestrator.agentId);
    if (!agent) return;
    this.mailbox.deliver(agent, {
      runId: task.runId,
      taskId: task.id,
      fromParticipantId: participant.id,
      toParticipantId: orchestrator.id,
      kind: 'result',
      text: `${task.title}: ${result.summary.slice(0, 2_000)}\nCommit: ${result.commitSha ?? 'none'}\n` +
        `Tests: ${result.tests.slice(0, 20)
          .map((test) => `${test.status} ${test.command.slice(0, 240)}`)
          .join('; ') || 'none reported'}`,
    });
  }

  private budgetError(
    runId: string,
    launch: ManagedTaskLaunch,
    result: StructuredTaskResult,
    projected = false,
  ): string | null {
    const snapshot = this.orchestration.snapshot();
    const run = requireRun(snapshot.runs, runId);
    const usage = snapshot.usageByRun[runId]!;
    const checks: Array<{
      kind: string;
      limit: number | null;
      used: number;
      reported: number | null;
      supported: boolean;
    }> = [
      { kind: 'input tokens', limit: run.budget.maxInputTokens,
        used: usage.inputTokens + (projected ? (result.usage.inputTokens ?? 0) : 0),
        reported: result.usage.inputTokens, supported: launch.reportsTokens },
      { kind: 'output tokens', limit: run.budget.maxOutputTokens,
        used: usage.outputTokens + (projected ? (result.usage.outputTokens ?? 0) : 0),
        reported: result.usage.outputTokens, supported: launch.reportsTokens },
      { kind: 'cost USD', limit: run.budget.maxCostUsd,
        used: usage.costUsd + (projected ? (result.usage.costUsd ?? 0) : 0),
        reported: result.usage.costUsd, supported: launch.reportsCost },
    ];
    for (const check of checks) {
      if (check.limit === null) continue;
      if (!check.supported || check.reported === null) {
        return `ade: ${check.kind} budget requires adapter telemetry, but ${launch.adapterId} reported none`;
      }
      if (check.used > check.limit) {
        this.orchestration.recordBudgetExhausted(runId, check.kind, check.used, check.limit);
        return `ade: ${check.kind} budget exhausted (${check.used}/${check.limit})`;
      }
    }
    return null;
  }

  private notifyTask(
    task: RunTask,
    outcome: 'completed' | 'failed' | 'cancelled',
    _detail?: string,
  ): void {
    const participant = this.orchestration.snapshot().participants.find(
      (item) => item.id === task.participantId && item.runId === task.runId,
    );
    showManagedTaskNotification(
      participant?.agentName ?? 'Agent',
      outcome,
      outcome === 'completed'
        ? `${task.title.slice(0, 160)} passed validation.`
        : `${task.title.slice(0, 160)} did not pass validation.`,
    );
  }

  private async failRunCore(runId: string, reason: string): Promise<void> {
    const run = this.orchestration.snapshot().runs.find((candidate) => candidate.id === runId);
    if (!run || isTerminalRun(run)) {
      this.releaseIfDrained(runId);
      return;
    }
    this.orchestration.cancelQueuedTasks(runId, reason);
    await this.cancelActiveTasks(runId);
    this.orchestration.setManagedRunPhase(runId, 'failed', reason);
    this.releaseIfDrained(runId);
  }

  private async cancelActiveTasks(runId: string): Promise<void> {
    const ids = this.orchestration.snapshot().tasks
      .filter((task) => task.runId === runId && (
        task.status === 'queued' || task.status === 'running' || this.launches.has(task.id)
      ))
      .map((task) => task.id);
    if (ids.length > 0) await this.taskCanceller?.(ids);
  }

  private releaseIfDrained(runId: string): void {
    const snapshot = this.orchestration.snapshot();
    const active = snapshot.tasks.some(
      (task) => task.runId === runId && (
        task.status === 'queued' || task.status === 'running' || this.launches.has(task.id)
      ),
    );
    if (!active) this.orchestration.releaseWorkspaceLeases(runId);
  }

  private serialized<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runChains.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const marker = next.then(() => undefined, () => undefined);
    this.runChains.set(runId, marker);
    void marker.finally(() => {
      if (this.runChains.get(runId) === marker) this.runChains.delete(runId);
    });
    return next;
  }
}

function planningPrompt(run: Run, participants: RunParticipant[]): string {
  const eligible = participants.filter((participant) => participant.role !== 'orchestrator');
  return [
    'You are the ADE run orchestrator. Plan only; do not edit files, run destructive commands, or commit.',
    `Run goal: ${run.goal}`,
    'Create worker-specific, non-overlapping assignments using only the participant IDs below.',
    'Use dependsOn only for genuine sequencing. Every assignment needs concrete acceptance criteria and verification.',
    'Return one assignment per selected participant; do not assign the orchestrator.',
    'Eligible participants:',
    ...eligible.map((participant) =>
      `- ${participant.id} | ${participant.agentName.slice(0, 80)} | ${participant.role} | ` +
      `${(participant.teamName ?? 'unassigned').slice(0, 80)}`),
  ].join('\n');
}

function workerPrompt(run: Run, assignment: StructuredTaskResult['assignments'][number]): string {
  return [
    `Run goal: ${run.goal}`,
    `Your owned assignment: ${assignment.title}`,
    assignment.prompt,
    'Acceptance criteria:',
    ...assignment.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    'Work only in your leased workspace. Inspect existing conventions before editing.',
    'Run focused verification and report the exact repository-relative paths you changed.',
    'Do not run git add, git commit, reset, checkout, rebase, merge, or push. Return commitSha=null; ADE validates the exact diff and creates the task commit.',
    'Do not claim tests passed unless you actually ran them. Report blockers as outcome=blocked.',
  ].join('\n');
}

function integrationPrompt(
  run: Run,
  results: Array<StructuredTaskResult & { participantId?: string }>,
  applied: number,
  repoBacked: boolean,
): string {
  const reports = results
    .map((result) => `- ${result.summary.slice(0, 500)} (commit ${result.commitSha ?? 'none'}; ` +
      `risks ${result.risks.join('; ').slice(0, 300) || 'none'}; ` +
      `tests ${result.tests.map((test) => test.status).join(', ') || 'none'})`)
    .join('\n')
    .slice(0, 18_000);
  return [
    `Run goal: ${run.goal}`,
    repoBacked
      ? `ADE already cherry-picked ${applied} validated worker commit(s) into this integration worktree.`
      : 'This is a plain-workspace run; reconcile the worker reports without claiming git integration.',
    'Review the combined result for conflicts, missing behavior, security regressions, and consistency.',
    'Run relevant focused tests. Fix integration-only issues if needed.',
    'Report the exact repository-relative paths you change. Do not run git add, git commit, reset, checkout, rebase, merge, or push.',
    'Return commitSha=null; ADE validates and commits any integration-only diff after you exit.',
    'Worker reports:',
    reports,
  ].join('\n');
}

function verificationPrompt(run: Run, integration: StructuredTaskResult): string {
  return [
    `Run goal: ${run.goal}`,
    `Integration summary: ${integration.summary}`,
    'Verify the final integrated workspace. This phase is strictly read-only: do not edit or commit.',
    'Run the repository test/typecheck/build commands appropriate to the changed scope.',
    'Report every command and its real status. outcome must be failed if any required check fails.',
  ].join('\n');
}

function assertAcyclic(items: Array<{ id: string; dependsOn: string[] }>): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('ade: planner returned a cyclic dependency graph');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of items) visit(item.id);
}

function requireRun(runs: Run[], runId: string): Run {
  const run = runs.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`ade: run not found "${runId}"`);
  return run;
}

function requireParticipant(
  participants: RunParticipant[],
  participantId: string,
  runId: string,
): RunParticipant {
  const participant = participants.find(
    (candidate) => candidate.id === participantId && candidate.runId === runId,
  );
  if (!participant) throw new Error(`ade: run participant not found "${participantId}"`);
  return participant;
}

function requireAgent(agents: Map<string, Agent>, agentId: string): Agent {
  const agent = agents.get(agentId);
  if (!agent) throw new Error(`ade: run agent is no longer available "${agentId}"`);
  return agent;
}

function isTerminalRun(run: Run): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
