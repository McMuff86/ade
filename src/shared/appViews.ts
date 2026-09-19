/** Navigation order and names shared by desktop and mobile. */
export const APP_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'notes', label: 'Notes' },
  { id: 'projects', label: 'Projekte' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'work', label: 'Work' },
  { id: 'graph', label: 'Graph' },
] as const;
export type AppView = (typeof APP_VIEWS)[number]['id'];
