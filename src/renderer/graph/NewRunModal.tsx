import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** New-run dialog: goal, orchestrator, repository scope, budgets and team roster. */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  MAX_TASK_MINUTES_LIMIT,
  type Agent,
  type Category,
  type Repository,
  type RunCreateInput,
  type RuntimeId,
} from '../../shared/types';
import { MANAGED_HARNESS_OVERRIDES } from '../../shared/runtimes';
import type { WslDistributionInfo } from '../../shared/ipc';
import {
  NATIVE_EXECUTION_BACKEND,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import { useAppData } from '../stores/appdata';
import { runtimeVisual } from './runtimeGlyphs';
import { RepositorySyncPanel } from '../repositories/RepositorySyncPanel';
import { I, Ico } from './graphIcons';
// Also opened from the Work view without the graph, so it loads the graph styles itself.
import './graph.css';

export function NewRunModal(props: {
  categories: Category[];
  agents: Record<string, Agent>;
  repositories: Repository[];
  suggestedName: string;
  onCancel: () => void;
  onCreate: (input: RunCreateInput) => Promise<void>;
}): JSX.Element {
  useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (opener?.isConnected) opener.focus(); else document.querySelector<HTMLElement>('.appnav [aria-selected="true"]')?.focus(); };
  }, []);
  const [name, setName] = useState(props.suggestedName);
  const [goal, setGoal] = useState('');
  const [goalPasteOverflow, setGoalPasteOverflow] = useState(false);
  const [orchestratorId, setOrchestratorId] = useState('');
  const [repositoryId, setRepositoryId] = useState(
    props.repositories.length === 1 ? props.repositories[0]!.id : '',
  );
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  /** Per-run harness override per agent id; absent = agent's own runtime. */
  const [harness, setHarness] = useState<Record<string, RuntimeId>>({});
  const importRepository = useAppData((state) => state.importRepository);
  /** null = hidden; string = direct native/WSL repository path entry. */
  const [manualPath, setManualPath] = useState<string | null>(null);
  const [importBackend, setImportBackend] = useState<ExecutionBackendId>(NATIVE_EXECUTION_BACKEND);
  const [wslDistributions, setWslDistributions] = useState<WslDistributionInfo[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(2);
  const [maxInputTokens, setMaxInputTokens] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [maxApprovals, setMaxApprovals] = useState(1);
  /** Empty = no wall-clock limit per managed task. */
  const [maxTaskMinutes, setMaxTaskMinutes] = useState('60');
  /** Explicit opt-in: archive and reset divergent worktrees onto the orchestrator base. */
  const [resetWorktrees, setResetWorktrees] = useState(false);
  const [allowQuestions, setAllowQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allAgents = Object.values(props.agents);
  const availableCategories = props.categories.filter(
    (category) => category.agents.some((agentId) => props.agents[agentId]),
  );

  const toggleAgent = (category: Category, agentId: string): void => {
    if (agentId === orchestratorId) return;
    setSelected((current) => {
      const next = { ...current };
      if (next[agentId]) delete next[agentId];
      else next[agentId] = true;
      const selectedInTeam = category.agents.filter((id) => next[id] && props.agents[id]);
      setLeaders((currentLeaders) => {
        const nextLeaders = { ...currentLeaders };
        if (!selectedInTeam.length) delete nextLeaders[category.id];
        else if (!selectedInTeam.includes(nextLeaders[category.id] ?? '')) {
          nextLeaders[category.id] = selectedInTeam[0]!;
        }
        return nextLeaders;
      });
      return next;
    });
  };

  const chooseOrchestrator = (agentId: string): void => {
    setOrchestratorId(agentId);
    if (!agentId) return;
    setSelected((current) => {
      if (!current[agentId]) return current;
      const next = { ...current };
      delete next[agentId];
      const category = props.categories.find((candidate) => candidate.agents.includes(agentId));
      if (category) {
        const selectedInTeam = category.agents.filter((id) => next[id] && props.agents[id]);
        setLeaders((currentLeaders) => ({
          ...currentLeaders,
          [category.id]: selectedInTeam[0] ?? '',
        }));
      }
      return next;
    });
  };

  const participantCount = Object.keys(selected).length + (orchestratorId ? 1 : 0);
  const harnessFor = (agentId: string): RuntimeId | undefined => {
    const agent = props.agents[agentId];
    const override = harness[agentId];
    return agent && override && override !== agent.runtime ? override : undefined;
  };
  const harnessOptions = (agent: Agent): RuntimeId[] => [
    agent.runtime,
    ...MANAGED_HARNESS_OVERRIDES.filter((runtime) => runtime !== agent.runtime),
  ];
  const toggleManualPath = (): void => {
    setManualPath((current) => (current === null ? '' : null));
    if (manualPath === null && wslDistributions.length === 0) {
      void window.ade.invoke('wsl:list')
        .then((result) => setWslDistributions(result.distributions))
        .catch(() => setWslDistributions([]));
    }
  };
  const importManualPath = async (): Promise<void> => {
    const path = (manualPath ?? '').trim();
    if (!path || importBusy) return;
    setImportBusy(true);
    setError(null);
    try {
      const repository = await importRepository(path, undefined, importBackend);
      setRepositoryId(repository.id);
      setManualPath(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImportBusy(false);
    }
  };
  const submit = async (): Promise<void> => {
    if (!name.trim() || participantCount === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const participants: RunCreateInput['participants'] = [];
      if (orchestratorId) {
        const runtime = harnessFor(orchestratorId);
        participants.push({
          agentId: orchestratorId,
          role: 'orchestrator',
          ...(runtime ? { runtime } : {}),
        });
      }
      for (const category of availableCategories) {
        const memberIds = category.agents.filter((agentId) => selected[agentId] && props.agents[agentId]);
        if (!memberIds.length) continue;
        const leadId = memberIds.includes(leaders[category.id] ?? '')
          ? leaders[category.id]!
          : memberIds[0]!;
        const teamId = globalThis.crypto?.randomUUID?.()
          ?? `team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        for (const agentId of memberIds) {
          const runtime = harnessFor(agentId);
          participants.push({
            agentId,
            role: agentId === leadId ? 'lead' : 'worker',
            teamId,
            teamName: category.name,
            ...(runtime ? { runtime } : {}),
          });
        }
      }
      const optionalNumber = (value: string): number | null => value.trim() ? Number(value) : null;
      await props.onCreate({
        name: name.trim(),
        goal: goal.trim(),
        ...(allowQuestions ? { allowQuestions: true } : {}),
        repositoryId: repositoryId || null,
        participants,
        budget: {
          maxConcurrentTasks,
          maxInputTokens: optionalNumber(maxInputTokens),
          maxOutputTokens: optionalNumber(maxOutputTokens),
          maxCostUsd: optionalNumber(maxCostUsd),
          maxApprovals,
          maxTaskMinutes: optionalNumber(maxTaskMinutes),
        },
        ...(repositoryId && resetWorktrees ? { workspacePrepare: 'reset-to-base' as const } : {}),
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      setSubmitting(false);
    }
  };

  return (
    <div className="gcomposer-back" onPointerDown={() => { if (!submitting) props.onCancel(); }}>
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-run-title"
        className="grun-modal"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); if (!submitting) props.onCancel(); }
          if (event.key !== 'Tab') return;
          const nodes = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []).filter(node => node.getClientRects().length > 0);
          const first = nodes[0]; const last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="grun-modal-head">
          <div><h2 id="new-run-title">{translate("New Run")}</h2><p>{translate("Putting together existing agents for a specific goal")}</p></div>
          <button type="button" className="ginsp-close" title={translate("Close [5363686c]")} onClick={props.onCancel}><Ico>{I.close}</Ico></button>
        </div>
        <div className="grun-modal-body">
          <label className="grun-field">
            <span>{translate("Name")}</span>
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grun-field">
            <span>{translate("Objective")}</span>
            <textarea
              value={goal}
              maxLength={1_000}
              onChange={(event) => setGoal(event.target.value)}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text');
                const field = event.currentTarget;
                const replaced = field.selectionEnd - field.selectionStart;
                if (goal.length - replaced + pasted.length > 1_000) setGoalPasteOverflow(true);
              }}
              placeholder={translate("Expected result of this run")}
            />
            <small className="grun-goal-meta">
              {goal.split('\n').length > 1 ? translate("{{value1}} lines · ", { value1: goal.split('\n').length }) : ''}{goal.length} / 1000
            </small>
            {goalPasteOverflow && goal.length >= 1_000 && (
              <small className="grun-goal-warn">
                {translate("The pasted text exceeded 1,000 characters and was truncated. Review the complete goal before creating the run.")}</small>
            )}
          </label>
          <label className="grun-field">
            <span>{translate("Orchestrator")}</span>
            <select value={orchestratorId} onChange={(event) => chooseOrchestrator(event.target.value)}>
              <option value="">{translate("None")}</option>
              {allAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          {orchestratorId && props.agents[orchestratorId] ? (
            <label className="grun-field">
              <span>{translate("Harness")}</span>
              <select
                aria-label={translate("Harness for {{value1}}", { value1: props.agents[orchestratorId]!.name })}
                value={harness[orchestratorId] ?? props.agents[orchestratorId]!.runtime}
                onChange={(event) => setHarness((current) => ({
                  ...current,
                  [orchestratorId]: event.target.value as RuntimeId,
                }))}
              >
                {harnessOptions(props.agents[orchestratorId]!).map((runtime) => (
                  <option key={runtime} value={runtime}>
                    {runtimeVisual(runtime).label}
                    {runtime === props.agents[orchestratorId]!.runtime ? ' (Agent-Standard)' : ''}
                  </option>
                ))}
              </select>
              <small className="grun-hint">
                {translate("Applies only to this run. The selected CLI must be installed and logged in (Diagnostics).")}</small>
            </label>
          ) : null}
          <label className="grun-field">
            <span>{translate("Repository")}</span>
            <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
              <option value="">{translate("No repository (portable agent homes)")}</option>
              {[...props.repositories]
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((repository) => (
                  <option key={repository.id} value={repository.id}>{repository.name}</option>
                ))}
            </select>
            <small className="grun-hint">
              {repositoryId
                ? translate("Each participant works in their own ADE worktree of this repository; the scope is frozen per task.")
                : translate("Without a repository, all participants work in their home directories (no shared git state).")}
            </small>
          </label>
          {repositoryId ? (
            <div className="grun-field grun-prepare">
              <details>
                <summary>{translate("Check and update git base before the run")}</summary>
                <RepositorySyncPanel key={repositoryId} repositoryId={repositoryId} />
              </details>
              <span id="grun-prepare-label">{translate("Worktrees")}</span>
              <label className="grun-prepare-choice">
                <input
                  type="checkbox"
                  aria-describedby="grun-prepare-hint"
                  checked={resetWorktrees}
                  onChange={(event) => setResetWorktrees(event.target.checked)}
                />
                <span>{translate("Reset diverging participant worktrees to the orchestrator base")}</span>
              </label>
              <small className="grun-hint" id="grun-prepare-hint">
                {resetWorktrees
                  ? translate("Before starting, ADE archives each diverging worktree under refs/ade/archive/<run>/<participant>, then resets it to the orchestrator worktree HEAD. Dirty worktrees and worktrees used by an active run are left untouched.")
                  : translate("Without this option, starting stops if a participant worktree differs from the orchestrator worktree HEAD and lists the affected worktrees.")}
              </small>
            </div>
          ) : null}
          <div className="grun-repo-import">
              <button
                type="button"
                className="gact"
                aria-expanded={manualPath !== null}
                title={translate("Enter and import repository path directly")}
                onClick={toggleManualPath}
              >
                {translate("Path …")}</button>
              {manualPath !== null && (
                <>
                  <select
                    aria-label={translate("Execution backend")}
                    value={importBackend}
                    disabled={importBusy}
                    onChange={(event) => setImportBackend(event.target.value as ExecutionBackendId)}
                  >
                    <option value={NATIVE_EXECUTION_BACKEND}>{translate("Native")}</option>
                    {wslDistributions.map((distribution) => (
                      // Advisory only — a cold WSL VM can miss the probe window.
                      <option key={distribution.backend} value={distribution.backend}>
                        {translate("WSL ·")}{" "}{distribution.name}{distribution.available ? '' : ' (unavailable?)'}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    aria-label={translate("Repository path")}
                    placeholder={importBackend === NATIVE_EXECUTION_BACKEND
                      ? translate("C:\\repos\\project")
                      : translate("/home/name/project")}
                    value={manualPath}
                    disabled={importBusy}
                    onChange={(event) => setManualPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void importManualPath();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="gact"
                    disabled={importBusy || manualPath.trim().length === 0}
                    onClick={() => void importManualPath()}
                  >
                    {translate("Import")}</button>
                </>
              )}
            </div>

          <label><input type="checkbox" checked={allowQuestions} onChange={(event) => setAllowQuestions(event.target.checked)} />{translate("Allow queries during the run (native Codex agents)")}</label>
          {allowQuestions && <p>{translate("Codex can ask questions in the graph and on the tablet. Blocking queries pause the time limit of the respective task. All selected runtimes must be native Codex agents.")}</p>}
          {!allowQuestions && <p>{translate("Without this option the agent cannot ask you anything during the job. A question in its reply ends the job; you can answer it in the result.")}</p>}
          <div className="grun-budget-title">
            <span>{translate("Run budgets")}</span>
            <small>{translate("Empty token/cost/time fields = no limit; token/cost limits require adapter telemetry.")}</small>
          </div>
          <div className="grun-budget">
            <label>
              <span>{translate("Parallel")}</span>
              <input
                type="number"
                min={1}
                max={4}
                value={maxConcurrentTasks}
                onChange={(event) => setMaxConcurrentTasks(Number(event.target.value))}
              />
            </label>
            <label>
              <span>{translate("Input tokens")}</span>
              <input
                type="number"
                min={1}
                placeholder={translate("Unlimited")}
                value={maxInputTokens}
                onChange={(event) => setMaxInputTokens(event.target.value)}
              />
            </label>
            <label>
              <span>{translate("Output tokens")}</span>
              <input
                type="number"
                min={1}
                placeholder={translate("Unlimited")}
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
              />
            </label>
            <label>
              <span>{translate("Costs USD")}</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                placeholder={translate("Unlimited")}
                value={maxCostUsd}
                onChange={(event) => setMaxCostUsd(event.target.value)}
              />
            </label>
            <label>
              <span>{translate("Approvals")}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxApprovals}
                onChange={(event) => setMaxApprovals(Number(event.target.value))}
              />
            </label>
            <label>
              <span>{translate("Min. per task")}</span>
              <input
                type="number"
                min={1}
                max={MAX_TASK_MINUTES_LIMIT}
                step={1}
                placeholder={translate("Unlimited")}
                value={maxTaskMinutes}
                onChange={(event) => setMaxTaskMinutes(event.target.value)}
              />
            </label>
          </div>

          <div className="grun-roster-title"><span>{translate("Teams")}</span><b>{participantCount}{" "}{translate("Participants")}</b></div>
          {availableCategories.length === 0 && (
            <div className="grun-no-agents">{translate("In terminal mode, create at least one agent first.")}</div>
          )}
          <div className="grun-roster">
            {availableCategories.map((category) => {
              const members = category.agents.map((id) => props.agents[id]).filter(Boolean) as Agent[];
              return (
                <section key={category.id} className="grun-team">
                  <h3>{category.name}</h3>
                  {members.map((agent) => {
                    const checked = Boolean(selected[agent.id]);
                    const effectiveRuntime = checked
                      ? (harness[agent.id] ?? agent.runtime)
                      : agent.runtime;
                    const runtime = runtimeVisual(effectiveRuntime);
                    return (
                      <div key={agent.id} className="grun-agent">
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={agent.id === orchestratorId}
                            onChange={() => toggleAgent(category, agent.id)}
                          />
                          <span className="grun-agent-glyph" style={{ ['--rt' as string]: runtime.color }}><runtime.Glyph /></span>
                          <span className="grun-agent-name">{agent.name}</span>
                          {!checked && <span className="grun-agent-runtime">{runtime.label}</span>}
                        </label>
                        {checked && (
                          <select
                            className="grun-agent-harness"
                            aria-label={translate("Harness for {{value1}}", { value1: agent.name })}
                            value={effectiveRuntime}
                            onChange={(event) => setHarness((current) => ({
                              ...current,
                              [agent.id]: event.target.value as RuntimeId,
                            }))}
                          >
                            {harnessOptions(agent).map((option) => (
                              <option key={option} value={option}>
                                {runtimeVisual(option).label}
                                {option === agent.runtime ? ' (Standard)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {checked && (
                          <label className="grun-lead">
                            <input
                              type="radio"
                              name={`lead-${category.id}`}
                              checked={leaders[category.id] === agent.id}
                              onChange={() => setLeaders((current) => ({ ...current, [category.id]: agent.id }))}
                            />
                            {translate("Lead")}</label>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          {error && <div className="grun-error">{localizeAppMessage(error)}</div>}
        </div>
        <div className="gcomposer-foot">
          <button type="button" className="gact" onClick={props.onCancel}>{translate("Cancel")}</button>
          <button type="submit" className="gact primary" disabled={!name.trim() || participantCount === 0 || submitting}>
            {submitting ? translate("Creating") : translate("Create a Run")}
          </button>
        </div>
      </form>
    </div>
  );
}
