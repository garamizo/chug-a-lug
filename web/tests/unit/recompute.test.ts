import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recomputeItinerary } from '$lib/server/recompute';

// Mutable state closed over by the mock factory (vi.hoisted runs before the mocks and the imports).
const state = vi.hoisted(() => ({ itineraryError: null as { status: number; message: string } | null }));

vi.mock('$lib/server/pb', () => ({
  adminPb: vi.fn(async () => ({
    filter: (_raw: string, params: Record<string, unknown>) => String(params.id),
    collection: (name: string) => ({
      getOne: async () => {
        if (state.itineraryError) throw Object.assign(new Error(state.itineraryError.message), { status: state.itineraryError.status });
        return { id: 'x', event_date: '2026-12-26', start_time: '11:00' };
      },
      getFullList: async () => [],
      delete: async () => undefined,
      create: async () => ({ id: `${name}1` })
    })
  }))
}));

vi.mock('$lib/server/metra', () => ({
  metra: { getSchedule: vi.fn(async () => ({ trips: [], stations: new Map(), calendars: [], exceptions: new Map(), routes: new Map() })) }
}));

const { metra } = await import('$lib/server/metra');

beforeEach(() => {
  state.itineraryError = null;
  vi.mocked(metra.getSchedule).mockClear();
});

describe('recomputeItinerary', () => {
  it('resolves as a no-op when the itinerary is gone (cascade delete of a draft)', async () => {
    state.itineraryError = { status: 404, message: "The requested resource wasn't found." };

    await expect(recomputeItinerary('aaaaaaaaaaaaaaa')).resolves.toEqual({ legs: 0, impossible: 0 });
    expect(metra.getSchedule).not.toHaveBeenCalled();
  });

  it('never emits an unhandled rejection when a fire-and-forget recompute fails', async () => {
    state.itineraryError = { status: 500, message: 'PocketBase is down' };
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    recomputeItinerary('bbbbbbbbbbbbbbb'); // caller ignores the promise, as the internal endpoint does
    await new Promise((resolve) => setTimeout(resolve, 50));

    process.off('unhandledRejection', onUnhandled);
    expect(seen).toEqual([]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('still rejects for a caller that awaits it', async () => {
    state.itineraryError = { status: 500, message: 'PocketBase is down' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(recomputeItinerary('ccccccccccccccc')).rejects.toThrow('PocketBase is down');
    errors.mockRestore();
  });
});
