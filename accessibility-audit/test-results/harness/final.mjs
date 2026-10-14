import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { BASE, active } from './lib.mjs';
const [STATE, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const TAGS = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE });
const p = await ctx.newPage(); p.on('dialog', d => d.dismiss());
const R = {};
const go = async (path, wait=6000) => { await p.goto(BASE + path + (path.includes('?')?'&':'?') + 'org_identifier=default'); await p.waitForTimeout(wait); await p.mouse.move(1439, 899); };
const shot = (n, full=false) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });
const axe = async (include) => { const ab = new AxeBuilder({ page: p }).withTags(TAGS); if (include) ab.include(include); const r = await ab.analyze(); return r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,t:v.nodes.slice(0,3).map(n=>n.target.join(' ')),html:v.nodes.slice(0,1).map(n=>n.html.slice(0,160)),sum:v.nodes[0]?.failureSummary?.slice(0,160)})); };
const safe = async (k, fn) => { try { await fn(); } catch(e) { R[k] = { ...(R[k]||{}), error: String(e).slice(0,200) }; } };
// 1. Monaco tab-focus toggle (mac binding)
await safe('monacoToggle', async () => { await go('/logs', 9000); await p.locator('.monaco-editor textarea').first().focus(); const seq=[];
  for (const k of ['Control+Shift+m','Tab','Tab']) { await p.keyboard.press(k); await p.waitForTimeout(300); const a=await active(p); seq.push(k+' -> '+a.tag+' '+(a.name||a.dt)); } R.monacoToggle = seq;
  R.monacoHint = await p.evaluate(()=>[...document.querySelectorAll('*')].some(e=>/tab.*(focus|move)|ctrl\+m/i.test(e.childNodes.length===1?e.textContent:''))); });
// 2. Settings sub-pages via in-app nav
await safe('settings', async () => { await go('/settings/general', 7000);
  const links = await p.evaluate(()=>[...document.querySelectorAll('a[href*="/settings/"], [data-test*=settings][role=tab], [data-test*=settings-tab], nav a')].map(a=>({href:a.getAttribute('href'), dt:a.getAttribute('data-test'), txt:a.innerText.trim().slice(0,30)})).filter(l=>l.href&&l.href.includes('/settings/')));
  R.settingsLinks = links; R.settings = {};
  for (const l of links.slice(0,25)) { const sel = l.dt ? `[data-test="${l.dt}"]` : `a[href="${l.href}"]`; try { await p.click(sel, { timeout: 5000 }); await p.waitForTimeout(3500);
    const path = p.url().replace(BASE,'').replace(/\?.*/,''); const ax = await axe(); R.settings[path] = { label: l.txt, title: await p.title(), h1: await p.evaluate(()=>[...document.querySelectorAll('h1')].map(h=>h.innerText.trim().slice(0,40))), violations: ax.map(v=>v.id+':'+v.n) , detail: ax };
    await shot('settings-' + path.split('/').pop()); } catch(e) { R.settings[l.href] = { error: String(e).slice(0,100) }; } } });
// 3. Toast via copy time range
await safe('toast', async () => { await go('/logs', 8000); await ctx.grantPermissions(['clipboard-read','clipboard-write'], { origin: new URL(BASE).origin }); await p.click('[data-test=date-time-btn]'); await p.waitForTimeout(800); await p.click('[data-test=date-time-copy-btn]'); await p.waitForTimeout(600);
  R.toast = await p.evaluate(()=>[...document.querySelectorAll('[role=status],[role=alert],[aria-live]')].map(e=>`${e.tagName} role=${e.getAttribute('role')} live=${e.getAttribute('aria-live')} atomic=${e.getAttribute('aria-atomic')} :: ${e.innerText.trim().replace(/\s+/g,' ').slice(0,80)}`));
  await shot('ix-toast'); const t0=Date.now(); let gone=null; for(let i=0;i<20;i++){ await p.waitForTimeout(500); const n=await p.evaluate(()=>[...document.querySelectorAll('ol li')].filter(e=>e.getBoundingClientRect().width>0).length); if(!n){gone=Date.now()-t0;break;} } R.toastDismissMs = gone; });
// 4. Dashboard view with charts
await safe('dashboardView', async () => { await go('/dashboards', 6000); const row = p.locator('table tbody tr').first(); await row.click(); await p.waitForTimeout(9000);
  R.dashboardView = { url: p.url().replace(BASE,'').replace(/\?.*/,''), charts: await p.evaluate(()=>[...document.querySelectorAll('canvas')].filter(e=>e.getBoundingClientRect().width>100).slice(0,8).map(c=>{ const host=c.closest('[role=img],[aria-label]'); const pid=c.closest('[id]')?.id; return `canvas ${Math.round(c.getBoundingClientRect().width)}w host=${host?host.getAttribute('role')+':'+host.getAttribute('aria-label'):'none'} nearestId=${pid}`; })), dupIds: await p.evaluate(()=>{const m={}; document.querySelectorAll('[id]').forEach(e=>m[e.id]=(m[e.id]||0)+1); return Object.entries(m).filter(([k,v])=>v>1).slice(0,10);}), axe: await axe() };
  await shot('dashboard-view'); 
  const panel = p.locator('canvas').first(); if (await panel.count()) { const bb = await panel.boundingBox(); await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(700); await shot('dashboard-chart-hover'); }
  // keyboard on gridstack panels
  const seq=[]; await p.evaluate(()=>document.activeElement?.blur()); for(let i=0;i<30;i++){ await p.keyboard.press('Tab'); const a=await active(p); seq.push(a.tag+':'+(a.name||a.dt).slice(0,30)); } R.dashboardView.tab = seq; });
// 5. Detail routes via list rows
for (const [list, key] of [['/alerts','alertDetail'],['/iam/roles','roleEdit'],['/incidents','incidentDetail'],['/oncall/teams','oncallTeam'],['/slos','sloDetail'],['/synthetics','syntheticsDetail'],['/pipeline/functions','functionEdit'],['/iam/groups','groupEdit']]) {
  await safe(key, async () => { await go(list, 6000); const row = p.locator('table tbody tr, [data-test*=row]').first(); if (!(await row.count())) { R[key] = { note: 'no rows to open' }; return; }
    await row.click({ position: { x: 60, y: 10 } }); await p.waitForTimeout(6000); const ax = await axe(); R[key] = { url: p.url().replace(BASE,'').replace(/\?.*/,''), title: await p.title(), dialog: await p.evaluate(()=>!!document.querySelector('[role=dialog]')), violations: ax.map(v=>v.id+':'+v.n), detail: ax }; await shot('detail-'+key); await p.keyboard.press('Escape'); });
}
// 6. stream-explore retry
await safe('streamExplore', async () => { await go('/streams', 6000); const ex = p.locator('[data-test=log-stream-explore-btn]').first(); if (await ex.count()) { await ex.click(); await p.waitForTimeout(8000); R.streamExplore = { url: p.url().replace(BASE,'').replace(/\?.*/,''), violations: (await axe()).map(v=>v.id+':'+v.n) }; await shot('stream-explore'); } });
// 7. Reflow / zoom / text spacing on key pages
R.reflow = {};
for (const route of ['/','/logs','/alerts','/dashboards','/streams','/iam/users','/settings/general','/traces','/incidents']) {
  for (const [w,h,tag] of [[320,640,'320'],[720,450,'zoom200'],[768,1024,'tablet']]) { await safe('reflow'+route+tag, async () => { await p.setViewportSize({ width:w, height:h }); await go(route, 5000);
    const m = await p.evaluate(()=>{ const de=document.documentElement; const vw=innerWidth; const off=[...document.querySelectorAll('button,a,input,[role=button],[role=tab]')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && (r.left>=vw || r.right>vw+2);}).length; const sc=[...document.querySelectorAll('main *')].filter(e=>e.scrollWidth>e.clientWidth+4 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).length; return { docScrollW: de.scrollWidth, vw, controlsOffscreenRight: off, hScrollContainers: sc, mainWidth: Math.round(document.querySelector('main')?.getBoundingClientRect().width||0), menuBtn: !!document.querySelector('[aria-label*=avigation i]') }; });
    R.reflow[route+'@'+tag] = m; await shot(`reflow-${tag}-${route==='/'?'home':route.slice(1).replace(/\//g,'_')}`); }); }
}
await p.setViewportSize({ width:1440, height:900 });
// text spacing 1.4.12
R.textSpacing = {};
for (const route of ['/alerts','/dashboards','/settings/general']) { await safe('ts'+route, async () => { await go(route, 5000);
  const before = await p.evaluate(()=>[...document.querySelectorAll('button,span,label,a,td')].filter(e=>e.scrollHeight>e.clientHeight+2 && getComputedStyle(e).overflow==='hidden').length);
  await p.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' }); await p.waitForTimeout(600);
  const after = await p.evaluate(()=>[...document.querySelectorAll('button,span,label,a,td')].filter(e=>e.scrollHeight>e.clientHeight+2 && getComputedStyle(e).overflow==='hidden').map(e=>(e.getAttribute('data-test')||e.className.toString().slice(0,30))+':'+e.innerText.trim().slice(0,20)));
  R.textSpacing[route] = { clippedBefore: before, clippedAfter: after.length, sample: after.slice(0,6) }; await shot('textspacing-'+route.slice(1).replace(/\//g,'_')); }); }
// 8. Dark mode axe on key pages
await go('/', 5000); if ((await p.getAttribute('[data-test=navbar-theme-toggle-btn]','aria-label'))?.includes('Dark')) { await p.click('[data-test=navbar-theme-toggle-btn]'); await p.waitForTimeout(800); }
R.dark = {};
for (const route of ['/','/logs','/alerts','/dashboards','/streams','/iam/users','/settings/general','/traces','/incidents','/pipeline/pipelines','/rum/performance/overview','/ingestion/recommended/kubernetes']) { await safe('dark'+route, async () => { await go(route, 6000); const ax = await axe(); R.dark[route] = { violations: ax.map(v=>v.id+':'+v.n), contrast: ax.find(v=>v.id==='color-contrast') }; await shot('dark-'+(route==='/'?'home':route.slice(1).replace(/\//g,'_'))); }); }
// restore theme
await go('/', 4000); if ((await p.getAttribute('[data-test=navbar-theme-toggle-btn]','aria-label'))?.includes('Light')) await p.click('[data-test=navbar-theme-toggle-btn]');
await p.waitForTimeout(800);
// 9. Hoverable tooltip check on Add Folder button
await safe('tooltip2', async () => { await go('/dashboards', 5000); const btn = p.locator('[data-test=dashboard-new-folder-btn]'); const bb = await btn.boundingBox(); await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(1500);
  const tip = () => p.evaluate(()=>[...document.querySelectorAll('[role=tooltip]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect(); return {txt:e.innerText.trim().slice(0,40),x:r.x,y:r.y,w:r.width,h:r.height,id:e.id};}));
  const t = await tip(); R.tooltip2 = { onHover: t, btn: await btn.evaluate(e=>({ariaLabel:e.getAttribute('aria-label'),describedby:e.getAttribute('aria-describedby')})) }; await shot('ix-tooltip-addfolder');
  if (t[0]) { await p.mouse.move(t[0].x+t[0].w/2, t[0].y+t[0].h/2, { steps: 6 }); await p.waitForTimeout(500); R.tooltip2.afterMoveOnto = await tip(); await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(1200); await p.keyboard.press('Escape'); await p.waitForTimeout(300); R.tooltip2.afterEsc = await tip(); }
  await p.mouse.move(1439,899); await p.waitForTimeout(400); await btn.focus(); await p.waitForTimeout(1500); R.tooltip2.onFocus = await tip(); });
fs.writeFileSync(`${OUT}/final-results.json`, JSON.stringify(R, null, 1));
await b.close();
