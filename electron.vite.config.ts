import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { readFileSync } from 'node:fs';
import { buildIdentity } from './build/identity';

const buildDefine = { __ADE_BUILD_INFO__: JSON.stringify(buildIdentity()) };

export default defineConfig({
  main: {
    define: buildDefine,
    plugins: [externalizeDepsPlugin(), { name: 'ade-tray-icon', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'tray.png', source: readFileSync('agentic_coding_environment_icon.png') });
    } }],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    define: buildDefine,
    plugins: [react()],
  },
});
