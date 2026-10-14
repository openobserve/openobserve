import { chromium } from 'playwright';
const BASE = process.env.A11Y_BASE_URL || 'http://localhost:5080/web';
const [STATE] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: STATE });
const p = await ctx.newPage();
await p.goto(BASE + '/?org_identifier=default'); await p.waitForTimeout(7000);
const d = await p.evaluate(() => {
  const desc = e => { const r=e.getBoundingClientRect(); return `<${e.tagName.toLowerCase()} role=${e.getAttribute('role')} aria-label="${e.getAttribute('aria-label')||''}" aria-expanded=${e.getAttribute('aria-expanded')} aria-haspopup=${e.getAttribute('aria-haspopup')} aria-current=${e.getAttribute('aria-current')} aria-selected=${e.getAttribute('aria-selected')} title="${e.getAttribute('title')||''}" tabindex=${e.getAttribute('tabindex')} dt=${e.getAttribute('data-test')||''} txt="${(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,30)}" ${Math.round(r.width)}x${Math.round(r.height)}>`; };
  const hdr = document.querySelector('header, .q-header, [class*=header]');
  return {
    headerTag: hdr?.tagName + ' ' + hdr?.className.slice(0,60),
    headerCtrls: [...document.querySelectorAll('button,[role=button],a,[tabindex]')].filter(e=>{const r=e.getBoundingClientRect();return r.top<40&&r.width>0}).map(desc),
    sidebar: [...document.querySelectorAll('[data-test^=menu-link]')].slice(0,6).map(e=>desc(e)+' parent='+e.parentElement.tagName+'/'+e.parentElement.getAttribute('role')),
    sidebarContainer: (()=>{const a=document.querySelector('[data-test^=menu-link]'); let n=a; const chain=[]; for(let i=0;i<6&&n;i++){chain.push(n.tagName+(n.getAttribute('role')?'['+n.getAttribute('role')+']':'')); n=n.parentElement;} return chain.join('<');})(),
    tabs: [...document.querySelectorAll('[role=tab],[role=tablist]')].map(desc),
    tabCandidates: [...document.querySelectorAll('*')].filter(e=>/^(O2 Assistant|Overview|Usage)$/.test(e.innerText?.trim()) && e.children.length<3).map(desc).slice(0,6),
    main: [...document.querySelectorAll('main,[role=main]')].map(e=>e.className.slice(0,60)),
    skipLink: [...document.querySelectorAll('a')].filter(a=>/skip/i.test(a.innerText)).length,
    chatInput: [...document.querySelectorAll('textarea,[contenteditable=true],input')].map(e=>`${e.tagName} aria-label=${e.getAttribute('aria-label')} labels=${e.labels?.length} ph=${e.placeholder||e.getAttribute('data-placeholder')}`).slice(0,6),
  };
});
console.log(JSON.stringify(d, null, 1));
// first 25 tab stops
await p.mouse.move(1430, 890);
await p.keyboard.press('Tab');
for (let i=0;i<25;i++){ const s = await p.evaluate(()=>{const e=document.activeElement; const r=e.getBoundingClientRect(); return `${e.tagName} role=${e.getAttribute('role')} name="${(e.getAttribute('aria-label')||e.innerText||e.getAttribute('title')||e.placeholder||'').trim().replace(/\s+/g,' ').slice(0,35)}" dt=${e.getAttribute('data-test')||''} @${Math.round(r.x)},${Math.round(r.y)}`}); console.log('TAB', i+1, s); await p.keyboard.press('Tab'); }
// hover Traces sidebar
await p.hover('[data-test="menu-link-/traces-item"]'); await p.waitForTimeout(800);
await p.screenshot({ path: process.argv[3] + '/sidebar-hover-traces.png', clip: {x:0,y:0,width:500,height:400} });
console.log('after hover flyout:', await p.evaluate(()=>[...document.querySelectorAll('[role=menu],[role=menuitem],.q-menu,[class*=flyout],[class*=submenu],[class*=popover]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.tagName+'['+e.getAttribute('role')+'] '+e.className.slice(0,50)+' :: '+e.innerText.trim().replace(/\s+/g,' ').slice(0,80))));
await b.close();
