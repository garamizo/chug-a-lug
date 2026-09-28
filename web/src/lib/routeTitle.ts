// Route names: 1–80 characters once trimmed, unique ignoring case and runs of spaces. The hook
// (pocketbase/pb_hooks/routeTitle.js) enforces the same rule; keep the two in step.
import { copy } from './labels';

export const TITLE_MAX = 80;

export function normalizeTitle(input: unknown): { display: string; key: string } | null {
  if (typeof input !== 'string') return null;
  const display = input.trim();
  if (display.length < 1 || display.length > TITLE_MAX) return null;
  return { display, key: display.replace(/\s+/g, ' ').toLowerCase() };
}

/** "Copy of X", then "Copy of X (2)"…, with X cut so the whole name stays within 80. */
export function cloneTitle(source: string, n: number): string {
  const suffix = n > 1 ? ` (${n})` : '';
  return `${copy.cloneTitlePrefix} ${source.trim()}`.slice(0, TITLE_MAX - suffix.length).trimEnd() + suffix;
}

/**
 * The hooks answer a bad name with the code as the message (`BadRequestError('title_taken')`),
 * but PocketBase's ApiError sentenizes every message for display — capitalizes it and appends a
 * period if missing — turning `title_taken` into `Title_taken.` on the wire. Undo that before
 * matching so the hook's code and this check stay in step regardless of PocketBase's formatting.
 */
export function titleError(err: unknown): string | null {
  const e = err as { response?: { message?: string }; message?: string } | null;
  const raw = e?.response?.message ?? e?.message;
  const code = raw?.toLowerCase().replace(/\.$/, '');
  return code === 'title_taken' ? copy.titleTaken : code === 'title_invalid' ? copy.titleInvalid : null;
}
