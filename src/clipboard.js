export async function copyText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('There is no Markdown to copy.');
  try {
    await navigator.clipboard.writeText(value);
  } catch (clipboardError) {
    // Clipboard permission still allows selection-based copy if the popup loses focus.
    const focused = document.activeElement;
    const selection = document.createElement('textarea');
    selection.value = value;
    selection.setAttribute('readonly', '');
    selection.setAttribute('aria-hidden', 'true');
    Object.assign(selection.style, { position: 'fixed', left: '-10000px', top: '0' });
    document.body.append(selection);
    try {
      selection.select();
      if (!document.execCommand('copy')) throw clipboardError;
    } finally {
      selection.remove();
      focused?.focus({ preventScroll: true });
    }
  }
}
