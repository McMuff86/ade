import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { AgentBehaviorUpdate, AgentBehaviorView } from '../../shared/agentBehavior';
import { validateAgentBehaviorProfile, MAX_PROFILE_INSTRUCTIONS_CHARS, type AgentBehaviorProfile } from '../../shared/agentProfile';
import './agentBehavior.css';

export interface AgentBehaviorPort {
  load(): Promise<AgentBehaviorView>;
  save(input: AgentBehaviorUpdate, key: string): Promise<unknown>;
}
export function AgentBehaviorEditor({ agentId, port, enabled = true, canEdit = true }: {
  agentId: string; port: AgentBehaviorPort; enabled?: boolean; canEdit?: boolean;
}) {
  useLocale();
  const [view, setView] = useState<AgentBehaviorView>();
  const [draft, setDraft] = useState<AgentBehaviorProfile>();
  const [pending, setPending] = useState<{ input: AgentBehaviorUpdate; key: string }>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const live = useRef(true); const lock = useRef(false); const currentPort = useRef(port); currentPort.current = port;
  const run = async (operation: () => Promise<void>) => {
    if (lock.current || !enabled) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : translate("Profile instructions could not be loaded or saved.")); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const reload = async () => { const result = await currentPort.current.load(); if (live.current) { setView(result); setDraft(result.profile); setPending(undefined); } };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, [agentId]);
  // Mobile may mount while its host is reconnecting. Load on the first online
  // transition, but never overwrite an existing draft after a later reconnect.
  useEffect(() => { if (enabled && !view) void run(reload); }, [agentId, enabled]);
  const disabled = !enabled || !canEdit || !!view?.redacted || busy || !!pending;
  const dirty = !!draft && !!view && JSON.stringify(draft) !== JSON.stringify(view.profile);
  const pick = async (files: FileList | null) => {
    if (!files || !draft) return;
    await run(async () => {
      const documents = [...draft.documents];
      for (const file of Array.from(files)) {
        if (file.size > 32_000) throw new Error(translate("A markdown file must contain a maximum of 32,000 UTF-8 bytes."));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        documents.push({ id: crypto.randomUUID(), name: file.name, text });
      }
      const value = validateAgentBehaviorProfile({ ...draft, documents }); if (live.current) setDraft(value);
    });
  };
  const save = () => void run(async () => {
    if (!draft || !view || view.redacted || !canEdit) return;
    const request = pending ?? { input: { agentId, revision: view.revision, profile: validateAgentBehaviorProfile(draft) }, key: crypto.randomUUID() };
    setPending(request);
    try { await currentPort.current.save(request.input, request.key); await reload(); if (live.current) setNotice(translate("Profile instructions saved. New sessions use this version.")); }
    catch (reason) {
      if ([400, 403, 404, 409, 422].includes((reason as { status?: number })?.status ?? 0)) setPending(undefined);
      throw reason;
    }
  });
  return <section className="agent-behavior-editor" aria-label={translate("Agent behaviour")}>
    <h3>{translate("Operation and instructions")}</h3>
    <p>{translate("These instructions specialize in new sessions with an agent profile. Repository instructions remain effective. Already running sessions keep their starting status.")}</p>
    <p>{translate("Interactive profile statements currently support native Windows launches using Codex, Claude or Ollama coding via Codex CLI and Qwen Code. Other runtimes and proprietary launch commands cannot yet adopt stored behavior.")}</p>
    {!enabled && <p role="status">{translate("PC not connected.")}</p>}
    {!canEdit && <p>{translate("Permission to edit agent profiles is missing for this device.")}</p>}
    {view?.redacted && <p role="status">{translate("This profile contains hidden content. Open for editing on the PC.")}</p>}
    {draft && <>
      <label>{translate("Work instructions")}<textarea aria-label={translate("Profile work instructions")} rows={7} maxLength={MAX_PROFILE_INSTRUCTIONS_CHARS} disabled={disabled}
        value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></label>
      <label>{translate("Assign Markdown documents")}<input type="file" accept=".md,text/markdown" multiple disabled={disabled}
        onChange={event => { void pick(event.target.files); event.target.value = ''; }} /></label>
      <p>{translate("Up to eight documents, with 8,000 characters each and 24,000 characters in total. ADE stores a copy. Changes to the original file are only applied when you attach it again.")}</p>
      {!draft.documents.length && <p>{translate("No markdown documents assigned yet.")}</p>}
      <ol>{draft.documents.map((document, index) => <li key={document.id}>
        <span>{document.name} · {document.text.length}{" "}{translate("Characters")}</span>
        <button type="button" disabled={disabled || index === 0} aria-label={translate("Move {{value1}} up", { value1: document.name })} onClick={() => {
          const documents = [...draft.documents]; [documents[index - 1], documents[index]] = [documents[index]!, documents[index - 1]!]; setDraft({ ...draft, documents });
        }}>{translate("Up")}</button>
        <button type="button" disabled={disabled} aria-label={translate("Remove {{value1}}", { value1: document.name })} onClick={() => setDraft({ ...draft, documents: draft.documents.filter(item => item.id !== document.id) })}>{translate("Remove")}</button>
      </li>)}</ol>
      {dirty && <p role="status">{translate("Unsaved changes. Save before leaving this view.")}</p>}
      <button type="button" disabled={!enabled || !canEdit || !!view?.redacted || busy || !dirty && !pending} onClick={save}>{pending ? translate("Check profile again") : translate("Save profile instructions")}</button>
    </>}
    <button type="button" disabled={!enabled || busy} onClick={() => void run(reload)}>{dirty || pending ? translate("Discard draft and reload profile") : translate("Reload profile instructions")}</button>
    {(dirty || pending) && <button type="button" disabled={!enabled || busy || !canEdit} onClick={() => void run(async () => {
      const latest = await currentPort.current.load();
      if (live.current) { setView(latest); setPending(undefined); setNotice(translate("Up-to-date profile status loaded. Your draft is preserved; check differences and only save them afterwards.")); }
    })}>{translate("Load new profile baseline and keep draft")}</button>}
    {busy && <p role="status">{translate("Checking profile instructions…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
    {view && <details><summary>{translate("View the stored profile context ·")}{" "}{view.revision.slice(0, 12)}</summary>
      <p>{translate("Order and checksums of the profile sources; repository instructions read the CLI additionally.")}</p>
      <ol>{view.context.sources.map((source, index) => <li key={`${source.kind}:${source.id ?? index}`}>{source.name} · {source.chars}{" "}{translate("characters ·")}{" "}<code>{source.sha256.slice(0, 12)}</code></li>)}</ol>
      <pre aria-label={translate("Stored profile context")}>{view.context.text}</pre>
    </details>}
  </section>;
}

export function DesktopAgentBehavior({ agentId }: { agentId: string }) {
  useLocale();
  return <AgentBehaviorEditor key={agentId} agentId={agentId} port={{
    load: () => window.ade.invoke('agent:behaviorGet', { agentId }),
    save: input => window.ade.invoke('agent:behaviorSet', input),
  }} />;
}
