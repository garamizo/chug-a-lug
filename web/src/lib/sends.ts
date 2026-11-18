// App-wide count of chat and comment sends still in flight. Plain state, not reactive: the
// version-switch check polls `sending()` when a link is tapped.

export function createSends() {
  let inFlight = 0;
  return {
    /** Counts `p` as in flight until it settles; resolves or rejects exactly as `p` does. */
    track<T>(p: Promise<T>): Promise<T> {
      inFlight++;
      return p.finally(() => { inFlight--; });
    },
    sending(): boolean {
      return inFlight > 0;
    },
  };
}

const app = createSends();
export const track = app.track;
export const sending = app.sending;
