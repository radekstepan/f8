/**
 * Best-effort text copy that works outside secure contexts too: the async
 * Clipboard API first, then the legacy textarea + execCommand fallback.
 * Resolves true when the text was (as far as we can tell) copied, false
 * otherwise — callers show confirmation only on true. Never throws.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API denied or unavailable: try the legacy path below.
  }
  try {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || typeof doc.execCommand !== 'function') return false;
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand('copy');
    doc.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
