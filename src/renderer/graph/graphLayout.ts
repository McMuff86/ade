/** Canvas geometry: node sizes, automatic cluster layout and edge curves. */

import { useCallback, useMemo } from 'react';
import type { Pos } from './graphStore';
import type { RunClusterModel } from './graphModel';

export const CARD_W = 150;
export const GAP = 14;
export const TEAM_PAD = 16;
export const TEAM_GAP_IN = 48;
export const CLUSTER_PAD = 24;
export const ORCH_Y = 64;
export const TEAM_Y = 310;
export const CLUSTER_H = TEAM_Y + 252;
export const CLUSTER_GAP = 150;
export const ORCH_W = 224;

/** Graph zoom range; the same view math drives the sketch sheet (renderer/viewTransform.ts). */
export const GRAPH_SCALE = { min: 0.3, max: 1.6 };

export function teamWidth(memberCount: number): number {
  return TEAM_PAD * 2 + memberCount * CARD_W + Math.max(0, memberCount - 1) * GAP;
}

export function clusterWidth(cluster: RunClusterModel): number {
  const teamsWidth = cluster.teams.reduce(
    (total, team) => total + teamWidth(1 + team.workers.length),
    0,
  ) + Math.max(0, cluster.teams.length - 1) * TEAM_GAP_IN;
  return Math.max(320, ORCH_W + CLUSTER_PAD * 2, teamsWidth + CLUSTER_PAD * 2);
}

export function edgePath(from: Pos, to: Pos): string {
  const offset = Math.max(46, (to.y - from.y) / 2);
  return `M${from.x},${from.y} C${from.x},${from.y + offset} ${to.x},${to.y - offset} ${to.x},${to.y}`;
}

export interface GraphLayout {
  /** Cluster origin: the dragged position, else the automatic row layout. */
  clusterPos: (runId: string) => Pos;
  /** Node origin inside its cluster; `key` is 'orchestrator' or a team id. */
  nodePos: (runId: string, key: string) => Pos;
}

/** Clusters sit side by side; stored drag positions win over the automatic layout. */
export function useGraphLayout(clusters: RunClusterModel[], positions: Record<string, Pos>): GraphLayout {
  const autoLayout = useMemo(() => {
    const clusterPositions: Record<string, Pos> = {};
    const nodePositions: Record<string, Record<string, Pos>> = {};
    let x = 90;
    for (const cluster of clusters) {
      clusterPositions[cluster.run.id] = { x, y: 70 };
      const width = clusterWidth(cluster);
      const nodes: Record<string, Pos> = {
        orchestrator: { x: width / 2 - ORCH_W / 2, y: ORCH_Y },
      };
      let teamX = CLUSTER_PAD;
      for (const team of cluster.teams) {
        nodes[team.id] = { x: teamX, y: TEAM_Y };
        teamX += teamWidth(1 + team.workers.length) + TEAM_GAP_IN;
      }
      nodePositions[cluster.run.id] = nodes;
      x += width + CLUSTER_GAP;
    }
    return { clusterPositions, nodePositions };
  }, [clusters]);

  const clusterPos = useCallback((runId: string): Pos => (
    positions[`cluster:${runId}`]
    ?? autoLayout.clusterPositions[runId]
    ?? { x: 90, y: 70 }
  ), [positions, autoLayout]);

  const nodePos = useCallback((runId: string, key: string): Pos => (
    positions[`${runId}:${key}`]
    ?? autoLayout.nodePositions[runId]?.[key]
    ?? { x: CLUSTER_PAD, y: TEAM_Y }
  ), [positions, autoLayout]);

  return { clusterPos, nodePos };
}
