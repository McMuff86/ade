import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), { name: 'ade-tray-icon', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'tray.png', source: readFileSync('agentic_coding_environment_icon.png') });
    } }],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
