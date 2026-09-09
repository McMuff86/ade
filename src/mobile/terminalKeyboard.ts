/** Call synchronously from a deliberate click/tap, never from a frame refresh. */
export function openTerminalKeyboard(input: HTMLTextAreaElement | null | undefined, keyboardOpen: boolean): void {
  if (!input || input.readOnly || input.disabled) return;
  const keyboard = (navigator as Navigator & { virtualKeyboard?: { show?: () => void } }).virtualKeyboard;
  const refocus = () => {
    // Android can keep the textarea focused after dismissing the keyboard.
    if (!keyboardOpen && document.activeElement === input) input.blur();
    input.focus({ preventScroll: true });
  };
  if (!keyboard?.show) { refocus(); return; }
  input.focus({ preventScroll: true });
  try { keyboard.show(); } catch { refocus(); }
  // Keep the browser's visual-viewport resizing; do not enable overlaysContent.
}
