import fs from 'node:fs';
import { F, SEV_W } from './findings.mjs';
const [A] = process.argv.slice(2);
const crawl = JSON.parse(fs.readFileSync(A + '/test-results/crawl-results.json'));
const sigs = JSON.parse(fs.readFileSync(A + '/test-results/rule-signatures.json'));
const routes = JSON.parse(fs.readFileSync(A + '/test-results/runtime-routes.json'));
const esc = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
const csv = rows => rows.map(r => r.map(esc).join(',')).join('\n') + '\n';
const ok = crawl.filter(c => !c.error);
const ALL_AUTH = ok.map(c => c.finalUrl);
const DEEP = ['/', '/logs', '/alerts', '/alerts/add', '/dashboards', '/dashboards/view', '/streams', '/login', '/iam/users', '/settings/general', '/traces', '/incidents'];
const titleCount = {}; ok.forEach(c => titleCount[c.title] = (titleCount[c.title] || 0) + 1);

// finding -> page -> instances
const hit = {}; F.forEach(f => hit[f.id] = {});
const add = (id, page, n = 1) => { hit[id][page] = (hit[id][page] || 0) + n; };
for (const s of sigs) {
  const [rule] = s.k.split(' | ');
  const o = { rule, k: s.k, ex: s.ex || '', sum: s.sum || '' };
  const f = F.find(f => f.axe && f.axe(o));
  if (!f) { console.warn('UNMAPPED', s.k); continue; }
  const per = s.n / s.pages.length;
  s.pages.forEach(pg => add(f.id, pg, Math.max(1, Math.round(per))));
}
for (const f of F) {
  for (const pg of f.pages || []) {
    if (pg === 'ALL_AUTH' || pg === 'ALL_AUTH_MOBILE') ALL_AUTH.forEach(p => add(f.id, p, 0));
    else add(f.id, pg, 1);
  }
  if (f.h1) ok.filter(c => c.h1Count !== 1).forEach(c => add(f.id, c.finalUrl, 1));
  if (f.titles) ok.filter(c => titleCount[c.title] > 2 && c.finalUrl === c.route).forEach(c => add(f.id, c.finalUrl, 1));
}
const pagesOf = id => Object.keys(hit[id]).sort();
const instOf = id => Object.values(hit[id]).reduce((a, b) => a + Math.max(1, b), 0);

// findings.csv
const fr = [['finding_id', 'title', 'severity', 'priority', 'wcag_criteria', 'level', 'affected_route_count', 'affected_instances', 'affected_routes', 'component_source', 'selector', 'evidence', 'repro_steps', 'expected', 'actual', 'user_impact', 'root_cause', 'recommended_fix', 'example_code', 'retest', 'verification_status', 'confidence', 'scope_note']];
for (const f of F) fr.push([f.id, f.title, f.severity, f.priority, f.wcag, f.level, pagesOf(f.id).length, instOf(f.id), pagesOf(f.id).join(' '), f.component, f.selector, f.evidence, f.repro, f.expected, f.actual, f.impact, f.cause, f.fix, f.code, f.retest, f.status, f.confidence, f.scope || '']);
fs.writeFileSync(A + '/findings.csv', csv(fr));
fs.writeFileSync(A + '/test-results/findings.json', JSON.stringify(F.map(f => ({ ...f, axe: undefined, affected_routes: pagesOf(f.id), instances: instOf(f.id) })), null, 1));

// per-page aggregation
const SC_AUTO = ['1.1.1', '1.3.1', '1.3.5', '1.4.3', '1.4.4', '2.1.1', '2.2.1', '2.4.1', '2.4.2', '2.4.4', '2.4.6', '2.5.8', '3.1.1', '4.1.2'];
const SC_DEEP = ['2.1.2', '2.4.3', '2.4.7', '2.4.11', '1.4.10', '1.4.12', '3.3.1', '3.3.2', '4.1.3', '3.2.1', '3.2.2', '3.2.3', '3.2.4', '1.4.11'];
const DENOM = 55;
const pageRows = [];
const allPages = [...new Set([...ok.map(c => c.finalUrl), '/login', '/dashboards/view'])];
for (const pg of allPages) {
  const fs_ = F.filter(f => hit[f.id][pg] !== undefined);
  const dist = { Critical: 0, High: 0, Medium: 0, Low: 0 }; fs_.forEach(f => dist[f.severity]++);
  const inst = fs_.reduce((a, f) => a + Math.max(1, hit[f.id][pg]), 0);
  const score = fs_.reduce((a, f) => a + SEV_W[f.severity], 0);
  const assessed = SC_AUTO.length + (DEEP.includes(pg) ? SC_DEEP.length : 0);
  const shared = fs_.filter(f => /lib\/|layouts|OTable|OButton|OSelect|OInput|theme|Header|OToast|ODropdown/.test(f.component)).length;
  const c = ok.find(x => x.finalUrl === pg);
  pageRows.push({ pg, fs: fs_, dist, inst, score, assessed, shared, c, deep: DEEP.includes(pg) });
}
pageRows.sort((a, b) => b.score - a.score || a.pg.localeCompare(b.pg));

// route-inventory.csv
const extra = {
  '/login': { status: 'Tested (public, keyboard, forms)', states: 'SSO choice; internal form; empty submit; invalid credentials; 320px', components: 'SSO button, internal-login link, email/password form, toast' },
  '/dashboards/view': { status: 'Tested via in-app navigation', states: 'Dashboard with 5 chart panels; keyboard tab order; chart hover', components: 'gridstack panels, ECharts canvas, toolbar, date picker' },
  '/streams/stream-explore': { status: 'Tested via in-app navigation (redirects to /logs)', states: 'Explore button -> logs', components: 'logs search' },
};
const crawlBy = Object.fromEntries(crawl.map(c => [c.route, c]));
const pageBy = Object.fromEntries(pageRows.map(r => [r.pg, r]));
const ir = [['route', 'route_name', 'auth_required', 'area', 'test_status', 'loaded_as', 'page_title', 'h1_count', 'confirmed_findings', 'axe_violations(rule:nodes)', 'console_errors', 'states_tested', 'screenshot', 'limitations']];
const seen = new Set();
for (const r of routes) {
  const key = r.path + '|' + (r.name || ''); if (seen.has(key)) continue; seen.add(key);
  if (r.path === '/' && r.children) continue;
  const c = crawlBy[r.path]; const x = extra[r.path];
  let status, lim = '', states = '';
  if (['/logout', '/cb', '/slack/oauth/callback'].includes(r.path)) { status = 'Excluded'; lim = 'Logout / OAuth callback - not crawled (safety)'; }
  else if (r.path.startsWith('/marketplace')) { status = 'Excluded'; lim = 'External marketplace onboarding flow'; }
  else if (x) { status = x.status; states = x.states; }
  else if (r.redirect) { status = 'Redirect alias'; lim = 'Route only redirects'; }
  else if (c && !c.error && c.finalUrl !== r.path) { status = 'Redirected - target tested'; lim = `Direct URL redirected to ${c.finalUrl}` + (r.path.startsWith('/settings/') ? ' (not in this org\'s Settings menu; likely _meta-org only)' : ' (needs query params / entity)'); states = 'redirect target initial render'; }
  else if (c && !c.error) { status = DEEP.includes(r.path) ? 'Tested (automated + keyboard + states)' : 'Tested (automated + structure + screenshot)'; states = DEEP.includes(r.path) ? 'initial render; keyboard walk; interactive states (see page report)' : 'initial render'; }
  else if (c && c.error) { status = 'Load failed in crawl'; lim = c.error.slice(0, 100); }
  else if (r.path.startsWith('/ingestion/')) { status = 'Not tested - template sampled'; lim = 'Same integration-guide template as the 16 sampled ingestion pages; findings A11Y-05/07/21 expected to apply'; }
  else if (r.path.includes(':')) { status = 'Not tested'; lim = 'Parameterised route; no entity available/opened in this environment'; }
  else { status = 'Not tested'; lim = 'Parent/shell route'; }
  const pr = c && pageBy[c.finalUrl];
  ir.push([r.path, r.name || '', ['/login', '/ai/public/:token'].includes(r.path) ? 'No' : 'Yes', r.path.split('/')[1] || 'home', status, c?.finalUrl || '', c?.title || '', c?.h1Count ?? '', pr ? pr.fs.map(f => f.id).join(' ') : '', (c?.violations || []).map(v => v.id + ':' + v.count).join(' '), c?.consoleErrors ?? '', states, c && !c.error ? `screenshots/pages/${c.slug}.png` : '', lim]);
}
fs.writeFileSync(A + '/route-inventory.csv', csv(ir));
const stc = {}; ir.slice(1).forEach(r => stc[r[4]] = (stc[r[4]] || 0) + 1);

// page-audit-report.md
const fById = Object.fromEntries(F.map(f => [f.id, f]));
let md = `# Page-by-page accessibility audit\n\nEnvironment: <dev-env> (enterprise build v1.1.0-rc2), org \`default\`, theme **O2 Signature (light)** unless stated, Chromium 140 headless, 1440x900.\nScan date: 2026-10-14. Axe-core 4.10 with tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa.\n\n`;
md += `## How to read this report\n\n- **Findings** are deduplicated root causes (IDs \`A11Y-NN\`, defined in \`findings.csv\`). A page lists every root cause that affects it.\n- **Instances** = affected DOM nodes reported by axe on that page (manual findings count 1).\n- **Risk score** (prioritisation aid only, not a WCAG conformance score) = sum of severity weights of the findings on the page: Critical 10, High 5, Medium 2, Low 1.\n- **Criteria assessed** uses a denominator of **${DENOM}** = all WCAG 2.2 Level A + AA success criteria, excluding obsolete 4.1.1. Every crawled page got ${SC_AUTO.length} criteria assessed (axe-mapped criteria + headings/title/bypass checks): ${SC_AUTO.join(', ')}. Deep-tested pages also got ${SC_DEEP.length} manual criteria: ${SC_DEEP.join(', ')}.\n- Zero axe violations never means a page passes WCAG.\n\n`;
md += `## Priority overview (all pages, highest risk first)\n\n| Route | Risk | Findings | Instances | C/H/M/L | Criteria assessed | Not assessed | Shared-component findings | Next action |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const r of pageRows) md += `| \`${r.pg}\` | ${r.score} | ${r.fs.length} | ${r.inst} | ${r.dist.Critical}/${r.dist.High}/${r.dist.Medium}/${r.dist.Low} | ${r.assessed}/${DENOM} (${Math.round(100 * r.assessed / DENOM)}%) | ${DENOM - r.assessed} | ${r.shared}/${r.fs.length} | ${r.fs.some(f => f.severity === 'Critical') ? 'Fix P0 items first' : r.shared === r.fs.length ? 'Resolved mostly by shared-component fixes' : 'Shared fixes + page-specific items'} |\n`;
md += `\n## Deep-tested pages\n\n`;
const notes = {
  '/login': 'Public page. Keyboard walk, internal-user form, empty submit (inline `role=alert` errors + `aria-invalid`: good), invalid credentials (error announced but duplicated, A11Y-13), 320px reflow (no horizontal scroll: pass). Screenshots: `screenshots/states/public-login-*.png`.',
  '/': 'Header menus (org selector, Help, profile): open on Enter, arrow keys move, Escape closes and returns focus - pass. Sidebar: roving tabindex with arrow keys, ArrowRight opens flyout menus with menu/menuitem roles - pass. Theme toggle updates its label - pass. Home tabs: arrow keys move focus (manual activation) but no tabpanel (A11Y-27). Composer autofocus/unnamed (A11Y-15). Overview tab charts (A11Y-10). Screenshots: `screenshots/pages/home.png`, `screenshots/states/kb-*.png`, `reflow-*-home.png`, `dark-home.png`.',
  '/logs': 'Monaco trap (A11Y-02); toolbar icon buttons unnamed (A11Y-05); histogram switch nested in button (A11Y-24); date-time picker (A11Y-17); toast duplication (A11Y-13). Focus ring visible on all toolbar buttons except the editor. Screenshots: `screenshots/states/ix-logs-*.png`, `ix-toast.png`.',
  '/alerts/add': 'All 14 sampled controls lack programmatic labels (A11Y-01). Empty Save: field errors are `role=alert`, focus moves to the first invalid field (Alert name) - good; summary toast duplicated (A11Y-13) and overlaps the Save button area. Screenshots: `ix-alert-add.png`, `ix-alert-add-empty-save.png`.',
  '/dashboards': 'New dashboard / Add Folder dialogs: role=dialog, labelled by title, focus moves in, Tab trapped, Escape closes, focus returns to trigger - pass. Empty submit loses focus to body (A11Y-14). Sortable headers expose aria-sort and toggle via Enter - pass. Table has no caption/accessible name (minor, part of A11Y-04 remediation).',
  '/dashboards/view': 'Five chart panels, canvas only, duplicate id "chart1" (A11Y-10); 17 unnamed toolbar/panel buttons (A11Y-05); a focusable bare <svg> in tab order. Screenshot: `screenshots/states/dashboard-view.png`.',
  '/streams': 'New stream dialog passes dialog checks (stream-type combobox unnamed, A11Y-01). Row checkboxes unnamed (A11Y-09). Pagination unnamed (A11Y-04). Sort: aria-sort ascending/descending updates - pass.',
  '/settings/general': 'Text-spacing override: no clipping - pass. Dark mode: 2 contrast + 1 label issues. Several Settings sub-routes are not available in this org (see limitations).',
  '/iam/users': 'Reflow 320/720/768: no page-level horizontal scroll; table scrolls in its own container (allowed). "Add user" trigger is `add-basic-user` - dialog not opened (avoid creating users).',
  '/traces': 'Reflow checks pass at page level; sidebar Traces flyout reachable by ArrowRight. Search-mode buttons focusable with visible ring.',
  '/incidents': 'Empty state only (no incidents in env) - detail route not tested.',
  '/alerts': 'Tab order: header -> IaC links -> Import -> New alert -> tabs -> folders -> search -> table: logical. Summary chips focusable with visible ring (low pixel change 3.7%, borderline - verify visually).',
};
for (const pg of DEEP) {
  const r = pageRows.find(x => x.pg === pg); if (!r) continue;
  md += `### \`${pg}\`${r.c ? ` - ${r.c.title}` : ''}\n\n${notes[pg] || ''}\n\n**Improvements required:**\n`;
  for (const f of r.fs.sort((a, b) => SEV_W[b.severity] - SEV_W[a.severity])) md += `- **${f.id}** (${f.severity}/${f.priority}, ${f.wcag.split(';')[0]}) ${f.title}${hit[f.id][pg] > 1 ? ` - ${hit[f.id][pg]} instances` : ''}\n`;
  md += r.c ? `\nEvidence: \`screenshots/pages/${r.c.slug}.png\`, \`test-results/axe-per-route/${r.c.slug}.json\`\n\n` : '\n';
}
md += `## All other crawled pages (automated + structure)\n\nEach entry lists page-specific improvements. Unless noted, these pages also inherit the shell-wide items A11Y-11 (no skip link) and A11Y-26 (tooltip behaviour, suspected).\n\n`;
const areas = {};
for (const r of pageRows) { if (DEEP.includes(r.pg)) continue; const a = r.pg.split('/')[1] || 'home'; (areas[a] ||= []).push(r); }
for (const [a, rows] of Object.entries(areas).sort()) {
  md += `### ${a}\n\n| Route | Title | h1 | Improvements (finding: instances) | Screenshot |\n|---|---|---|---|---|\n`;
  for (const r of rows) md += `| \`${r.pg}\` | ${r.c?.title || ''} | ${r.c?.h1Count ?? ''} | ${r.fs.filter(f => !['A11Y-11', 'A11Y-26', 'A11Y-16'].includes(f.id)).map(f => `${f.id}${hit[f.id][r.pg] > 1 ? ':' + hit[f.id][r.pg] : ''}`).join(', ')} | [png](screenshots/pages/${r.c?.slug}.png) |\n`;
  md += '\n';
}
md += `## Finding legend\n\n| ID | Severity | Priority | Title |\n|---|---|---|---|\n` + F.map(f => `| ${f.id} | ${f.severity} | ${f.priority} | ${f.title} |`).join('\n') + '\n';
fs.writeFileSync(A + '/page-audit-report.md', md);
fs.writeFileSync(A + '/test-results/page-scores.json', JSON.stringify(pageRows.map(r => ({ route: r.pg, score: r.score, findings: r.fs.map(f => f.id), instances: r.inst, dist: r.dist, assessed: r.assessed, denominator: DENOM })), null, 1));
console.log('findings', F.length, 'pages', pageRows.length, 'inventory rows', ir.length - 1, JSON.stringify(stc));
console.log('sev', JSON.stringify(F.reduce((m, f) => (m[f.severity] = (m[f.severity] || 0) + 1, m), {})), 'prio', JSON.stringify(F.reduce((m, f) => (m[f.priority] = (m[f.priority] || 0) + 1, m), {})));
F.forEach(f => console.log(f.id, f.severity, pagesOf(f.id).length + ' routes', instOf(f.id) + ' inst'));
console.log('top pages', pageRows.slice(0, 12).map(r => r.pg + '=' + r.score).join(', '));
