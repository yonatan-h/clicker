# Clicker

A Chrome extension agent that executes natural language browser automation goals in real time using LLMs.

## Demo

<!-- insert -->
https://github.com/user-attachments/assets/YOUR-VIDEO-ID.mp4

## How It Works

1. **Prompt**: The user enters an objective into the in-page floating overlay.
2. **DOM Parsing**: Compresses and filters the page DOM into a structured tree of interactable elements.
3. **Status**: Shows real-time execution steps and targets directly in the page overlay.

## Tech Stack

- **Framework**: [WXT](https://wxt.dev/) (Manifest V3, Vite, TypeScript)
- **UI**: React 19, Tailwind CSS (isolated via Shadow DOM)
- **Sandbox**: `jspython-interpreter` (in-browser Python engine)
- **Model**: Google Generative Language API

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```

3. Load in Chrome:
   - Go to `chrome://extensions/`
   - Toggle **Developer mode** on (top-right)
   - Click **Load unpacked** and choose `.output/chrome-mv3`

4. Add API key:
   - Click the extension icon in the toolbar
   - Enter your Gemini API key and save
