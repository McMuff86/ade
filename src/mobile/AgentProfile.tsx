import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileAgentProfile, MobileAgentSummary, MobileProfileUpdate } from '../shared/remote';
import type { CodexReasoningEffort } from '../shared/types';
import { CODEX_REASONING_EFFORTS } from '../renderer/onboarding/agentOptions';
import type { MobileHost } from './useMobileHost';
import { Avatar } from '../renderer/rail/Avatar';
import { runtimeLogo } from '../renderer/rail/runtimeLogos';
import { MobileClientError } from './client';
import { Dialog } from './ui';
import { MobileSpeechSettings } from './SpeechSettings';
import { AgentBehaviorEditor } from '../renderer/onboarding/AgentBehaviorEditor';
import type { AgentBehaviorView } from '../shared/agentBehavior';

function photoBlob(base64: string): Blob {
  const raw = atob(base64); const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}
function usePhotoUrl(base64: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!base64) { setUrl(null); return; }
    const next = URL.createObjectURL(photoBlob(base64)); setUrl(next); return () => URL.revokeObjectURL(next);
  }, [base64]); return url;
}
export function MobileAvatar({ host, agent, size = 30 }: { host: MobileHost; agent: MobileAgentSummary; size?: number }): JSX.Element {
  useLocale();
  const [photo, setPhoto] = useState<string>(); const url = usePhotoUrl(photo);
  useEffect(() => {
    let live = true; setPhoto(undefined);
    if (agent.photoVersion && host.status === 'online') void host.request<MobileAgentProfile>('/api/v1/profile/query', 'POST', { agentId: agent.id })
      .then((result) => { if (live) setPhoto(result.photo?.bytesBase64); }).catch(() => undefined);
    return () => { live = false; };
  }, [host.request, host.identityVersion, host.status, agent.id, agent.photoVersion]);
  return url ? <img className="avatar m-profile-photo" src={url} width={size} height={size} alt="" onError={() => setPhoto(undefined)} /> : <Avatar name={agent.name} runtime={agent.runtime} size={size} />;
}
interface ProfileDraft { input: MobileProfileUpdate; key?: string; pending?: boolean; notice?: string }
export function useProfileDrafts(identity: number) {
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({}); const epoch = useRef(identity); epoch.current = identity;
  useEffect(() => setDrafts({}), [identity]);
  const change = (id: string, apply: (draft: ProfileDraft | undefined) => ProfileDraft | undefined) => {
    if (epoch.current !== identity) return;
    setDrafts((current) => {
      const value = apply(current[id]); const next = { ...current };
      if (!value) delete next[id]; else if (next[id] || Object.keys(next).length < 20) next[id] = value;
      return next;
    });
  };
  return { drafts, change };
}
export type ProfileDrafts = ReturnType<typeof useProfileDrafts>;

export function AgentProfile({ host, agentId, repositoryId, drafts }: { host: MobileHost; agentId: string; repositoryId?: string; drafts: ProfileDrafts }): JSX.Element {
  useLocale();
  const [profile, setProfile] = useState<MobileAgentProfile | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [allowed, setAllowed] = useState(false); const [loading, setLoading] = useState(true);
  const lock = useRef(false); const live = useRef(true); const nameInput = useRef<HTMLInputElement>(null);
  const draft = drafts.drafts[agentId];
  const modelEditable = profile?.agent.codexModel !== undefined;
  const effective = draft?.input ?? (profile ? { agentId, revision: profile.revision, name: profile.agent.name, role: profile.agent.role ?? '',
    ...(modelEditable ? { codexModel: profile.agent.codexModel, codexReasoningEffort: profile.agent.codexReasoningEffort } : {}) } : null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const photo = draft?.input.photo === null ? undefined : draft?.input.photo?.bytesBase64 ?? profile?.photo?.bytesBase64;
  const url = usePhotoUrl(photo);
  const logo = runtimeLogo(profile?.agent.runtime); const imageUrl = url ?? logo;
  const [photoOpen, setPhotoOpen] = useState(false); const photoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setPhotoOpen(false), [agentId, host.identityVersion]);
  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const [value, state] = await Promise.all([host.request<MobileAgentProfile>('/api/v1/profile/query', 'POST', { agentId }),
        host.request<{ capabilities?: string[] }>('/api/v1/host')]);
      if (live.current) { setProfile(value); setAllowed(state.capabilities?.includes('profiles:write') === true); }
    } catch (reason) { if (live.current) setError(profileError(reason)); }
    finally { if (live.current) setLoading(false); }
  };
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; }; }, [agentId, host.identityVersion]);
  /** The PC starts its Codex CLI for the catalog, so this is explicit: on first edit access and on "Refresh models". */
  const loadModels = async () => {
    if (modelsBusy || host.status !== 'online') return; setModelsBusy(true); setError('');
    try { const value = await host.request<MobileAgentProfile>('/api/v1/profile/query', 'POST', { agentId, models: true }); if (live.current) setProfile(value); }
    catch (reason) { if (live.current) setError(profileError(reason)); }
    finally { if (live.current) setModelsBusy(false); }
  };
  useEffect(() => { if (allowed && modelEditable && profile && !profile.models) void loadModels(); }, [allowed, modelEditable, profile?.agent.id]);
  const update = (patch: Partial<MobileProfileUpdate>) => {
    if (!effective) return;
    if (!draft && Object.keys(drafts.drafts).length >= 20) { setError(translate("First, save or discard one of the open profile drafts.")); return; }
    drafts.change(agentId, (current) => ({ input: { ...(current?.input ?? effective), ...patch } }));
  };
  const pick = async (file?: File) => {
    if (!file) return; setError(''); setBusy(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error(translate("Select PNG, JPEG or WebP up to 10 MiB."));
      const source = await createImageBitmap(file);
      try {
        for (const size of [256, 128, 64]) {
          const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
          const context = canvas.getContext('2d')!; const scale = Math.min(size / source.width, size / source.height);
          context.drawImage(source, (size - source.width * scale) / 2, (size - source.height * scale) / 2, source.width * scale, source.height * scale);
          const bytesBase64 = canvas.toDataURL('image/png').split(',')[1]!;
          if (atob(bytesBase64).length <= 32 * 1024) { if (live.current) update({ photo: { bytesBase64 } }); return; }
        }
        throw new Error(translate("Could not resize the image."));
      } finally { source.close(); }
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : translate("Could not read the image.")); }
    finally { if (live.current) setBusy(false); }
  };
  const save = async () => {
    if (!effective || lock.current || host.status !== 'online') return;
    const request = { input: draft?.input ?? effective, key: draft?.key ?? crypto.randomUUID(), pending: true };
    lock.current = true; setBusy(true); setError(''); drafts.change(agentId, () => request);
    try {
      await host.request('/api/v1/profile/update', 'POST', request.input, request.key);
      drafts.change(agentId, (current) => current?.key === request.key ? undefined : current);
      await host.refresh(); if (live.current) { await refresh(); nameInput.current?.focus(); }
    } catch (reason) {
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) drafts.change(agentId, (current) => current ? { input: current.input, notice: profileError(reason) } : undefined);
      if (live.current) setError(profileError(reason));
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const disabled = busy || !!draft?.pending || !allowed || host.status !== 'online';
  return <section className="m-agent-profile" aria-label={translate("Agent Profile")}>
    {loading && <p role="status">{translate("Loading agent profile…")}</p>}{error && <p role="alert" className="m-alert">{localizeAppMessage(error)}</p>}
    {!allowed && !loading && <p>{translate("On the PC, open Settings → Connected devices and enable “Edit agent names, roles and profile pictures”.")}</p>}
    {profile?.photoError && <p>{localizeAppMessage(profile.photoError)}</p>}{draft?.notice && <p>{localizeAppMessage(draft.notice)}</p>}
    {effective && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="m-profile-preview">{imageUrl ? <button ref={photoButton} type="button" className="m-profile-photo-button" aria-label={translate("Enlarge profile image")} onClick={event => { event.currentTarget.focus(); setPhotoOpen(true); }}><img className="m-profile-photo" src={imageUrl} width={96} height={96} alt={translate("Profile image preview")} data-runtime-logo={url ? undefined : profile?.agent.runtime} /></button> : <Avatar name={effective.name} size={96} />}</div>
      <label>{translate("Select profile picture")}<input aria-label={translate("Select profile picture")} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
        onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <button type="button" disabled={disabled || !photo && !profile?.agent.photoVersion} onClick={() => update({ photo: null })}>{translate("Remove profile picture")}</button>
      <label>{translate("Agent name")}<input ref={nameInput} aria-label={translate("Profile agent name")} value={effective.name} maxLength={80} disabled={disabled} required onChange={(event) => update({ name: event.target.value })} /></label>
      <label>{translate("Role")}<input aria-label={translate("Profile role")} value={effective.role} maxLength={160} disabled={disabled} onChange={(event) => update({ role: event.target.value })} /></label>
      {modelEditable && <fieldset className="m-profile-model"><legend>{translate("Model and reasoning")}</legend>
        <p className="m-field-note">{translate("The model list comes from the Codex CLI on the PC. Refresh it to see current models.")}</p>
        <label>{translate("Codex model")}<select aria-label={translate("Codex model")} value={effective.codexModel ?? ''} disabled={disabled} onChange={(event) => {
          const option = profile?.models?.models.find((model) => model.id === event.target.value); const efforts = option?.reasoningEfforts;
          update({ codexModel: event.target.value, ...(efforts && effective.codexReasoningEffort && !efforts.includes(effective.codexReasoningEffort) ? { codexReasoningEffort: option?.defaultReasoningEffort ?? efforts[0] } : {}) });
        }}>
          {effective.codexModel && !profile?.models?.models.some((model) => model.id === effective.codexModel) && <option value={effective.codexModel}>{effective.codexModel} · {profile?.models ? translate("Not confirmed") : translate("checking")}</option>}
          {profile?.models?.models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.resolvedModel && model.resolvedModel !== model.id ? ` · ${model.resolvedModel}` : model.name !== model.id ? ` · ${model.id}` : ''}{model.isDefault ? translate(" · default") : ''}</option>)}
        </select></label>
        <label>{translate("Reasoning effort")}<select aria-label={translate("Reasoning effort")} value={effective.codexReasoningEffort ?? ''} disabled={disabled} onChange={(event) => update({ codexReasoningEffort: event.target.value as CodexReasoningEffort })}>
          {CODEX_REASONING_EFFORTS.filter((effort) => { const supported = profile?.models?.models.find((model) => model.id === effective.codexModel)?.reasoningEfforts; return !supported || supported.includes(effort.id) || effort.id === effective.codexReasoningEffort; })
            .map((effort) => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
        </select></label>
        {profile?.models?.status === 'unavailable' && <p className="m-field-note">{localizeAppMessage(profile.models.message ?? translate("Could not load the model list. Refresh again."))}</p>}
        <button type="button" disabled={disabled || modelsBusy} onClick={() => void loadModels()}>{modelsBusy ? translate("Loading models…") : translate("Refresh models")}</button>
      </fieldset>}
      <button className="m-primary" disabled={busy || !allowed || host.status !== 'online' || !effective.name.trim()}>{draft?.pending ? translate("Check profile operation again") : translate("Save profile")}</button>
      {draft && !draft.pending && <button type="button" disabled={busy} onClick={() => drafts.change(agentId, () => undefined)}>{translate("Discard profile draft")}</button>}
    </form>}
    {photoOpen && imageUrl && <Dialog title={translate("Profile picture · {{value1}}", { value1: effective?.name ?? 'Agent' })} className="m-profile-photo-dialog" restoreFocusTo={photoButton.current} onClose={() => setPhotoOpen(false)}>
      <img className="m-profile-photo-large" src={imageUrl} alt={translate("Profile picture of {{value1}}", { value1: effective?.name ?? 'Agent' })} data-runtime-logo={url ? undefined : profile?.agent.runtime} />
      <button onClick={() => setPhotoOpen(false)}>{translate("Back to Profile")}</button>
    </Dialog>}
    {profile && <MobileSpeechSettings host={host} target={{ kind: 'agent', agentId, ...(repositoryId ? { repositoryId } : {}) }} title={translate("Agent voice")} />}
    {profile && <AgentBehaviorEditor key={`${host.identityVersion}:${agentId}`} agentId={agentId} enabled={host.status === 'online'} canEdit={allowed} port={{
      load: () => host.request<AgentBehaviorView>('/api/v1/profile/behavior/query', 'POST', { agentId }),
      save: (input, key) => host.request('/api/v1/profile/behavior/update', 'POST', input, key),
    }} />}
    <button disabled={busy} onClick={() => { void refresh(); }}>{translate("Reload profile")}</button>
    {draft && profile && draft.input.revision !== profile.revision && <p>{translate("Profile has been changed. Check draft and only then confirm the new base.")}<button disabled={busy || !!draft.pending} onClick={() => update({ revision: profile.revision })}>{translate("Confirm new profile baseline")}</button></p>}
  </section>;
}
function profileError(reason: unknown): string {
  if (reason instanceof MobileClientError) {
    if (reason.code === 'scope_not_granted') return translate("Permission to edit agent profiles is missing for this device.");
    if (reason.message !== reason.code) return reason.message;
  }
  return translate("Profile action could not be confirmed. check connection and try again.");
}
