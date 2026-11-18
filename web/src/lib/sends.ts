// App-wide count of writes still in flight: every non-GET request of the shared PocketBase client
// and of `api()`, plus whole multi-step sends (a chat upload, a stop move). Plain state, not
// reactive: the version-switch check polls `sending()` when a link is tapped.

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

/** Anything but a GET or HEAD changes something on the server. A missing method is a GET. */
export function isWrite(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

type Sender = { send(path: string, options?: { method?: string }): Promise<unknown> };

/** Routes every write `client.send` makes through `track`; reads pass straight through. */
export function trackWrites(client: Sender, track: <T>(p: Promise<T>) => Promise<T>): void {
  const send = client.send.bind(client);
  client.send = (path, options) => (isWrite(options?.method) ? track(send(path, options)) : send(path, options));
}

const app = createSends();
export const track = app.track;
export const sending = app.sending;
