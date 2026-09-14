import type { AgentBehaviorProfile } from './agentProfile';

export interface AgentContextSource {
  kind: 'identity' | 'instructions' | 'document' | 'memory';
  name: string;
  sha256: string;
  chars: number;
  id?: string;
}
export interface AgentBehaviorView {
  profile: AgentBehaviorProfile;
  revision: string;
  context: { text: string; sources: AgentContextSource[]; chars: number };
  /** Wire redaction makes editing this copy unsafe; edit at the host instead. */
  redacted?: boolean;
}
export interface AgentBehaviorUpdate { agentId: string; revision: string; profile: AgentBehaviorProfile }
export interface SessionProfileContext {
  profileId: string;
  profileName: string;
  digest: string;
  /** Saved identity/profile revision, separate from optional captured memory. */
  profileDigest?: string;
  capturedAt: number;
  delivery: 'supplied';
  sources: AgentContextSource[];
}
