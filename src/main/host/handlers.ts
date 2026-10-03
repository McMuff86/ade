/**
 * The host side of every IPC channel (Goal 34.6, H1g).
 *
 * `createGuard` is the hull every channel passes after the client adapter has
 * checked sender trust and payload shape: the channel's privilege policy
 * (audit line for launch/shell/host effects), the host-operation fence for
 * everything that is not a read, the catalog-changed event, and — on failure —
 * the redaction funnel, so a handler error never carries backend stderr or a
 * credential verbatim to the client. It is the former ipc.ts wrapper, moved.
 */
import { IPC, IPC_EVENTS, type IpcInvokeMap } from '../../shared/ipc';
import type { HostOperationGate } from '../application/HostOperationGate';
import { redactedErrorDetail, toIpcError } from '../errors';
import { assertChannelPolicy } from '../ipcPolicy';
import type { HostClient, HostEvents } from './ports';

/** A host handler: validated payload in, result out; client-bound state keyed by `client.id`. */
export type HostHandler<K extends keyof IpcInvokeMap = keyof IpcInvokeMap> = (
  payload: IpcInvokeMap[K]['req'],
  client: HostClient,
) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>;

export const CATALOG_MUTATIONS = new Set<keyof IpcInvokeMap>([
  'config:save', 'category:create', 'category:update', 'category:delete', 'category:reorder',
  'agent:create', 'agent:update', 'agent:delete', 'agent:move', 'agent:setDefaultRepository',
  'agentTemplate:create', 'agentTemplate:delete', 'agentTemplate:spawn', 'repository:import',
  'workspace:removeBinding', 'workspaceBundle:apply',
]);

export function createGuard(fence: HostOperationGate, events: HostEvents) {
  return async function guard<T>(channel: keyof IpcInvokeMap, run: () => T | Promise<T>): Promise<T> {
    const policy = assertChannelPolicy(channel);
    if (policy.audit) console.log(`[ade] ipc ${channel} effect=${policy.effect}`);
    try {
      const result = policy.effect === 'read' ? await run()
        : await fence.use(() => run(), channel === IPC.RemoteDevicesRevoke || channel === IPC.RemoteDevicesSetAdminScopes);
      if (CATALOG_MUTATIONS.has(channel)) events.emit(IPC_EVENTS.CatalogChanged, { revision: Date.now() });
      return result;
    } catch (error) {
      console.error(`[ade] ipc ${channel} failed:`, redactedErrorDetail(error));
      throw toIpcError(error);
    }
  };
}
