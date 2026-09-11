import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Phase 13A: no @vitejs/plugin-react / JSX handling needed anymore — this is a plain
// vanilla-JS Vite app. tailwindcss stays: it's a CSS build tool (scans source for
// utility class names, emits CSS), not a UI/JS framework.
export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
});
