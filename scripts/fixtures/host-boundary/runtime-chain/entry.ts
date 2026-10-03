// Negative control: a runtime Electron import two modules away from the entry.
import { middle } from './middle';
export const value = middle();
