import { t as translate } from "./i18n";
import { localizedLabels } from "./i18n/labels";
/**
 * Information architecture shared by desktop and tablet.
 *
 * Three rooms, always in the same order:
 *   Übersicht     – where am I, what needs me
 *   Organisation  – personal tasks and notes (never start an agent)
 *   Entwicklung   – projects, terminals, agent work and its graph
 * Administration (Einrichtung, Einstellungen, Diagnose) is chrome, not a room,
 * and is rendered by each shell next to the navigation, never inside it.
 *
 * The glossary below is the vocabulary every visible label must use so that
 * the same thing has the same name on PC and tablet.
 */
import { APP_VIEWS, type AppView } from './appViews';

export interface AppNavGroup {
  id: 'home' | 'organisation' | 'development';
  /** Visible caption; the home group shows only its single tab. */
  label: string;
  views: readonly AppView[];
}

export const APP_NAV_GROUPS: readonly AppNavGroup[] = localizedLabels(() => ([
  { id: 'home', label: translate("Overview"), views: ['overview'] },
  { id: 'organisation', label: translate("Organisation"), views: ['tasks', 'notes'] },
  { id: 'development', label: translate("Development"), views: ['projects', 'terminals', 'work', 'graph'] },
]));

export function viewLabel(id: AppView): string {
  return APP_VIEWS.find((view) => view.id === id)?.label ?? id;
}

export function navGroupOf(id: AppView): AppNavGroup {
  return APP_NAV_GROUPS.find((group) => group.views.includes(id)) ?? APP_NAV_GROUPS[0]!;
}

/** Next view in navigation order; wraps at both ends. */
export function adjacentView(current: AppView, direction: -1 | 1): AppView {
  const order = APP_VIEWS.map((view) => view.id);
  const index = order.indexOf(current);
  return order[(index + direction + order.length) % order.length]!;
}

/**
 * Product glossary (UX-04). Personal organisation and agent execution must not
 * share a word.
 *   Aufgabe        – a personal entry in Organisation; never runs anything.
 *   Notiz          – free content in Organisation.
 *   Agentenauftrag – work explicitly handed to one agent ("Agent beauftragen").
 *   Run            – the execution of one or many agent orders, visible in Aufträge and Graph.
 *   Sitzung        – a live terminal on the PC.
 */
export const GLOSSARY = localizedLabels(() => ({
  personalTask: translate("Task"),
  note: translate("Note"),
  agentOrder: translate("Agent job"),
  delegate: translate("Assign agent work"),
  run: translate("Run"),
  session: translate("Session"),
} as const));
