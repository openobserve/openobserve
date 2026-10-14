import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, active } from './lib.mjs';
const [STATE, OUT] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE });
const p = await ctx.newPage(); const R = {};
const go = async (path, wait=6000) => { await p.goto(BASE + path + '?org_identifier=default'); await p.waitForTimeout(wait); await p.mouse.move(1439, 899); };
const pop = () => p.evaluate(()=>[...document.querySelectorAll('[role=dialog]')].filter(e=>e.getBoundingClientRect().width>0).length);
// date picker escape from several focus positions
await go('/logs', 8000); R.dp = [];
for (const steps of [0, 1, 4]) { await p.focus('[data-test=date-time-btn]'); await p.keyboard.press('Enter'); await p.waitForTimeout(800); for (let i=0;i<steps;i++) await p.keyboard.press('Tab');
  const at = (await active(p)).dt; await p.keyboard.press('Escape'); await p.waitForTimeout(600); R.dp.push({ tabsBeforeEsc: steps, focusAt: at, openAfterEsc: await pop(), focusAfter: (await active(p)).dt }); if (await pop()) { await p.mouse.click(5, 880); await p.waitForTimeout(400); } }
// tooltip hover on settings info icon
await go('/settings/general', 6000); const icons = p.locator('main svg, main [data-o-tooltip-trigger]');
const info = p.locator('[data-o-tooltip-trigger]').filter({ hasNot: p.locator('xx') });
R.tooltipTriggers = await info.count();
const cand = p.locator('main button:has(svg), main [data-o-tooltip-trigger]');
for (let i=0; i<Math.min(await cand.count(),6); i++) { const el = cand.nth(i); const bb = await el.boundingBox(); if (!bb) continue; await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(1800);
  const tips = await p.evaluate(()=>[...document.querySelectorAll('[role=tooltip], [data-reka-popper-content-wrapper]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect(); return {txt:e.innerText.trim().slice(0,50),x:r.x,y:r.y,w:r.width,h:r.height};}));
  if (tips.length) { const t=tips[0]; R.tooltip = { trigger: i, text: t.txt }; await p.screenshot({ path: OUT+'/verify-tooltip-hover.png' }); await p.mouse.move(t.x+t.w/2, t.y+t.h/2, { steps: 8 }); await p.waitForTimeout(700);
    R.tooltip.visibleWhenPointerOnTooltip = (await p.evaluate(()=>[...document.querySelectorAll('[role=tooltip]')].filter(e=>e.getBoundingClientRect().width>0).length)) > 0;
    await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(1800); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    R.tooltip.visibleAfterEscape = (await p.evaluate(()=>[...document.querySelectorAll('[role=tooltip]')].filter(e=>e.getBoundingClientRect().width>0).length)) > 0;
    R.tooltip.triggerAttrs = await el.evaluate(e=>({tag:e.tagName, role:e.getAttribute('role'), tabindex:e.getAttribute('tabindex'), describedby:e.getAttribute('aria-describedby'), aria:e.getAttribute('aria-label')})); break; } }
// mobile nav drawer
await p.setViewportSize({ width: 375, height: 740 }); await go('/', 6000);
const mb = p.locator('header button[aria-label]').first(); R.mobileMenuBtn = await mb.evaluate(e=>({label:e.getAttribute('aria-label'), expanded:e.getAttribute('aria-expanded'), controls:e.getAttribute('aria-controls')}));
await mb.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(900); await p.screenshot({ path: OUT+'/verify-mobile-nav-open.png' });
R.mobileNav = { afterOpen: await active(p), dialog: await p.evaluate(()=>[...document.querySelectorAll('[role=dialog]')].filter(e=>e.getBoundingClientRect().width>0).map(d=>({modal:d.getAttribute('aria-modal'), lb:d.getAttribute('aria-labelledby'), label:d.getAttribute('aria-label')}))), expandedNow: await mb.getAttribute('aria-expanded'),
  unnamed: await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].filter(b=>!(b.getAttribute('aria-label')||b.innerText.trim()||b.getAttribute('aria-labelledby'))).length) };
const seq=[]; for (let i=0;i<20;i++){ await p.keyboard.press('Tab'); const a=await active(p); seq.push(a.tag+':'+(a.name||a.dt).slice(0,20)); } R.mobileNav.tab=seq;
await p.keyboard.press('Escape'); await p.waitForTimeout(600); R.mobileNav.afterEsc = await active(p);
fs.writeFileSync(OUT+'/verify-results.json', JSON.stringify(R,null,1)); console.log(JSON.stringify(R,null,1).slice(0,4000));
await b.close();
