import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const BASE = process.env.A11Y_BASE_URL || 'http://localhost:5080/web';
const [STATE, LIST, OUT, WORKERS='3', THEME='light'] = process.argv.slice(2);
const TAGS = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
const list = JSON.parse(fs.readFileSync(LIST));
fs.mkdirSync(OUT + '/shots', { recursive: true }); fs.mkdirSync(OUT + '/axe', { recursive: true });
const b = await chromium.launch();
const slug = r => (r === '/' ? 'home' : r.replace(/^\//,'').replace(/[\/]/g,'__')) + (THEME==='dark'?'--dark':'');
const results = [];
async function waitSettled(p){
  const t0 = Date.now(); let quiet = 0;
  while (Date.now()-t0 < 15000) {
    const busy = await p.evaluate(() => { const sel='[role=progressbar],.q-spinner,.q-loading,[class*=spinner],[class*=skeleton],[class*=Skeleton],.loading,[aria-busy=true]'; return [...document.querySelectorAll(sel)].some(e => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'; }); }).catch(()=>true);
    quiet = busy ? 0 : quiet+1; if (quiet >= 3) break; await p.waitForTimeout(500);
  }
  await p.waitForTimeout(800); return Date.now()-t0;
}
async function one(ctx, route){
  const p = await ctx.newPage(); const errs=[]; const failed=[];
  p.on('console', m => m.type()==='error' && errs.push(m.text().slice(0,160)));
  p.on('response', r => { if (r.status()>=400 && r.url().startsWith(new URL(BASE).origin)) failed.push(r.status()+' '+r.url().replace(/^https?:\/\/[^/]+/,'').replace(/\?.*/,'').slice(0,100)); });
  p.on('dialog', d => d.dismiss());
  const rec = { route, slug: slug(route) };
  try {
    await p.goto(BASE + route + (route.includes('?')?'&':'?') + 'org_identifier=default', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForSelector('#app *', { timeout: 20000 });
    rec.settleMs = await waitSettled(p);
    rec.finalUrl = p.url().replace(BASE,'').replace(/\?.*/,'');
    Object.assign(rec, await p.evaluate(() => {
      const vis = e => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0; };
      const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(vis).map(h => (h.getAttribute('aria-level')?'h'+h.getAttribute('aria-level'):h.tagName.toLowerCase())+':'+h.innerText.trim().replace(/\s+/g,' ').slice(0,50));
      return { title: document.title, lang: document.documentElement.lang, headings: hs.slice(0,25), h1Count: hs.filter(h=>h.startsWith('h1')).length,
        landmarks: { main: document.querySelectorAll('main,[role=main]').length, nav: document.querySelectorAll('nav,[role=navigation]').length, header: document.querySelectorAll('header,[role=banner]').length },
        mainText: (document.querySelector('main,[role=main]')||document.body).innerText.trim().replace(/\s+/g,' ').slice(0,160) };
    }));
    const ax = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
    rec.violations = ax.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, wcag: v.tags.filter(t=>/^wcag\d{3,}/.test(t)), count: v.nodes.length, targets: v.nodes.slice(0,8).map(n=>n.target.join(' ')), html: v.nodes.slice(0,3).map(n=>n.html.slice(0,180)), summary: v.nodes[0]?.failureSummary?.slice(0,250) }));
    rec.incomplete = ax.incomplete.map(v=>({id:v.id,count:v.nodes.length}));
    fs.writeFileSync(`${OUT}/axe/${rec.slug}.json`, JSON.stringify({ url: rec.finalUrl, violations: ax.violations, incomplete: ax.incomplete.map(i=>({id:i.id,nodes:i.nodes.length})) }));
    await p.screenshot({ path: `${OUT}/shots/${rec.slug}.png` });
  } catch (e) { rec.error = String(e).slice(0,200); }
  rec.consoleErrors = errs.length; rec.consoleSample = [...new Set(errs)].slice(0,3); rec.failedReq = [...new Set(failed)].slice(0,6);
  await p.close(); return rec;
}
const queue = [...list]; let done = 0;
async function worker(){
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE, colorScheme: THEME });
  if (THEME==='dark') await ctx.addInitScript(() => { try { localStorage.setItem('theme','dark'); } catch {} });
  while (queue.length) { const r = queue.shift(); const rec = await one(ctx, r); results.push(rec); done++;
    console.log(`[${done}/${list.length}] ${r} -> ${rec.finalUrl||'ERR'} v=${(rec.violations||[]).map(v=>v.id+':'+v.count).join(',')} ${rec.error||''}`); }
  await ctx.close();
}
await Promise.all(Array.from({length: +WORKERS}, worker));
fs.writeFileSync(`${OUT}/crawl-results.json`, JSON.stringify(results, null, 1));
await b.close();
