import { expect, test, type Page } from '@playwright/test';
import { layoutViolations } from './layoutRules';

const page390 = async (page: Page, body: string) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The app's own viewport meta (src/app.html): without it, mobile emulation lays out at 980 px.
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>body{margin:0;font:16px sans-serif}</style></head><body>${body}</body></html>`);
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(390);
};
const rules = (v: string[]) => v.map((s) => s.split(':')[0]);

test('a clean page reports nothing', async ({ page }) => {
  await page390(page, `<main style="padding:16px"><label>Email<input type="email" style="width:100%;height:44px"></label>
    <p>Read <a href="#x">the rules</a> first.</p><button style="width:100%;height:48px">Go</button></main>`);
  expect(await layoutViolations(page)).toEqual([]);
});

test('page-overflow: something wider than the phone', async ({ page }) => {
  await page390(page, `<div style="width:600px;height:20px"></div>`);
  expect(rules(await layoutViolations(page))).toContain('page-overflow');
});

test('a scroller that scrolls inside its own box: no page-overflow, off-screen controls still checked, position restored', async ({ page }) => {
  await page390(page, `<div id="strip" style="overflow-x:auto;width:100%"><div style="width:900px;display:flex;gap:8px">
    ${Array.from({ length: 12 }, (_, i) => `<button style="width:60px;height:40px;flex:none">S${i}</button>`).join('')}
    <button id="far" style="width:10px;height:40px;flex:none;padding:0">x</button></div></div>`);
  await page.evaluate(() => { document.getElementById('strip')!.scrollLeft = 50; });
  const v = await layoutViolations(page);
  expect(rules(v)).not.toContain('page-overflow');
  expect(v.join()).toContain('small-target: button#far');            // off-screen at 50 px, still checked
  expect(v.filter((s) => s.startsWith('covered'))).toEqual([]);       // scrolled into view, so not covered
  expect(await page.evaluate(() => document.getElementById('strip')!.scrollLeft)).toBe(50);
});

test('narrow-field: a free-text field under 120 px; a compact time field is fine', async ({ page }) => {
  await page390(page, `<div style="display:flex"><input id="pw" type="password" style="width:30px;height:44px">
    <button style="flex:1;height:44px">Show</button></div><input type="time" style="width:110px;height:44px">`);
  const v = await layoutViolations(page);
  expect(v.filter((s) => s.startsWith('narrow-field'))).toHaveLength(1);
  expect(v.find((s) => s.startsWith('narrow-field'))).toContain('input#pw');
});

test('small-target: a squashed control, but not a text link in a sentence', async ({ page }) => {
  await page390(page, `<button style="width:20px;height:20px;padding:0">x</button>
    <p>Then <a href="#y">tap here</a> or <button class="link" style="all:unset;text-decoration:underline">here</button>.</p>
    <button style="width:0;height:0;padding:0;border:0;overflow:hidden">gone</button>`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('small-target'));
  expect(v).toHaveLength(2);           // the 20 px one and the zero-size one
  expect(v.join()).not.toContain('tap here');
});

test('covered: a control under a fixed bar is reported', async ({ page }) => {
  await page390(page, `<div style="height:2000px"></div><button id="under" style="width:100%;height:48px">Save</button>
    <div style="position:fixed;left:0;right:0;top:0;bottom:0;background:#000"></div>`);
  expect((await layoutViolations(page)).join()).toContain('covered: button#under');
});

test('text-spill: a label wider than its button', async ({ page }) => {
  await page390(page, `<button style="width:60px;height:48px;white-space:nowrap;overflow:hidden">A very long label</button>
    <button style="width:60px;height:48px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Also long but ellipsed</button>`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('text-spill'));
  expect(v).toHaveLength(1);
  expect(v[0]).toContain('A very long');
});

test('only the topmost modal layer is checked, and a broken control inside it still fails', async ({ page }) => {
  await page390(page, `<button style="width:100%;height:48px">Behind</button>
    <dialog id="d" style="width:300px"><button id="tiny" style="width:10px;height:10px;padding:0">x</button>
    <button style="width:100%;height:48px">Close</button></dialog>
    <div role="dialog" aria-modal="true" hidden><button>never</button></div>`);
  await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).showModal());
  const v = await layoutViolations(page);
  expect(v.join()).not.toContain('Behind');
  expect(v.join()).toContain('small-target: button#tiny');
});

test('the modal opened last is the layer, whatever the DOM order', async ({ page }) => {
  await page390(page, `<dialog id="top" style="width:340px;height:400px"><button id="tinyTop" style="width:10px;height:10px;padding:0">t</button></dialog>
    <dialog id="under" style="width:340px;height:400px"><button id="tinyUnder" style="width:10px;height:10px;padding:0">u</button></dialog>`);
  // Opened in reverse DOM order: #under first, then #top, which therefore sits above it.
  await page.evaluate(() => { (document.getElementById('under') as HTMLDialogElement).showModal(); (document.getElementById('top') as HTMLDialogElement).showModal(); });
  const v = (await layoutViolations(page)).join();
  expect(v).toContain('button#tinyTop');
  expect(v).not.toContain('button#tinyUnder');
});

test('an aria-modal sheet is a layer too; controls behind its scrim are not covered', async ({ page }) => {
  await page390(page, `<button style="width:100%;height:48px">Behind</button>
    <div style="position:fixed;inset:0;background:#0008"></div>
    <div role="dialog" aria-modal="true" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#222">
    <button style="width:100%;height:48px">Beer</button><button id="tinySheet" style="width:10px;height:10px;padding:0">x</button></div>`);
  const v = await layoutViolations(page);
  expect(v.join()).not.toContain('Behind');
  expect(v.join()).toContain('small-target: button#tinySheet');   // a control inside the sheet is still checked
});

test('a modal hidden under something else is reported, and its controls are still checked', async ({ page }) => {
  await page390(page, `<div role="dialog" aria-modal="true" id="sheet" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#222;z-index:1">
    <button id="tinyUnder" style="width:10px;height:10px;padding:0">x</button></div>
    <div style="position:fixed;inset:0;z-index:2;background:#000"></div>`);
  const v = (await layoutViolations(page)).join('\n');
  expect(v).toMatch(/covered: div#sheet\[?.* is under/);
  expect(v).toContain('small-target: button#tinyUnder');
});

test('hidden things are skipped: display none, hidden, inert, aria-hidden, closed dialog, sr-only', async ({ page }) => {
  await page390(page, `<button style="display:none;width:1px">a</button><div hidden><input style="width:5px"></div>
    <div inert><button style="width:5px;height:5px;padding:0">b</button></div>
    <div aria-hidden="true"><button style="width:5px;height:5px;padding:0">c</button></div>
    <dialog><button style="width:5px">d</button></dialog>
    <input type="text" style="position:absolute;width:1px;height:1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden">`);
  expect(await layoutViolations(page)).toEqual([]);
});

test('the original bug: a Show button taking the row squeezes the password field, and the sweep says so', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('password-input').waitFor();
  // Restore the original flex row too: the new auth card positions Show inside the input.
  // In that old row, the global full-width button squeezed the password field below 120px.
  await page.addStyleTag({ content: '.password { display: flex !important; } .password button { position: static !important; width: 100% !important; flex: 0 1 auto !important; padding: 14px !important; min-height: 48px !important; }' });
  expect((await page.getByTestId('password-input').boundingBox())!.width).toBeLessThan(120);
  expect((await layoutViolations(page)).join('\n')).toMatch(/narrow-field: input#password.* on \/login/);
});

test('a control mid-way through an entrance animation is measured once the animation has finished', async ({ page }) => {
  await page390(page, `<style>@keyframes flip { from { transform: scaleY(0) } to { transform: none } }
    .t { display:block; height:48px; animation: flip .4s ease-out .2s both; transform-origin: top }
    .spin { width:30px; height:30px; animation: flip 1s infinite }</style>
    <a href="#r" class="t">Route</a><div class="spin"></div>`);
  expect(await layoutViolations(page)).toEqual([]);   // the infinite one must not make it wait forever
});

test('a stretched link (an ::after covering its row) is measured by the row it covers', async ({ page }) => {
  await page390(page, `<style>.row{position:relative;padding:16px} .row a::after{content:'';position:absolute;inset:0}
    .bare{position:relative;padding:0} .bare a{font-size:10px;line-height:10px}</style>
    <div class="row"><a href="#a" style="display:block;line-height:20px">Route title</a></div>
    <div class="bare"><a href="#b" style="display:block">tiny</a></div>`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('small-target'));
  expect(v).toHaveLength(1);   // the plain 10 px link still fails; the stretched one does not
  expect(v[0]).toContain('"tiny"');
});

test('a decorative pseudo on a positioned control does not exempt it; a pseudo that covers its row does', async ({ page }) => {
  await page390(page, `<style>.badge{position:relative;width:16px;height:16px;padding:0} .badge::after{content:'';position:absolute;top:-4px;right:-4px;width:8px;height:8px}
    .row{position:relative;padding:16px} .row a{display:block;line-height:20px} .row a::after{content:'';position:absolute;top:0;left:0;width:20px;height:20px}</style>
    <button id="badge" class="badge">1</button><div class="row"><a id="half" href="#h">Not stretched</a></div>`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('small-target')).join();
  expect(v).toContain('button#badge');   // its notch is decoration, not a bigger target
  expect(v).toContain('a#half');         // a pseudo that does not cover the row is no stretched link
});

test('narrow-field reads the field type as the browser does: TEXT and unknown types are free text', async ({ page }) => {
  await page390(page, `<input id="upper" type="TEXT" style="width:40px;height:44px"><input id="odd" type="nonsense" style="width:40px;height:44px">`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('narrow-field')).join();
  expect(v).toContain('input#upper');
  expect(v).toContain('input#odd');
});
