import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  manifest: {
    name: "Clicker",
    description:
      "An agentic helper that interacts with your browser in real time",
    permissions: ["activeTab", "scripting", "tabs", "storage", "debugger"],
    host_permissions: [
      "<all_urls>",
      "https://generativelanguage.googleapis.com/*",
    ],
    commands: {
      "wxt:reload-extension": {
        description: "Reload extension during development",
      },
    },
  },
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
