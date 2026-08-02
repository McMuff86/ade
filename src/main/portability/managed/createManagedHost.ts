/** Host selection, kept apart from the interface so neither module imports the other's runtime. */

import type { ManagedHost } from './ManagedHost';
import { managedProfileSupport } from './ManagedHost';
import { PosixManagedHost } from './PosixManagedHost';
import { Win32ManagedHost } from './Win32ManagedHost';

export function createManagedHost(platform: NodeJS.Platform = process.platform): ManagedHost {
  const support = managedProfileSupport(platform);
  if (support.level === 'descriptor-anchored') return new PosixManagedHost();
  if (support.level === 'verified-path') return new Win32ManagedHost();
  throw new Error(
    'workspace profile: safe managed profile access is not supported on this platform',
  );
}
