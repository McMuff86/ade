/** Navigation order and names shared by desktop and mobile. Labels are the visible German product names. */
export const APP_VIEWS = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'tasks', label: 'Aufgaben' },
  { id: 'notes', label: 'Notizen' },
  { id: 'projects', label: 'Projekte' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'work', label: 'Aufträge' },
  { id: 'graph', label: 'Graph' },
] as const;
export type AppView = (typeof APP_VIEWS)[number]['id'];
