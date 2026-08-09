// This script runs in the background. It can listen to browser events.
export default defineBackground(() => {
  console.log('Hello world! Background script is running.');

  // Example: listen to extension icon clicks (only works if no popup is defined, 
  // or you handle it differently, but for now we'll just log on install)
  browser.runtime.onInstalled.addListener(() => {
    console.log('Extension installed successfully!');
  });
});
