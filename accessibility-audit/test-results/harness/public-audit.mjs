import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const BASE = process.env.A11Y_BASE_URL || 'http://localhost:5080/web';
const OUT = process.argv[2];
const TAGS = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const consoleErr = []; p.on('console', m => m.type()==='error' && consoleErr.push(m.text().slice(0,200)));
const res = {};
async function scan(key){ const r = await new AxeBuilder({ page: p }).withTags(TAGS).analyze(); res[key] = { url: p.url(), title: await p.title(), violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter(t=>t.startsWith('wcag')), nodes: v.nodes.map(n => ({ target: n.target.join(' '), html: n.html.slice(0,200), summary: n.failureSummary.slice(0,300) })) })), incomplete: r.incomplete.map(v=>({id:v.id,n:v.nodes.length})) }; await p.screenshot({ path: `${OUT}/${key}.png`, fullPage: true }); }
async function tabWalk(n){ const out=[]; await p.locator('body').click({position:{x:5,y:5}}); for(let i=0;i<n;i++){ await p.keyboard.press('Tab'); out.push(await p.evaluate(()=>{const e=document.activeElement; if(!e) return 'none'; const cs=getComputedStyle(e); return `${e.tagName}#${e.id} [${e.getAttribute('data-test')||''}] name="${(e.getAttribute('aria-label')||e.innerText||e.placeholder||'').trim().slice(0,40)}" outline=${cs.outlineStyle}/${cs.outlineWidth}/${cs.outlineColor} shadow=${cs.boxShadow.slice(0,60)}`;})); } return out; }
await p.goto(BASE + '/login'); await p.getByText('Login with SSO').waitFor();
await scan('login-sso-choice');
res['login-sso-choice'].tab = await tabWalk(4);
res['login-sso-choice'].headings = await p.evaluate(()=>[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(h=>h.tagName+':'+h.innerText.trim()));
res['login-sso-choice'].landmarks = await p.evaluate(()=>[...document.querySelectorAll('main,nav,header,footer,[role=main],[role=navigation],[role=banner]')].map(h=>h.tagName+(h.getAttribute('role')||'')));
res['login-sso-choice'].logoAlt = await p.evaluate(()=>[...document.querySelectorAll('img,svg')].map(i=>`${i.tagName} alt=${i.getAttribute('alt')} aria-hidden=${i.getAttribute('aria-hidden')} role=${i.getAttribute('role')} src=${(i.getAttribute('src')||'').slice(-40)}`));
// internal user form via keyboard
res.internalLinkKeyboard = await p.evaluate(()=>{const a=document.querySelector('[data-test=login-as-internal-user]'); return {href:a.getAttribute('href'), tabIndex:a.tabIndex, role:a.getAttribute('role')};});
await p.getByText('Login as internal user').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
res.internalFormOpenedByKeyboard = await p.locator('[data-test=login-sign-in]').count() > 0;
if(!res.internalFormOpenedByKeyboard){ await p.getByText('Login as internal user').click(); await p.waitForTimeout(1200); }
await scan('login-internal-form');
res['login-internal-form'].inputs = await p.evaluate(()=>[...document.querySelectorAll('input,button')].map(e=>{const lbl = e.labels?[...e.labels].map(l=>l.innerText.trim()).join('|'):''; return `${e.tagName} type=${e.type} id=${e.id} name=${e.name} labels=${lbl} aria-label=${e.getAttribute('aria-label')} aria-labelledby=${e.getAttribute('aria-labelledby')} ac=${e.getAttribute('autocomplete')} req=${e.required} aria-req=${e.getAttribute('aria-required')} ph=${e.placeholder} txt=${(e.innerText||'').trim()} dt=${e.getAttribute('data-test')}`}));
res['login-internal-form'].tab = await tabWalk(6);
// empty submit
const submit = p.locator('[data-test=login-sign-in]');
await submit.click(); await p.waitForTimeout(1500);
await scan('login-internal-empty-submit');
res['login-internal-empty-submit'].afterSubmit = await p.evaluate(()=>({ active: document.activeElement?.tagName+'#'+document.activeElement?.id, invalid: [...document.querySelectorAll('[aria-invalid=true]')].length, alerts: [...document.querySelectorAll('[role=alert],[aria-live]')].map(a=>a.getAttribute('role')+'/'+a.getAttribute('aria-live')+':'+a.innerText.trim().slice(0,80)), errText: [...document.querySelectorAll('[class*=error],[class*=invalid]')].map(e=>e.innerText.trim()).filter(Boolean).slice(0,5) }));
// synthetic bad credential submit (non-existent account)
const inputs = p.locator('[data-test=login-user-id] input, input[data-test=login-user-id], [data-test=login-password] input, input[data-test=login-password]');
await inputs.nth(0).fill('a11y-audit-nonexistent@example.invalid'); await inputs.nth(1).fill('not-a-real-password-1');
await p.keyboard.press('Enter'); await p.waitForTimeout(3000);
await scan('login-internal-bad-creds');
res['login-internal-bad-creds'].afterSubmit = await p.evaluate(()=>({ active: document.activeElement?.tagName+'#'+document.activeElement?.id, alerts: [...document.querySelectorAll('[role=alert],[role=status],[aria-live]')].map(a=>a.getAttribute('role')+'/'+a.getAttribute('aria-live')+':'+a.innerText.trim().slice(0,100)), url: location.pathname }));
// reflow 320 & 200% text
await p.setViewportSize({ width: 320, height: 640 }); await p.waitForTimeout(800);
res.reflow320 = await p.evaluate(()=>({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
await p.screenshot({ path: `${OUT}/login-internal-320.png`, fullPage: true });
await p.setViewportSize({ width: 1440, height: 900 });
res.viewportMeta = await p.evaluate(()=>document.querySelector('meta[name=viewport]')?.content);
// 404 page (public?)
await p.goto(BASE + '/this-route-does-not-exist-a11y'); await p.waitForTimeout(3000);
await scan('unknown-route-unauth');
res.consoleErrors = consoleErr.slice(0,20);
fs.writeFileSync(`${OUT}/public-results.json`, JSON.stringify(res, null, 1));
await b.close();
