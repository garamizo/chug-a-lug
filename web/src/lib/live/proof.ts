// Sending a drink as its photo: the photo upload is the drink. The server's media hook creates the
// drink row with the media's id, so a repeated id means "already counted", never a second drink.
import type { DrinkEntry, DrinkKind, Media } from '$lib/types';
import { copy } from '$lib/labels';
import { hookCode } from '$lib/routeTitle';

/** Identity that invalidates a send. The destination stop is NOT part of it: moving on mid-upload is fine. */
export type ProofScope = { user: string; itinerary: string; day: string; runId: string | null };
export type ProofSend = { id: string; kind: DrinkKind; stop: string; scope: ProofScope; file: File; takenAt: string };
/** What a Tab tap captures before the camera opens: the drink lands where and when it was tapped. */
export type ProofTap = { kind: DrinkKind; stop: string; scope: ProofScope };
export type ProofResult =
  | { status: 'saved'; drink: DrinkEntry | null; media: Media | null } // null = landed but not read back; caller reloads the feed
  | { status: 'stale' }                                                // scope no longer current; nothing to upsert
  | { status: 'failed'; message: string; retryable: boolean };         // retryable: keep for Retry; else the server refused it

export type ProofDeps = {
  createMedia: (form: FormData) => Promise<Media>;
  getDrink: (id: string) => Promise<DrinkEntry>; // expand user,stop
  getMedia: (id: string) => Promise<Media>;
  currentScope: () => ProofScope | null;
};

export const sameScope = (a: ProofScope, b: ProofScope | null): boolean =>
  !!b && a.user === b.user && a.itinerary === b.itinerary && a.day === b.day && a.runId === b.runId;

export function proofForm(send: ProofSend): FormData {
  const form = new FormData();
  form.set('id', send.id);
  form.set('user', send.scope.user);
  form.set('stop', send.stop);
  form.set('kind', 'image');
  form.set('taken_at', send.takenAt);
  form.set('drink_kind', send.kind);
  form.set('file', send.file);
  return form;
}

const ownWords = new Set<string>(Object.values(copy));
/** Getting the clock before a send failed: our own message if it is one, never a browser's raw English. */
export function clockFailure(err: unknown): string {
  return err instanceof Error && ownWords.has(err.message) ? err.message : copy.noSignal;
}

function failureMessage(err: unknown): string {
  if ((err as { status?: number } | null)?.status === 0) return copy.noSignal;
  const code = hookCode(err);
  if (code === 'proof_needs_image') return copy.proofNeedsImage;
  if (code === 'proof_needs_stop') return copy.proofNeedsStop;
  // The Conductor made them a Trainspotter while this app was open: final, never a Retry.
  if (code === 'trainspotter') return copy.trainspotterNoTab;
  return copy.uploadFailed;
}

/** Network trouble and 5xx may pass on a second try; a 4xx is the server refusing this very send. */
const isRetryable = (err: unknown): boolean => {
  const status = (err as { status?: number } | null)?.status;
  return typeof status !== 'number' || status === 0 || status >= 500;
};

const isDuplicate = (err: unknown): boolean =>
  (err as { response?: { data?: { id?: { code?: string } } } } | null)?.response?.data?.id?.code === 'validation_not_unique';

export async function sendProof(send: ProofSend, deps: ProofDeps): Promise<ProofResult> {
  if (!sameScope(send.scope, deps.currentScope())) return { status: 'stale' };
  // Any result is checked against the scope again: a late answer must not reach a different feed,
  // and a stale failure must never offer Retry (the server would answer proof_needs_stop).
  const settle = (r: ProofResult): ProofResult => (sameScope(send.scope, deps.currentScope()) ? r : { status: 'stale' });
  let media: Media | null = null;
  try {
    media = await deps.createMedia(proofForm(send));
  } catch (err) {
    if (!isDuplicate(err)) return settle({ status: 'failed', message: failureMessage(err), retryable: isRetryable(err) });
    // Lost response: the first attempt landed. Count it as done if its drink is there.
    try {
      const drink = await deps.getDrink(send.id);
      const m = await deps.getMedia(send.id).catch(() => null);
      return settle({ status: 'saved', drink, media: m });
    } catch {
      return settle({ status: 'failed', message: copy.uploadFailed, retryable: true });
    }
  }
  try {
    return settle({ status: 'saved', drink: await deps.getDrink(send.id), media });
  } catch {
    return settle({ status: 'saved', drink: null, media: null });
  }
}
