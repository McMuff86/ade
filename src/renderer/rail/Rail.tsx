/**
 * Left rail — two-level list of categories and their agents, per the mockup.
 *
 * Category header: square avatar + name + agent count + collapse chevron.
 * Agent rows: round avatar (with a presence-dot placeholder, default off),
 * name + role; selected row gets a raised bg + copper inset line. Hover a
 * category to reveal "+ Add agent"; the footer carries "+ New category".
 */

import { useState } from 'react';
import { Avatar } from './Avatar';
import { useAppData } from '../stores/appdata';
import { useSelection } from '../stores/selection';
import { useOnboarding } from '../onboarding/useOnboarding';
import { OnboardingModals } from '../onboarding/OnboardingModals';
import './rail.css';

export function Rail(): React.ReactElement {
  const categories = useAppData((s) => s.categories);
  const agents = useAppData((s) => s.agents);
  const selectedAgentId = useSelection((s) => s.selectedAgentId);
  const setSelectedAgent = useSelection((s) => s.setSelectedAgent);
  const openNewCategory = useOnboarding((s) => s.openNewCategory);
  const openNewAgent = useOnboarding((s) => s.openNewAgent);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string): void =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <nav className="rail-inner" aria-label="Categories and agents">
      <div className="rail-scroll">
        {categories.map((cat) => {
          const isCollapsed = collapsed[cat.id] ?? false;
          return (
            <div key={cat.id} className={`cat${isCollapsed ? ' collapsed' : ''}`}>
              <button
                type="button"
                className="cat-head"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(cat.id)}
              >
                <Avatar name={cat.name} photo={cat.photo} shape="square" size={30} seed={cat.id} />
                <span className="cat-name">{cat.name}</span>
                <span className="cat-meta">{cat.agents.length}</span>
                <span className="cat-chevron" aria-hidden="true">
                  ▾
                </span>
              </button>

              <div className="agents">
                {cat.agents.map((agentId) => {
                  const agent = agents[agentId];
                  if (!agent) return null;
                  const selected = agent.id === selectedAgentId;
                  return (
                    <button
                      type="button"
                      key={agent.id}
                      className={`agent-row${selected ? ' selected' : ''}`}
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
                  );
                })}

                <button
                  type="button"
                  className="add-agent"
                  onClick={() => openNewAgent(cat.id)}
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
