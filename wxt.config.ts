import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'See Browse',
    description: 'Capture localhost page state for AI-assisted testing',
    permissions: ['activeTab', 'scripting', 'clipboardWrite'],
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://chatgpt.com/*',
      'https://gemini.google.com/*',
      'https://chat.deepseek.com/*',
    ],
  },
  modules: [],
});
