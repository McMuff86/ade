import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useState } from 'react';
import type { MobileAgentSummary } from '../shared/remote';
import { groupCategories } from '../shared/categoryNavigation';
import { useNavigationCollapse } from '../shared/useNavigationCollapse';
import { MobileAvatar } from './AgentProfile';
import type { MobileHost } from './useMobileHost';

export function AgentNavigation({ host, selectedId, onSelect }: { host: MobileHost; selectedId?: string; onSelect: (id: string) => void }) {
  useLocale();
  const [search, setSearch] = useState('');
  const { collapsed, toggle } = useNavigationCollapse('ade:mobile:agent-navigation');
  const query = search.trim().toLocaleLowerCase();
  const catalog = host.catalog;
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const categories = (catalog?.categories ?? []).map((category) => ({ ...category,
    agents: (catalog?.agents ?? []).filter((agent) => agent.categoryId === category.id
      && (matches(`${category.name} ${category.navigationGroup ?? ''}`) || matches(`${agent.name} ${agent.role ?? ''}`))),
  })).filter((category) => category.agents.length > 0);
  const uncategorized = (catalog?.agents ?? []).filter((agent) => !catalog?.categories?.some((category) => category.id === agent.categoryId)
    && matches(`${agent.name} ${agent.role ?? ''}`));
  const row = (agent: MobileAgentSummary) => <button key={agent.id} aria-label={agent.name} aria-pressed={agent.id === selectedId}
    onClick={() => onSelect(agent.id)}><MobileAvatar host={host} agent={agent} size={26} /><span>{agent.name}</span></button>;
  return <div className="m-agent-navigation">
    <label>{translate("Search agents")}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {!catalog ? <p role="status">{translate("Loading agents…")}</p> : !catalog.agents.length ? <p>{translate("No agent profiles. You can open a standalone terminal.")}</p>
      : !categories.length && !uncategorized.length ? <p role="status">{translate("No matching categories or agents.")}</p> : <>
        {groupCategories(categories).map((group) => <section key={group.key} className={group.name ? 'm-navigation-group' : undefined} aria-label={group.name}>
          {group.name && <button className="m-navigation-heading" aria-expanded={!!query || !collapsed[group.key]} onClick={() => toggle(group.key)}>
            <span aria-hidden="true">{!query && collapsed[group.key] ? '▸' : '▾'}</span>{group.name}</button>}
          {(!group.name || !!query || !collapsed[group.key]) && group.categories.map((category) => <section key={category.id} aria-label={category.name}>
            <button className="m-navigation-category" aria-expanded={!!query || !collapsed[category.id]} onClick={() => toggle(category.id)}>
              <span aria-hidden="true">{!query && collapsed[category.id] ? '▸' : '▾'}</span>{category.name}</button>
            {(!!query || !collapsed[category.id]) && <div className="m-navigation-members">{category.agents.map(row)}</div>}
          </section>)}
        </section>)}
        {uncategorized.map(row)}
      </>}
  </div>;
}
