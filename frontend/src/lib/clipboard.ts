/**
 * Copies text to the clipboard. Resolves false when the browser refuses (no permission,
 * insecure context), so the UI can say so instead of pretending it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
