import { app } from 'electron';
export const appVersion = (): string => app.getVersion();
