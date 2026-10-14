import fs from 'node:fs';
const [A] = process.argv.slice(2);
const routes = JSON.parse(fs.readFileSync(A+'/test-results/runtime-routes.json'));
const crawl = JSON.parse(fs.readFileSync(A+'/test-results/crawl-results.json'));
const byRoute = Object.fromEntries(crawl.map(c=>[c.route,c]));
const extra = JSON.parse(fs.readFileSync(A+'/test-results/extra-coverage.json'));
const esc = s => '"' + String(s??'').replace(/"/g,'""') + '"';
const rows = [['route','route_name','auth_required','category','test_status','final_url_when_loaded','page_title','h1_count','axe_rule_violations(rule:nodes)','console_errors','key_components','states_tested','screenshot','limitations']];
const seen = new Set();
const cat = p => p.startsWith('/ingestion/')?'Ingestion docs':p.split('/')[1]||'home';
for (const r of routes) {
  const key = r.path + '|' + (r.name||''); if (seen.has(key)) continue; seen.add(key);
  if (r.path === '/' && r.children) continue;
  const c = byRoute[r.path]; const x = extra[r.path];
  let status, lim='';
  if (['/login','/logout','/cb','/slack/oauth/callback'].includes(r.path)) { status = r.path==='/login'?'Tested (public)':'Excluded'; lim = r.path==='/login'?'':'Auth callback / logout: not crawled per safety rules'; }
  else if (r.path.startsWith('/marketplace')) { status='Excluded'; lim='External marketplace onboarding flow'; }
  else if (r.redirect) { status='Redirect only'; lim='Route is a redirect alias'; }
  else if (c && !c.error) { status = c.finalUrl!==r.path ? 'Redirected - target tested' : 'Tested (automated + visual)'; if (c.finalUrl!==r.path) lim = `Direct URL redirected to ${c.finalUrl} (needs query params or not enabled in this env)`; }
  else if (c && c.error) { status='Load failed in crawl'; lim=c.error.slice(0,90); }
  else if (x) { status = x.status; lim = x.note||''; }
  else if (r.path.startsWith('/ingestion/')) { status='Not tested - template sampled'; lim='Shares integration-doc template with sampled ingestion pages; findings on sampled pages apply'; }
  else if (r.path.includes(':')) { status='Not tested'; lim='Parameterised route; needs an existing entity id'; }
  else { status='Not tested'; lim='Not in scan list'; }
  if (x && c) lim += (lim?'; ':'') + (x.note||'');
  rows.push([r.path, r.name||'', r.path==='/login'||r.path==='/ai/public/:token'?'No':'Yes', cat(r.path), status, c?.finalUrl||'', c?.title||'', c?.h1Count??'', (c?.violations||[]).map(v=>v.id+':'+v.count).join(' '), c?.consoleErrors??'', x?.components||'', x?.states||(c&&!c.error?'initial render':''), c&&!c.error?`screenshots/pages/${c.slug}.png`:'', lim]);
}
fs.writeFileSync(A+'/route-inventory.csv', rows.map(r=>r.map(esc).join(',')).join('\n'));
const counts = {}; rows.slice(1).forEach(r=>counts[r[4]]=(counts[r[4]]||0)+1); console.log(rows.length-1, JSON.stringify(counts));
