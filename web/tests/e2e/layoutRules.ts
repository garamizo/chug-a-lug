import { expect, type Page } from '@playwright/test';

/**
 * Generic layout rules, checked inside the browser on the current page (spec 2026-10-04 §2.2).
 * They catch broken layout (squeezed, covered, spilling, wider than the phone), not style.
 */
export type LayoutRule = 'page-overflow' | 'narrow-field' | 'small-target' | 'covered' | 'text-spill';

export async function layoutViolations(page: Page, skip: LayoutRule[] = []): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out: [string, string][] = [];
    const CONTROLS = 'button, a[href], input, select, textarea, [role=button], summary';
    const FREE_TEXT = new Set(['', 'text', 'email', 'password', 'search', 'tel', 'url']);

    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).map((c) => `.${c}`).join('');
      const testid = el.getAttribute('data-testid');
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}${testid ? `[data-testid=${testid}]` : ''}` +
        `${text ? ` "${text}"` : ''} ${Math.round(r.width)}×${Math.round(r.height)} px`;
    };

    // The active layer: the open modals (native dialog:modal or aria-modal) that are actually on top.
    // The DOM cannot tell top-layer order (showModal() order), so hit-test each modal at its own
    // centre: a modal under another one (StopSheet under Lightbox) is hit-tested to the one above.
    const modals = [...document.querySelectorAll('dialog, [aria-modal="true"]')].filter((el) =>
      el instanceof HTMLDialogElement ? el.matches(':modal') : el.checkVisibility({ visibilityProperty: true }));
    const onTop = modals.filter((m) => {
      const r = m.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && m.contains(hit) && !modals.some((o) => o !== m && m.contains(o) && o.contains(hit));
    });
    const layers: ParentNode[] = modals.length ? onTop : [document];

    const srOnly = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      // The .sr-only pattern: a 1×1 box clipped away. Zero size alone is not hidden (small-target reports it).
      return r.width <= 1 && r.height <= 1 && (s.clip.startsWith('rect') || s.clipPath !== 'none');
    };
    const hidden = (el: Element) =>
      !el.checkVisibility({ visibilityProperty: true }) || !!el.closest('[hidden], [inert], [aria-hidden="true"]') ||
      (el instanceof HTMLInputElement && el.type === 'hidden') || srOnly(el);
    const controls = layers.flatMap((l) => [...l.querySelectorAll(CONTROLS)]).filter((el) => !hidden(el));

    // page-overflow. The layout viewport is the root's clientWidth: on a phone, content wider than the
    // screen zooms the page out and widens innerWidth with it, so innerWidth cannot reveal overflow.
    const doc = document.documentElement, vw = doc.clientWidth, vh = doc.clientHeight;
    if (doc.scrollWidth > vw + 1) {
      const wide = [...document.body.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > vw + 1 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1);
      }).slice(0, 3).map(describe);
      out.push(['page-overflow', `page is ${doc.scrollWidth} px wide (viewport ${vw})${wide.length ? `: ${wide.join('; ')}` : ''}`]);
    }

    for (const el of controls) {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      // narrow-field: free-text fields only; time/date/number/select are compact by design.
      const freeText = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && FREE_TEXT.has(el.getAttribute('type') ?? ''));
      if (freeText && r.width < 120) out.push(['narrow-field', `${describe(el)} (min 120)`]);
      // small-target: WCAG 2.5.8 minimum; text links in running text are exempt.
      const inlineText = (el.tagName === 'A' && s.display === 'inline') || el.matches('button.link');
      if (!inlineText && (r.width < 24 || r.height < 24)) out.push(['small-target', `${describe(el)} (min 24×24)`]);
      // text-spill: a text-only button whose label is wider than its box.
      if (el.tagName === 'BUTTON' && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== 'ellipsis')
        out.push(['text-spill', `${describe(el)} needs ${el.scrollWidth} px`]);
    }

    // covered: scroll each control to the middle and hit-test its centre; then restore every scroller.
    const scrollers = [document.scrollingElement!, ...document.querySelectorAll('*')].filter((el) =>
      el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    const saved = scrollers.map((el) => [el, el.scrollLeft, el.scrollTop] as const);
    for (const el of controls) {
      if (getComputedStyle(el).pointerEvents === 'none') continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
      if (r.width === 0 || r.height === 0) continue; // already reported as small-target
      const hit = document.elementFromPoint(x, y);
      const ok = !!hit && (hit === el || el.contains(hit) || (hit instanceof HTMLLabelElement && hit.control === el));
      if (!ok) out.push(['covered', `${describe(el)} is under ${hit ? describe(hit) : 'nothing'}`]);
    }
    for (const [el, left, top] of saved) { el.scrollLeft = left; el.scrollTop = top; }
    return out;
  });
  const path = new URL(page.url()).pathname || page.url();
  const seen = new Set<string>();
  return found.filter(([rule]) => !skip.includes(rule as LayoutRule))
    .map(([rule, what]) => `${rule}: ${what} on ${path}`)
    .filter((line) => !seen.has(line) && !!seen.add(line));
}

export async function expectSaneLayout(page: Page, skip: LayoutRule[] = []): Promise<void> {
  const path = new URL(page.url()).pathname + new URL(page.url()).search;
  expect.soft(await layoutViolations(page, skip), `layout on ${path}`).toEqual([]);
}
