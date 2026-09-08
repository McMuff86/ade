import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileAgentProfile, MobileAgentSummary, MobileProfileUpdate } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { Avatar } from '../renderer/rail/Avatar';
import { MobileClientError } from './client';

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
  const [photo, setPhoto] = useState<string>(); const url = usePhotoUrl(photo);
  useEffect(() => {
    let live = true; setPhoto(undefined);
    if (agent.photoVersion && host.status === 'online') void host.request<MobileAgentProfile>('/api/v1/profile/query', 'POST', { agentId: agent.id })
      .then((result) => { if (live) setPhoto(result.photo?.bytesBase64); }).catch(() => undefined);
    return () => { live = false; };
  }, [host.request, host.identityVersion, host.status, agent.id, agent.photoVersion]);
  return url ? <img className="avatar m-profile-photo" src={url} width={size} height={size} alt="" onError={() => setPhoto(undefined)} /> : <Avatar name={agent.name} size={size} />;
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

export function AgentProfile({ host, agentId, drafts }: { host: MobileHost; agentId: string; drafts: ProfileDrafts }): JSX.Element {
  const [profile, setProfile] = useState<MobileAgentProfile | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [allowed, setAllowed] = useState(false); const [loading, setLoading] = useState(true);
  const lock = useRef(false); const live = useRef(true); const nameInput = useRef<HTMLInputElement>(null);
  const draft = drafts.drafts[agentId];
  const effective = draft?.input ?? (profile ? { agentId, revision: profile.revision, name: profile.agent.name, role: profile.agent.role ?? '' } : null);
  const photo = draft?.input.photo === null ? undefined : draft?.input.photo?.bytesBase64 ?? profile?.photo?.bytesBase64;
  const url = usePhotoUrl(photo);
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
  const update = (patch: Partial<MobileProfileUpdate>) => {
    if (!effective) return;
    if (!draft && Object.keys(drafts.drafts).length >= 20) { setError('Zuerst einen der offenen Profilentwürfe speichern oder verwerfen.'); return; }
    drafts.change(agentId, (current) => ({ input: { ...(current?.input ?? effective), ...patch } }));
  };
  const pick = async (file?: File) => {
    if (!file) return; setError(''); setBusy(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('PNG, JPEG oder WebP bis 10 MiB wählen.');
      const source = await createImageBitmap(file);
      try {
        for (const size of [256, 128, 64]) {
          const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
          const context = canvas.getContext('2d')!; const scale = Math.min(size / source.width, size / source.height);
          context.drawImage(source, (size - source.width * scale) / 2, (size - source.height * scale) / 2, source.width * scale, source.height * scale);
          const bytesBase64 = canvas.toDataURL('image/png').split(',')[1]!;
          if (atob(bytesBase64).length <= 32 * 1024) { if (live.current) update({ photo: { bytesBase64 } }); return; }
        }
        throw new Error('Bild konnte nicht verkleinert werden.');
      } finally { source.close(); }
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Bild konnte nicht gelesen werden.'); }
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
  return <section className="m-agent-profile" aria-label="Agent-Profil">
    {loading && <p role="status">Agent-Profil wird geladen…</p>}{error && <p role="alert" className="m-alert">{error}</p>}
    {!allowed && !loading && <p>Am PC unter Settings → Verbundene Geräte „Agent-Namen, Rollen und Profilbilder bearbeiten“ freigeben.</p>}
    {profile?.photoError && <p>{profile.photoError}</p>}{draft?.notice && <p>{draft.notice}</p>}
    {effective && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="m-profile-preview">{url ? <img className="m-profile-photo" src={url} width={96} height={96} alt="Profilbild-Vorschau" /> : <Avatar name={effective.name} size={96} />}</div>
      <label>Profilbild auswählen<input aria-label="Profilbild auswählen" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
        onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <button type="button" disabled={disabled || !photo && !profile?.agent.photoVersion} onClick={() => update({ photo: null })}>Profilbild entfernen</button>
      <label>Agentname<input ref={nameInput} aria-label="Profil-Agentname" value={effective.name} maxLength={80} disabled={disabled} required onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Rolle<input aria-label="Profil-Rolle" value={effective.role} maxLength={160} disabled={disabled} onChange={(event) => update({ role: event.target.value })} /></label>
      <button className="m-primary" disabled={busy || !allowed || host.status !== 'online' || !effective.name.trim()}>{draft?.pending ? 'Profilaktion erneut prüfen' : 'Profil speichern'}</button>
      {draft && !draft.pending && <button type="button" disabled={busy} onClick={() => drafts.change(agentId, () => undefined)}>Profilentwurf verwerfen</button>}
    </form>}
    <button disabled={busy} onClick={() => { void refresh(); }}>Profil neu laden</button>
    {draft && profile && draft.input.revision !== profile.revision && <p>Profil wurde geändert. Entwurf prüfen und erst danach die neue Basis bestätigen.
      <button disabled={busy || !!draft.pending} onClick={() => update({ revision: profile.revision })}>Neue Profilbasis bestätigen</button></p>}
  </section>;
}
function profileError(reason: unknown): string {
  if (reason instanceof MobileClientError) {
    if (reason.code === 'scope_not_granted') return 'Die Gerätefreigabe zum Bearbeiten von Agent-Profilen fehlt.';
    if (reason.message !== reason.code) return reason.message;
  }
  return 'Profilaktion konnte nicht bestätigt werden. Verbindung prüfen und erneut versuchen.';
}
