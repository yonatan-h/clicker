import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'See Browse',
    description: 'AI browser automation agent',
    permissions: ['activeTab', 'scripting', 'tabs', 'storage'],
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



