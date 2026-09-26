// The chat box's pure parts: the emoji tray, which button the round button is, and caret inserts.
export const CHAT_EMOJI = ['🍻', '🍺', '🥂', '🍕', '🚆', '🎅', '🎄', '🔥', '😂', '🙌', '👍', '❤️', '🥴', '🤮', '⏰', '📍'] as const;

export type ComposerMode = 'send' | 'camera';

/** WhatsApp style: the round button is the camera while there is nothing to send. */
export const composerMode = (text: string, mediaEnabled: boolean): ComposerMode => (mediaEnabled && !text.trim() ? 'camera' : 'send');

/** Sending clears the box at once; a failed send restores its text unless the person has already
 *  typed something new, which is never thrown away. */
export const draftAfterFailedSend = (current: string, submitted: string): string => (current.trim() ? current : submitted);

/** `start`/`end` are UTF-16 offsets (what an input's selectionStart/End report). */
export function insertAt(text: string, insert: string, start: number, end: number): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}
