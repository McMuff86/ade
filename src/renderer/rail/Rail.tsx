/**
 * Left rail — two-level list of categories and their agents, per the mockup.
 *
 * Category header: square avatar + name + agent count + collapse chevron.
 * Agent rows: round avatar (with a presence-dot placeholder, default off),
 * name + role; selected row gets a raised bg + copper inset line. Hover a
 * category to reveal "+ Add agent"; the footer carries "+ New category".
 *
 * Ordering is drag & drop: agent rows reorder within a category and move
 * across categories (drop on a header appends); category headers reorder the
 * rail. Order persists through agent:move / category:reorder.
 */

import { useState, type DragEvent } from 'react';
import { Avatar } from './Avatar';
import { useAppData } from '../stores/appdata';
import { useSelection } from '../stores/selection';
import { useOnboarding } from '../onboarding/useOnboarding';
import { OnboardingModals } from '../onboarding/OnboardingModals';
import './rail.css';

type DragItem = { kind: 'agent'; id: string } | { kind: 'category'; id: string };
type Edge = 'before' | 'after';
interface DropHint {
  key: string;
  edge: Edge;
}

/** Top half of the target = insert before it, bottom half = after. */
function edgeOf(event: DragEvent<HTMLElement>): Edge {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

export function Rail(): React.ReactElement {
  const categories = useAppData((s) => s.categories);
  const agents = useAppData((s) => s.agents);
  const moveAgent = useAppData((s) => s.moveAgent);
  const reorderCategories = useAppData((s) => s.reorderCategories);
  const selectedAgentId = useSelection((s) => s.selectedAgentId);
  const setSelectedAgent = useSelection((s) => s.setSelectedAgent);
  const openNewCategory = useOnboarding((s) => s.openNewCategory);
  const openCategorySettings = useOnboarding((s) => s.openCategorySettings);
  const openNewAgent = useOnboarding((s) => s.openNewAgent);
  const openAgentSettings = useOnboarding((s) => s.openAgentSettings);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string): void =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const [drag, setDrag] = useState<DragItem | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const clearDnd = (): void => {
    setDrag(null);
    setHint(null);
  };

  const startDrag = (item: DragItem) => (event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
    setDrag(item);
  };

  /** dragover for a target that accepts `kinds`; records the edge hint. */
  const allowDrop = (key: string, kinds: DragItem['kind'][], withEdge: boolean) =>
    (event: DragEvent<HTMLElement>): void => {
      if (!drag || !kinds.includes(drag.kind)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const edge = withEdge ? edgeOf(event) : 'after';
      setHint((cur) => (cur?.key === key && cur.edge === edge ? cur : { key, edge }));
    };

  const leaveDrop = (key: string) => (): void => {
    setHint((cur) => (cur?.key === key ? null : cur));
  };

  /** Drop an agent relative to another agent row of `categoryId`. */
  const dropOnAgent = (categoryId: string, targetAgentId: string) =>
    (event: DragEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (drag?.kind !== 'agent') return clearDnd();
      const category = categories.find((c) => c.id === categoryId);
      if (!category || (drag.id === targetAgentId)) return clearDnd();
      const edge = edgeOf(event);
      const list = category.agents.filter((id) => id !== drag.id);
      const pos = list.indexOf(targetAgentId);
      const index = pos < 0 ? list.length : edge === 'before' ? pos : pos + 1;
      void moveAgent(drag.id, categoryId, index).catch((error) =>
        console.error('[ade] agent move failed:', error));
      clearDnd();
    };

  /** Drop on a category header: agents append; categories reorder by edge. */
  const dropOnCategory = (categoryId: string) => (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (drag?.kind === 'agent') {
      const category = categories.find((c) => c.id === categoryId);
      const end = category ? category.agents.filter((id) => id !== drag.id).length : 0;
      void moveAgent(drag.id, categoryId, end).catch((error) =>
        console.error('[ade] agent move failed:', error));
    } else if (drag?.kind === 'category' && drag.id !== categoryId) {
      const edge = edgeOf(event);
      const ids = categories.map((c) => c.id).filter((id) => id !== drag.id);
      const pos = ids.indexOf(categoryId);
      ids.splice(edge === 'before' ? pos : pos + 1, 0, drag.id);
      void reorderCategories(ids).catch((error) =>
        console.error('[ade] category reorder failed:', error));
    }
    clearDnd();
  };

  return (
    <nav className="rail-inner" aria-label="Categories and agents">
      <div className="rail-scroll">
        {categories.map((cat) => {
          const isCollapsed = collapsed[cat.id] ?? false;
          const catKey = `cat:${cat.id}`;
          const catHint = hint?.key === catKey ? hint : null;
          const catDropClass = catHint
            ? drag?.kind === 'category'
              ? ` drop-${catHint.edge}`
              : ' drop-into'
            : '';
          return (
            <div
              key={cat.id}
              className={`cat${isCollapsed ? ' collapsed' : ''}${drag?.kind === 'category' && drag.id === cat.id ? ' dragging' : ''}${catDropClass}`}
            >
              <div className="cat-entry">
                <button
                  type="button"
                  className="cat-head"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(cat.id)}
                  draggable
                  onDragStart={startDrag({ kind: 'category', id: cat.id })}
                  onDragEnd={clearDnd}
                  onDragOver={allowDrop(catKey, ['agent', 'category'], true)}
                  onDragLeave={leaveDrop(catKey)}
                  onDrop={dropOnCategory(cat.id)}
                >
                  <Avatar name={cat.name} photo={cat.photo} shape="square" size={30} seed={cat.id} />
                  <span className="cat-name">{cat.name}</span>
                  <span className="cat-meta">{cat.agents.length}</span>
                  <span className="cat-chevron" aria-hidden="true">
                    ▾
                  </span>
                </button>
                <button
                  type="button"
                  className="cat-settings"
                  aria-label={`Category settings for ${cat.name}`}
                  title="Category settings"
                  onClick={() => openCategorySettings(cat.id)}
                >
                  ⚙
                </button>
              </div>

              <div className="agents">
                {cat.agents.map((agentId) => {
                  const agent = agents[agentId];
                  if (!agent) return null;
                  const selected = agent.id === selectedAgentId;
                  const rowKey = `agent:${agent.id}`;
                  const rowHint = hint?.key === rowKey ? hint : null;
                  return (
                    <div
                      key={agent.id}
                      className={`agent-entry${selected ? ' selected' : ''}${drag?.kind === 'agent' && drag.id === agent.id ? ' dragging' : ''}${rowHint ? ` drop-${rowHint.edge}` : ''}`}
                      draggable
                      onDragStart={startDrag({ kind: 'agent', id: agent.id })}
                      onDragEnd={clearDnd}
                      onDragOver={allowDrop(rowKey, ['agent'], true)}
                      onDragLeave={leaveDrop(rowKey)}
                      onDrop={dropOnAgent(cat.id, agent.id)}
                    >
                      <button
                        type="button"
                        className="agent-row"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => setSelectedAgent(agent.id)}
                      >
                        <span className="agent-avatar-wrap">
                          <Avatar name={agent.name} photo={agent.photo} shape="round" size={26} seed={agent.id} />
                          <span className="presence" aria-hidden="true" />
                        </span>
                        <span className="agent-name">
                          {agent.name}
                          {agent.role ? <span className="agent-role">{agent.role}</span> : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="agent-settings"
                        aria-label={`Agent settings for ${agent.name}`}
                        title="Agent settings"
                        onClick={() => openAgentSettings(agent.id)}
                      >
                        ⚙
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="add-agent"
                  onClick={() => openNewAgent(cat.id)}
                  onDragOver={allowDrop(catKey, ['agent'], false)}
                  onDragLeave={leaveDrop(catKey)}
                  onDrop={dropOnCategory(cat.id)}
                >
                  <span className="ghost">+</span> Add agent
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rail-foot">
        <button type="button" className="new-cat" onClick={openNewCategory}>
          <span className="ghost">+</span> New category
        </button>
      </div>

      <OnboardingModals />
    </nav>
  );
}
