// Who is waiting to board, owned by the app layout (spec §5). It reconciles from the server
// instead of trusting events: realtime only tells it something changed.
import { pb, subscribe } from '$lib/pb';

export type WaitingRequest = { id: string; name: string; email: string; user_agent: string; country: string; created: string; status: string };
export const visibleRequests = (fetched: WaitingRequest[], hidden: ReadonlySet<string>) =>
  fetched.filter((x) => x.status === 'waiting' && !hidden.has(x.id)).sort((a, b) => a.created.localeCompare(b.created));
export const outcomeOf = (status: number): 'done' | 'answered' | 'error' => status === 200 ? 'done' : status === 409 ? 'answered' : 'error';

class BoardingQueue {
  fetched = $state.raw<WaitingRequest[]>([]);
  hidden = $state.raw<Set<string>>(new Set());
  requests = $derived(visibleRequests(this.fetched, this.hidden));
  count = $derived(this.requests.length);
  private version = 0;

  async refetch() {
    const mine = ++this.version;
    try {
      const rows = await pb.collection('boarding_requests').getFullList<WaitingRequest>({ filter: "status = 'waiting'", sort: 'created' });
      if (mine === this.version) this.fetched = rows;
    } catch { /* offline: keep the last list */ }
  }
  start(): () => void {
    void this.refetch();
    const unsub = subscribe('boarding_requests', '', () => void this.refetch());
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void this.refetch(); }, 30_000);
    return () => { unsub(); clearInterval(timer); this.version++; this.fetched = []; this.hidden = new Set(); };
  }
  async decide(id: string, verdict: 'let-aboard' | 'turn-away') {
    let status = 0;
    try { await pb.send(`/api/crawl/boarding/${id}/${verdict}`, { method: 'POST' }); status = 200; }
    catch (e) { status = (e as { status?: number }).status ?? 0; }
    await this.refetch();
    return outcomeOf(status);
  }
  later(id: string) { this.hidden = new Set([...this.hidden, id]); }
}
export const boardingQueue = new BoardingQueue();
