(() => {
  'use strict';
  const key = 'glv-bfcm-theme';
  let theme = 'light';
  try { const saved = localStorage.getItem(key); if (saved === 'dark' || saved === 'light') theme = saved; } catch {}
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-switch');
    if (!button) return;
    const label = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-switch').addEventListener('click', () => {
      theme = theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(key, theme); } catch {}
      apply();
    });
  });
})();
