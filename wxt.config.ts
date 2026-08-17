import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Clicker',
    description: 'An agentic helper that clicks and types in your browser in real time',
    permissions: ['activeTab', 'scripting', 'tabs', 'storage', 'debugger'],
    host_permissions: [
      '<all_urls>',
      'https://generativelanguage.googleapis.com/*',
    ],
    commands: {
      'wxt:reload-extension': {
        description: 'Reload extension during development',
      },
    },
  },
  modules: [],
});



