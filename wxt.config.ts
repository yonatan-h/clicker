import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'See Browse',
    description: 'AI browser automation agent',
    permissions: ['activeTab', 'scripting', 'tabs'],
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://chatgpt.com/*',
    ],
  },
  modules: [],
});
