// This script runs when you open the popup in the extension menu
document.getElementById('click-me')?.addEventListener('click', () => {
  const msgEl = document.getElementById('message');
  if (msgEl) {
    msgEl.textContent = 'You clicked the button!';
  }
});
