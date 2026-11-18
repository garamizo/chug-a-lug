// Notices a waiting service worker and hands over to it at the next in-app link tap.
// Framework-free: the root layout passes the real objects and a `load` that does the full load.
export type Pending = 'none' | 'waiting' | 'active';

export function shouldSwitch(o: {
  pending: Pending;
  switching: boolean;
  type: string;
  sameOrigin: boolean;
  willUnload: boolean;
  busy: boolean;
}): boolean {
  return (
    o.pending !== 'none' &&
    !o.switching &&
    o.type === 'link' &&
    o.sameOrigin &&
    !o.willUnload &&
    !o.busy
  );
}

export interface WorkerLike extends EventTarget {
  state: string;
  postMessage(m: unknown): void;
}
export interface RegistrationLike extends EventTarget {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  active: WorkerLike | null;
  update(): Promise<unknown>;
}
export interface ContainerLike extends EventTarget {}
export interface DocLike extends EventTarget {
  visibilityState: string;
}
export interface SwitchOpts {
  isBusy: () => boolean;
  load: (href: string, replace: boolean) => void;
  activationMs?: number;
  pollMs?: number;
}
export interface UpdateWatcher {
  readonly pending: Pending;
  readonly switching: boolean;
  switchTo(href: string, o: SwitchOpts): Promise<void>;
  /** A later tap while switching: load `href` instead, and load again if a load was already issued. */
  retarget(href: string): void;
  dispose(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** No time limit: a send begun during the handoff always settles. */
async function untilIdle(o: SwitchOpts): Promise<void> {
  const busy = () => {
    try {
      return o.isBusy();
    } catch {
      return true; // unknown means busy: never full-load while something may be sending
    }
  };
  while (busy()) await sleep(o.pollMs ?? 100);
}

export function watchUpdates(
  container: ContainerLike,
  registration: RegistrationLike,
  doc: DocLike
): UpdateWatcher {
  let pending: Pending = 'none';
  let switching = false;
  let asked = false; // this page posted SKIP_WAITING, so the next controllerchange is its own
  let target: { href: string; replace: boolean } | null = null;
  let opts: SwitchOpts | null = null;
  let issued = false; // this switch has called `load` (which a later navigation may have aborted)
  let reloading = false; // a retarget's idle wait is under way
  let followed: WorkerLike | null = null;

  const read = () => {
    // Recomputed, not latched: a first install passes through `waiting` with no `active` worker.
    if (pending !== 'active') pending = registration.waiting && registration.active ? 'waiting' : 'none';
  };
  const follow = () => {
    const w = registration.installing;
    if (w && w !== followed) {
      followed?.removeEventListener('statechange', onState);
      followed = w;
      w.addEventListener('statechange', onState);
    }
  };
  const onState = () => read();
  const onFound = () => {
    follow();
    read();
  };
  const onController = () => {
    if (!asked) pending = 'active';
  };
  const onVisible = () => {
    if (doc.visibilityState !== 'visible') return;
    try {
      registration.update().catch(() => {});
    } catch {
      /* a failed check is ignored */
    }
  };

  registration.addEventListener('updatefound', onFound);
  container.addEventListener('controllerchange', onController);
  doc.addEventListener('visibilitychange', onVisible);
  follow();
  read();

  const waitActivated = (worker: WorkerLike | null, ms: number) =>
    new Promise<void>((resolve) => {
      if (!worker || worker.state === 'activated') return resolve();
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        worker.removeEventListener('statechange', check);
        resolve();
      };
      const check = () => {
        if (worker.state === 'activated') done();
      };
      worker.addEventListener('statechange', check);
      timer = setTimeout(done, ms);
    });

  const issue = (o: SwitchOpts) => {
    const t = target!;
    issued = true;
    try {
      o.load(t.href, t.replace);
    } catch {
      switching = false; // never rejects, and later taps are not stuck
      issued = false;
    }
  };

  return {
    get pending() {
      return pending;
    },
    get switching() {
      return switching;
    },
    retarget(href) {
      if (!switching) return;
      target = { href, replace: false };
      // Before the load, or while a reload waits, the load still to come takes the new target.
      if (!issued || reloading || !opts) return;
      reloading = true;
      const o = opts;
      void untilIdle(o).finally(() => {
        reloading = false;
        issue(o);
      });
    },
    async switchTo(href, o) {
      if (switching) return;
      switching = true;
      issued = false;
      opts = o;
      target = { href, replace: false };
      try {
        if (pending === 'waiting') {
          const worker = registration.waiting;
          try {
            asked = true;
            worker!.postMessage({ type: 'SKIP_WAITING' });
            await waitActivated(worker, o.activationMs ?? 3000);
          } catch {
            /* go straight to the idle wait */
          }
        }
        await untilIdle(o);
      } finally {
        issue(o);
      }
    },
    dispose() {
      registration.removeEventListener('updatefound', onFound);
      container.removeEventListener('controllerchange', onController);
      doc.removeEventListener('visibilitychange', onVisible);
      followed?.removeEventListener('statechange', onState);
      followed = null;
    }
  };
}
