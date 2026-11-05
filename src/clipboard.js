export async function copyText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('There is no Markdown to copy.');
  try {
    await navigator.clipboard.writeText(value);
  } catch (clipboardError) {
    // A popup can lose focus while a network request finishes. Chrome's
    // clipboardWrite permission also permits a selection-based copy.
    if (typeof document === 'undefined') throw clipboardError;
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
