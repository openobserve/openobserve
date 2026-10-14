import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { BASE, active } from './lib.mjs';
const [STATE, OUT] = process.argv.slice(2);
const TAGS = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE });
const p = await ctx.newPage(); p.on('dialog', d => d.dismiss());
const R = {};
const go = async (path, wait=6000) => { await p.goto(BASE + path + (path.includes('?')?'&':'?') + 'org_identifier=default'); await p.waitForTimeout(wait); await p.mouse.move(1439, 899); };
const shot = n => p.screenshot({ path: `${OUT}/${n}.png` });
const axe = async (include) => { const ab = new AxeBuilder({ page: p }).withTags(TAGS); if (include) ab.include(include); const r = await ab.analyze(); return r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,t:v.nodes.slice(0,4).map(n=>n.target.join(' ')),html:v.nodes.slice(0,2).map(n=>n.html.slice(0,160))})); };
const dialogInfo = () => p.evaluate(() => { const d=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(e=>e.getBoundingClientRect().width>0).pop(); if(!d) return null; const lb=d.getAttribute('aria-labelledby'); const db=d.getAttribute('aria-describedby');
  return { role:d.getAttribute('role'), modal:d.getAttribute('aria-modal'), label:d.getAttribute('aria-label'), labelledby: lb && document.getElementById(lb)?.innerText.trim().slice(0,60), describedby: db && document.getElementById(db)?.innerText.trim().slice(0,80), focusInside: d.contains(document.activeElement) }; });
const safe = async (k, fn) => { try { await fn(); } catch(e) { R[k] = { ...(R[k]||{}), error: String(e).slice(0,200) }; } };

// A. Monaco keyboard trap on logs
await safe('monaco', async () => { await go('/logs', 9000);
  const ed = p.locator('.monaco-editor textarea').first(); await ed.focus();
  const seq=[]; for (const k of ['Tab','Tab','Shift+Tab','Escape','Tab','Control+m','Tab','Tab']) { await p.keyboard.press(k); await p.waitForTimeout(250); const a=await active(p); seq.push(k+' -> '+a.tag+' '+a.name+' '+a.dt); }
  R.monaco = { seq, ariaLabel: await ed.getAttribute('aria-label'), roledesc: await ed.getAttribute('aria-roledescription') };
  await shot('ix-logs-editor-focus'); });
// B. Date-time picker
await safe('datepicker', async () => { await go('/logs', 8000); await p.focus('[data-test=date-time-btn]'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  R.datepicker = { afterEnter: await active(p), dialog: await dialogInfo(), popovers: await p.evaluate(()=>[...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox],[data-reka-popper-content-wrapper]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>(e.getAttribute('role')||'wrap')+':'+e.innerText.trim().replace(/\s+/g,' ').slice(0,80))) };
  await shot('ix-logs-datepicker-open'); R.datepicker.axe = await axe();
  const seq=[]; for (let i=0;i<6;i++){ await p.keyboard.press('Tab'); const a=await active(p); seq.push(a.tag+' '+a.role+' '+a.name+' '+a.dt); } R.datepicker.tabs=seq;
  await p.keyboard.press('Escape'); await p.waitForTimeout(500); R.datepicker.afterEsc = await active(p); });
// C. Share link toast (copies URL; harmless)
await safe('toast', async () => { await go('/logs', 8000); await ctx.grantPermissions(['clipboard-read','clipboard-write']); await p.click('[data-test=logs-search-bar-share-link-btn]'); await p.waitForTimeout(700);
  R.toast = await p.evaluate(()=>[...document.querySelectorAll('[role=status],[role=alert],[aria-live],[role=region] li, ol li')].filter(e=>e.innerText.trim()).map(e=>`${e.tagName} role=${e.getAttribute('role')} live=${e.getAttribute('aria-live')} :: ${e.innerText.trim().replace(/\s+/g,' ').slice(0,80)}`));
  await shot('ix-toast'); R.toastAxe = await axe('ol'); await p.waitForTimeout(6000); R.toastStillVisibleAfter6s = await p.evaluate(()=>[...document.querySelectorAll('ol li')].filter(e=>e.getBoundingClientRect().width>0).length); });
// D. Dialogs: new dashboard, add folder, new stream, manage columns
for (const [route, trig, key] of [['/dashboards','dashboard-new','dlg_newDashboard'],['/dashboards','dashboard-new-folder-btn','dlg_newFolder'],['/streams','log-stream-add-stream-btn','dlg_newStream'],['/dashboards','o2-table-column-toggle-btn','pop_manageColumns'],['/iam/users','iam-users-add-user-btn','dlg_addUser']]) {
  await safe(key, async () => { await go(route); const t = p.locator(`[data-test="${trig}"]`).first(); if (!(await t.count())) { R[key]={ missingTrigger: trig, buttons: await p.evaluate(()=>[...document.querySelectorAll('button[data-test]')].map(b=>b.getAttribute('data-test')).filter(x=>/add|new|create/i.test(x)).slice(0,10)) }; return; }
    await t.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
    const r = { dialog: await dialogInfo(), initialFocus: await active(p) }; await shot('ix-'+key);
    r.axe = await axe('[role=dialog]');
    const seen=[]; for (let i=0;i<25;i++){ await p.keyboard.press('Tab'); const a=await active(p); seen.push(a.tag+':'+(a.name||a.dt).slice(0,25)); }
    r.tabCycle = seen; r.focusStillInDialog = (await dialogInfo())?.focusInside;
    // submit empty to see validation, only in create dialogs (validation blocks creation since required name is empty)
    if (key.startsWith('dlg_')) { const sv = p.locator('[role=dialog] button[type=submit], [role=dialog] [data-test$=save-btn], [role=dialog] [data-test$=submit-btn], [role=dialog] button:has-text("Save"), [role=dialog] button:has-text("Create")').first();
      if (await sv.count()) { const filled = await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] input:not([type=checkbox]):not([type=hidden])')].map(i=>i.value).filter(Boolean).length);
        if (filled===0) { await sv.click(); await p.waitForTimeout(900); r.afterEmptySubmit = { active: await active(p), invalid: await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] [aria-invalid=true]')].map(e=>e.tagName+' desc='+(e.getAttribute('aria-describedby')||''))), errors: await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] [role=alert], [role=dialog] [class*=error]')].map(e=>e.getAttribute('role')+':'+e.innerText.trim().slice(0,60)).filter(x=>x.length>5).slice(0,6)), dialogOpen: !!(await dialogInfo()) }; await shot('ix-'+key+'-empty-submit'); }
        else r.afterEmptySubmit = 'skipped: dialog prefilled'; } }
    await p.keyboard.press('Escape'); await p.waitForTimeout(700); r.afterEsc = { active: await active(p), dialogOpen: !!(await dialogInfo()) };
    R[key] = r; });
}
// E. Alert add form validation (full page)
await safe('alertAdd', async () => { await go('/alerts/add', 8000); await shot('ix-alert-add');
  R.alertAdd = { axe: await axe(), labels: await p.evaluate(()=>[...document.querySelectorAll('input,textarea,[role=combobox]')].filter(e=>e.getBoundingClientRect().width>0).slice(0,15).map(e=>{ const l=e.labels?[...e.labels].map(x=>x.innerText.trim()).join('|'):''; return `${e.tagName} role=${e.getAttribute('role')} label="${l}" aria-label=${e.getAttribute('aria-label')} lb=${e.getAttribute('aria-labelledby')} ph=${e.placeholder||''} dt=${e.getAttribute('data-test')||''}`; })) };
  const save = p.locator('[data-test=add-alert-submit-btn], button:has-text("Save")').first();
  if (await save.count()) { await save.click(); await p.waitForTimeout(1500); R.alertAdd.afterSave = { url: p.url().replace(BASE,'').replace(/\?.*/,''), active: await active(p), invalid: await p.evaluate(()=>document.querySelectorAll('[aria-invalid=true]').length), messages: await p.evaluate(()=>[...document.querySelectorAll('[role=alert],[role=status],ol li')].map(e=>e.getAttribute('role')+':'+e.innerText.trim().replace(/\s+/g,' ').slice(0,80)).filter(x=>x.length>6).slice(0,8)) }; await shot('ix-alert-add-empty-save'); } });
// F. Table sort state
await safe('tableSort', async () => { await go('/streams'); const th = p.locator('[data-test=o2-table-th-sort-trigger]').first(); const before = await p.evaluate(()=>[...document.querySelectorAll('th')].slice(0,6).map(t=>t.innerText.trim()+':'+t.getAttribute('aria-sort'))); await th.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  R.tableSort = { before, after: await p.evaluate(()=>[...document.querySelectorAll('th')].slice(0,6).map(t=>t.innerText.trim()+':'+t.getAttribute('aria-sort'))), caption: await p.evaluate(()=>[...document.querySelectorAll('table')].map(t=>`caption=${!!t.caption} aria-label=${t.getAttribute('aria-label')} lb=${t.getAttribute('aria-labelledby')}`)), pagination: await p.evaluate(()=>[...document.querySelectorAll('[class*=pagination] button, nav button')].slice(0,10).map(b=>`${b.getAttribute('aria-label')||b.innerText.trim()}|cur=${b.getAttribute('aria-current')}`)) }; });
// G. Tooltip 1.4.13: hover icon-only button, move onto tooltip, escape
await safe('tooltip', async () => { await go('/logs', 8000); const btn = p.locator('[data-test=logs-search-bar-histogram-btn]'); const bb = await btn.boundingBox(); await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(1200);
  const tip = async () => p.evaluate(()=>[...document.querySelectorAll('[role=tooltip],[data-reka-popper-content-wrapper]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect(); return {txt:e.innerText.trim().slice(0,60), x:r.x,y:r.y,w:r.width,h:r.height};}));
  const t1 = await tip(); R.tooltip = { onHover: t1, btnName: await btn.evaluate(e=>({ariaLabel:e.getAttribute('aria-label'), describedby:e.getAttribute('aria-describedby'), labelledby:e.getAttribute('aria-labelledby'), title:e.getAttribute('title')})) };
  await shot('ix-tooltip-hover');
  if (t1[0]) { await p.mouse.move(t1[0].x+t1[0].w/2, t1[0].y+t1[0].h/2, { steps: 5 }); await p.waitForTimeout(600); R.tooltip.afterMoveOnto = await tip(); await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(900); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); R.tooltip.afterEscape = await tip();
  await p.mouse.move(1439,899); await btn.focus(); await p.waitForTimeout(1000); R.tooltip.onKeyboardFocus = await tip(); });
// H. Charts on a dashboard / home overview
await safe('charts', async () => { await go('/'); await p.click('[data-test=home-tab-overview]'); await p.waitForTimeout(5000); await shot('ix-home-overview');
  R.charts = await p.evaluate(()=>[...document.querySelectorAll('canvas, svg[width][height]')].filter(e=>e.getBoundingClientRect().width>120).slice(0,6).map(c=>{ const host=c.closest('[role=img],[aria-label]'); return `${c.tagName} ${Math.round(c.getBoundingClientRect().width)}w role=${c.getAttribute('role')} host=${host?host.getAttribute('role')+':'+host.getAttribute('aria-label'):'none'} parentId=${c.parentElement?.parentElement?.id}`; }));
  R.chartsAxe = await axe(); });
fs.writeFileSync(`${OUT}/interact-results.json`, JSON.stringify(R, null, 1));
await b.close();
