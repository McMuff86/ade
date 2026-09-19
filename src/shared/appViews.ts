import { t as translate } from "./i18n";
import { localizedLabels } from "./i18n/labels";
/** Navigation order and names shared by desktop and mobile. Labels resolve in the active interface language. */
export const APP_VIEWS = localizedLabels(() => ([
  { id: 'overview', label: translate("Overview") },
  { id: 'tasks', label: translate("Tasks [41756667]") },
  { id: 'notes', label: translate("Notes") },
  { id: 'projects', label: translate("Projects") },
  { id: 'terminals', label: translate("Terminals") },
  { id: 'work', label: translate("Jobs") },
  { id: 'graph', label: translate("Graph") },
] as const));
export type AppView = (typeof APP_VIEWS)[number]['id'];
