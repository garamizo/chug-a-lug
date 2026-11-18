import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldSwitch, watchUpdates, type Pending } from '../../src/lib/update';

class FakeWorker extends EventTarget {
	state = 'installed';
	postMessage = vi.fn();
	activate() {
		this.state = 'activated';
		this.dispatchEvent(new Event('statechange'));
	}
}
class FakeRegistration extends EventTarget {
	waiting: FakeWorker | null = null;
	installing: FakeWorker | null = null;
	active: FakeWorker | null = null;
	update = vi.fn(async () => {});
}
class FakeDoc extends EventTarget {
	visibilityState = 'hidden';
}

let container: EventTarget;
let reg: FakeRegistration;
let doc: FakeDoc;
const start = () => watchUpdates(container, reg, doc);

beforeEach(() => {
	vi.useFakeTimers();
	container = new EventTarget();
	reg = new FakeRegistration();
	doc = new FakeDoc();
});
afterEach(() => vi.useRealTimers());

describe('shouldSwitch', () => {
	const ok = { pending: 'waiting' as Pending, switching: false, type: 'link', sameOrigin: true, willUnload: false, busy: false };
	it('is true for a waiting or active update on a plain link tap', () => {
		expect(shouldSwitch(ok)).toBe(true);
		expect(shouldSwitch({ ...ok, pending: 'active' })).toBe(true);
	});
	it('is false for everything else', () => {
		for (const type of ['goto', 'popstate', 'leave', 'form']) expect(shouldSwitch({ ...ok, type })).toBe(false);
		expect(shouldSwitch({ ...ok, sameOrigin: false })).toBe(false);
		expect(shouldSwitch({ ...ok, willUnload: true })).toBe(false);
		expect(shouldSwitch({ ...ok, busy: true })).toBe(false);
		expect(shouldSwitch({ ...ok, pending: 'none' })).toBe(false);
		expect(shouldSwitch({ ...ok, switching: true })).toBe(false);
	});
});

describe('pending', () => {
	it('waiting at start counts', () => {
		reg.active = new FakeWorker();
		reg.waiting = new FakeWorker();
		expect(start().pending).toBe('waiting');
	});
	it('updatefound then installed with an active worker counts', () => {
		reg.active = new FakeWorker();
		const w = start();
		expect(w.pending).toBe('none');
		const inst = new FakeWorker();
		inst.state = 'installing';
		reg.installing = inst;
		reg.dispatchEvent(new Event('updatefound'));
		inst.state = 'installed';
		reg.waiting = inst;
		inst.dispatchEvent(new Event('statechange'));
		expect(w.pending).toBe('waiting');
	});
	it('a first install never counts', () => {
		const w = start();
		const inst = new FakeWorker();
		inst.state = 'installing';
		reg.installing = inst;
		reg.dispatchEvent(new Event('updatefound'));
		inst.state = 'installed';
		reg.waiting = inst;
		inst.dispatchEvent(new Event('statechange'));
		expect(w.pending).toBe('none');
		reg.waiting = null;
		reg.active = inst;
		inst.activate();
		expect(w.pending).toBe('none');
	});
	it('an installing worker present at start is followed', () => {
		reg.active = new FakeWorker();
		const inst = new FakeWorker();
		inst.state = 'installing';
		reg.installing = inst;
		const w = start();
		expect(w.pending).toBe('none');
		inst.state = 'installed';
		reg.waiting = inst;
		inst.dispatchEvent(new Event('statechange'));
		expect(w.pending).toBe('waiting');
	});
	it('an unasked controllerchange makes it active', () => {
		const w = start();
		container.dispatchEvent(new Event('controllerchange'));
		expect(w.pending).toBe('active');
	});
	it("the page's own handoff is not unasked", async () => {
		const worker = new FakeWorker();
		reg.active = new FakeWorker();
		reg.waiting = worker;
		const w = start();
		const p = w.switchTo('/crew', { isBusy: () => false, load: vi.fn() });
		container.dispatchEvent(new Event('controllerchange'));
		expect(w.pending).not.toBe('active');
		worker.activate();
		await vi.advanceTimersByTimeAsync(200);
		await p;
	});
});

describe('checking', () => {
	it('checks on return to the front', () => {
		start();
		doc.visibilityState = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(reg.update).toHaveBeenCalledTimes(1);
	});
	it('does not check when hidden', () => {
		start();
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(reg.update).not.toHaveBeenCalled();
	});
	it('a failed check is ignored', async () => {
		reg.update = vi.fn(async () => {
			throw new Error('offline');
		});
		start();
		doc.visibilityState = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(10);
		expect(reg.update).toHaveBeenCalled();
	});
});

describe('switchTo', () => {
	const setup = () => {
		const worker = new FakeWorker();
		reg.active = new FakeWorker();
		reg.waiting = worker;
		const load = vi.fn();
		return { worker, load, w: start() };
	};
	it('hands over and loads', async () => {
		const { worker, load, w } = setup();
		const p = w.switchTo('/crew', { isBusy: () => false, load });
		expect(w.switching).toBe(true);
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
		worker.activate();
		await vi.advanceTimersByTimeAsync(0);
		await p;
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
	it('loads after the activation timeout', async () => {
		const { load, w } = setup();
		const p = w.switchTo('/crew', { isBusy: () => false, load });
		await vi.advanceTimersByTimeAsync(2900);
		expect(load).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		await p;
		expect(load).toHaveBeenCalled();
	});
	it('waits for a send started during the handoff', async () => {
		const { worker, load, w } = setup();
		let busy = true;
		const p = w.switchTo('/crew', { isBusy: () => busy, load });
		worker.activate();
		await vi.advanceTimersByTimeAsync(400);
		expect(load).not.toHaveBeenCalled();
		busy = false;
		await vi.advanceTimersByTimeAsync(200);
		await p;
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
	it('waits for a send started during the handoff, however long', async () => {
		const { worker, load, w } = setup();
		let busy = true;
		const p = w.switchTo('/crew', { isBusy: () => busy, load });
		worker.activate();
		await vi.advanceTimersByTimeAsync(59_000);
		expect(load).not.toHaveBeenCalled();
		busy = false;
		await vi.advanceTimersByTimeAsync(1_000);
		await p;
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
	it('a navigation during the handoff wins', async () => {
		const { worker, load, w } = setup();
		const p = w.switchTo('/crew', { isBusy: () => false, load });
		w.supersede('/route');
		worker.activate();
		await vi.advanceTimersByTimeAsync(200);
		await p;
		expect(load).toHaveBeenCalledWith('/route', true);
	});
	it('a throwing worker still loads', async () => {
		const { worker, load, w } = setup();
		worker.postMessage.mockImplementation(() => {
			throw new Error('gone');
		});
		let busy = true;
		const p = w.switchTo('/crew', { isBusy: () => busy, load });
		await vi.advanceTimersByTimeAsync(300);
		expect(w.switching).toBe(true);
		expect(load).not.toHaveBeenCalled();
		busy = false;
		await vi.advanceTimersByTimeAsync(200);
		await expect(p).resolves.toBeUndefined();
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
	it('a throwing isBusy counts as busy', async () => {
		const { worker, load, w } = setup();
		let throwing = true;
		const p = w.switchTo('/crew', {
			isBusy: () => {
				if (throwing) throw new Error('boom');
				return false;
			},
			load
		});
		worker.activate();
		await vi.advanceTimersByTimeAsync(1000);
		expect(load).not.toHaveBeenCalled();
		throwing = false;
		await vi.advanceTimersByTimeAsync(200);
		await p;
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
	it('a throwing load does not reject and frees switching', async () => {
		const { worker, w } = setup();
		const load = vi.fn(() => {
			throw new Error('nav failed');
		});
		const p = w.switchTo('/crew', { isBusy: () => false, load });
		worker.activate();
		await vi.advanceTimersByTimeAsync(200);
		await expect(p).resolves.toBeUndefined();
		expect(load).toHaveBeenCalledTimes(1);
		expect(w.switching).toBe(false);
	});
	it('active loads without messaging', async () => {
		const { worker, load, w } = setup();
		container.dispatchEvent(new Event('controllerchange'));
		const p = w.switchTo('/crew', { isBusy: () => false, load });
		await vi.advanceTimersByTimeAsync(200);
		await p;
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
	it('ignores taps while switching', async () => {
		const { worker, load, w } = setup();
		expect(w.switching).toBe(false);
		const o = { isBusy: () => false, load };
		const p = w.switchTo('/crew', o);
		expect(w.switching).toBe(true);
		await w.switchTo('/other', o);
		worker.activate();
		await vi.advanceTimersByTimeAsync(200);
		await p;
		expect(worker.postMessage).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledWith('/crew', false);
	});
});

describe('dispose', () => {
	it('stops listening', () => {
		reg.active = new FakeWorker();
		const inst = new FakeWorker();
		inst.state = 'installing';
		reg.installing = inst;
		const w = start();
		w.dispose();
		inst.state = 'installed';
		reg.waiting = inst;
		inst.dispatchEvent(new Event('statechange'));
		expect(w.pending).toBe('none');
		reg.waiting = new FakeWorker();
		reg.dispatchEvent(new Event('updatefound'));
		container.dispatchEvent(new Event('controllerchange'));
		doc.visibilityState = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(w.pending).toBe('none');
		expect(reg.update).not.toHaveBeenCalled();
	});
});
