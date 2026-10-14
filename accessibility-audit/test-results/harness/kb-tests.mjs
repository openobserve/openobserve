import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, active, focusDiff } from './lib.mjs';
const [STATE, OUT] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE });
const p = await ctx.newPage(); p.on('dialog', d => d.dismiss());
const R = {};
const go = async (path, wait=6000) => { await p.goto(BASE + path + (path.includes('?')?'&':'?') + 'org_identifier=default'); await p.waitForTimeout(wait); await p.mouse.move(1439, 899); };
const shot = async n => p.screenshot({ path: `${OUT}/${n}.png` });
async function tabAudit(key, n){ const stops=[]; await p.evaluate(()=>document.activeElement?.blur()); await p.keyboard.press('Tab');
  for(let i=0;i<n;i++){ const a=await active(p); if(a.tag==='BODY'){ stops.push(a); await p.keyboard.press('Tab'); continue; } a.focus=await focusDiff(p); stops.push(a); await p.keyboard.press('Tab'); }
  R[key]=stops; }
// 1. Focus visibility across home, logs, alerts, dashboards, streams
await go('/'); R.homeInitialFocus = await active(p);
await tabAudit('tab_home', 30);
await go('/logs', 8000); await tabAudit('tab_logs', 30);
await go('/alerts'); await tabAudit('tab_alerts', 25);
await go('/dashboards'); await tabAudit('tab_dashboards', 25);
await go('/streams'); await tabAudit('tab_streams', 25);
// 2. Sidebar roving / arrow keys / flyout keyboard
await go('/');
await p.focus('[data-test="menu-link-/-item"]'); const seq=[];
for (const k of ['ArrowDown','ArrowDown','ArrowDown','ArrowRight','Enter']) { await p.keyboard.press(k); await p.waitForTimeout(500); seq.push({ key:k, active: await active(p), url: p.url().replace(BASE,'').replace(/\?.*/,''), flyout: await p.locator('.nav-group-flyout:visible').count() }); }
R.sidebarKeys = seq; await shot('kb-sidebar-after-keys');
await go('/');
await p.focus('[data-test="menu-link-/traces-item"]').catch(()=>{});
R.tracesFocusable = await active(p);
await p.keyboard.press('Enter'); await p.waitForTimeout(800);
R.tracesEnter = { url: p.url().replace(BASE,'').replace(/\?.*/,''), flyoutVisible: await p.locator('.nav-group-flyout:visible').count(), active: await active(p) };
await p.keyboard.press('Tab'); R.tracesAfterTab = await active(p);
// 3. Header menus: org selector, help, profile
for (const dt of ['navbar-organizations-select-trigger','menu-link-help-item','header-my-account-profile-icon']) {
  await go('/', 5000); await p.focus(`[data-test="${dt}"]`); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  const open = { afterEnter: await active(p), menus: await p.evaluate(()=>[...document.querySelectorAll('[role=menu],[role=listbox],[role=dialog]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getAttribute('role')+' items='+e.querySelectorAll('[role=menuitem],[role=option],button,a').length)), expanded: await p.getAttribute(`[data-test="${dt}"]`,'aria-expanded') };
  await shot('kb-menu-open-'+dt);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200); open.afterDown = await active(p);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200); open.afterDown2 = await active(p);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500); open.afterEsc = await active(p);
  open.stillOpen = await p.evaluate(()=>[...document.querySelectorAll('[role=menu],[role=listbox]')].filter(e=>e.getBoundingClientRect().width>0).length);
  R['menu_'+dt] = open;
}
// 4. Tabs arrow-key behaviour on home
await go('/'); await p.focus('[data-test=home-tab-ai]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500);
R.homeTabsArrow = { active: await active(p), selected: await p.evaluate(()=>[...document.querySelectorAll('[role=tab]')].map(t=>t.innerText.trim()+':'+t.getAttribute('aria-selected')+':ti'+t.tabIndex)), panel: await p.evaluate(()=>[...document.querySelectorAll('[role=tabpanel]')].map(t=>t.getAttribute('aria-labelledby')).join(',')) };
// 5. Theme toggle state
const before = await p.getAttribute('[data-test=navbar-theme-toggle-btn]','aria-label'); await p.focus('[data-test=navbar-theme-toggle-btn]'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
R.themeToggle = { before, after: await p.getAttribute('[data-test=navbar-theme-toggle-btn]','aria-label'), pressed: await p.getAttribute('[data-test=navbar-theme-toggle-btn]','aria-pressed'), focusKept: (await active(p)).dt };
await shot('kb-dark-home'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
fs.writeFileSync(`${OUT}/kb-results.json`, JSON.stringify(R, null, 1));
await b.close();
