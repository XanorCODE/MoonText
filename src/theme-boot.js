/* Применяет сохранённую тему до первой отрисовки, чтобы не было вспышки неверного цвета. */
try {
  document.documentElement.dataset.theme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}
