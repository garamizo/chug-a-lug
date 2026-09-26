// Press and hold (or right-click, or Enter) a chat bubble to open its menu, WhatsApp style.
const HOLD_MS = 450;

export class HoldMenu {
  openFor = $state<string | null>(null);
  #hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;

  start(e: PointerEvent, id: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.cancel();
    this.#hold = { timer: setTimeout(() => { this.#hold = null; this.openFor = id; navigator.vibrate?.(15); }, HOLD_MS), x: e.clientX, y: e.clientY };
  }
  move(e: PointerEvent) { if (this.#hold && Math.hypot(e.clientX - this.#hold.x, e.clientY - this.#hold.y) > 10) this.cancel(); }
  cancel() { if (this.#hold) clearTimeout(this.#hold.timer); this.#hold = null; }
  open(id: string) { this.cancel(); this.openFor = id; }
  close() { this.openFor = null; }
  closeOutside(e: PointerEvent) { if (this.openFor && !(e.target instanceof Element && e.target.closest('.menu'))) this.openFor = null; }
}
