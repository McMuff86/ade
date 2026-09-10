import { useMemo } from 'react';
import type { MobileRunFiles } from '../shared/remote';
import type { RunFilesPort } from '../renderer/graph/RunFilesPanel';
import type { MobileHost } from './useMobileHost';

export function useRunFilesPort(host: MobileHost): RunFilesPort {
  return useMemo(() => ({
    list: (runId, taskId) => host.request<MobileRunFiles>(`/api/v1/runs/${runId}${taskId ? `/tasks/${taskId}` : ''}/files`),
    download: (runId, taskId, fileId) => host.download(`/api/v1/runs/${runId}/tasks/${taskId}/files/${fileId}`),
  }), [host.request, host.download]);
}
