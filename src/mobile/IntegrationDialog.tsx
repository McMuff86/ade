import { useCallback, type JSX } from 'react';
import { IntegrationReview, type PendingIntegration } from '../renderer/repositories/IntegrationReview';
import type { IntegrationQuery, IntegrationCommand, IntegrationResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { useDeviceDraft } from './deviceDrafts';
import { Dialog } from './ui';
import { MobileClientError } from './client';

const errorText = (error: unknown) => error instanceof MobileClientError && error.code === 'scope_not_granted'
  ? 'Am PC die Freigaben für Workspace-Lesen, Git-Verwaltung und alle Projekte prüfen; Tests benötigen zusätzlich Terminal-Steuerung.'
  : error instanceof Error ? error.message : 'Übernahme konnte nicht bestätigt werden.';
export function IntegrationDialog({ host, repositoryId, canChange, canTest, onClose, onWorkspace }: {
  host: MobileHost; repositoryId: string; canChange: boolean; canTest: boolean; onClose: () => void; onWorkspace: (id: string) => void;
}): JSX.Element {
  const [pending, savePending] = useDeviceDraft<PendingIntegration | null>(host.deviceId, `integration:${repositoryId}`, null);
  const query = useCallback((input: IntegrationQuery) => host.request<IntegrationResult>('/api/v1/integration/query', 'POST', input), [host.request]);
  const command = useCallback((input: IntegrationCommand, key: string) => host.request<IntegrationResult>('/api/v1/integration/command', 'POST', input, key), [host.request]);
  return <Dialog title="Änderungen übernehmen" onClose={onClose} fallbackId="mobile-title" className="m-integration-dialog">
    <IntegrationReview key={`${host.identityVersion}:${repositoryId}`} repositoryId={repositoryId} online={host.status === 'online'} canChange={canChange} canTest={canTest}
      query={query} command={command} pending={pending} savePending={savePending} errorText={errorText}
      certainError={(error) => error instanceof MobileClientError && [400, 403, 404, 409, 422].includes(error.status)} onBack={onClose} onWorkspace={onWorkspace} />
  </Dialog>;
}
