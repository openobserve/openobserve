import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
export const BASE = process.env.A11Y_BASE_URL || 'http://localhost:5080/web';
export const active = p => p.evaluate(() => { const e=document.activeElement; if(!e||e===document.body) return { tag:'BODY' }; const r=e.getBoundingClientRect();
  const cx=r.x+r.width/2, cy=r.y+r.height/2; const top=document.elementFromPoint(Math.min(Math.max(cx,0),innerWidth-1), Math.min(Math.max(cy,0),innerHeight-1));
  return { tag:e.tagName, role:e.getAttribute('role'), name:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('title')||e.placeholder||'').trim().replace(/\s+/g,' ').slice(0,40), dt:e.getAttribute('data-test')||'', expanded:e.getAttribute('aria-expanded'), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), inView: r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth, obscured: !!top && !(e===top||e.contains(top)||top.contains(e)) }; });
// Visible-focus check: pixel diff of the element's surroundings with and without focus.
export async function focusDiff(p, pad=6){
  const box = await p.evaluate(() => { const e=document.activeElement; if(!e||e===document.body) return null; e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; });
  if(!box || box.w<1 || box.h<1) return { measured:false };
  const vp = p.viewportSize(); const clip = { x: Math.max(0,box.x-pad), y: Math.max(0,box.y-pad) }; clip.width = Math.min(vp.width-clip.x, box.w+2*pad); clip.height = Math.min(vp.height-clip.y, box.h+2*pad);
  if (clip.width<2||clip.height<2) return { measured:false };
  const a = PNG.sync.read(await p.screenshot({ clip, animations:'disabled' }));
  await p.evaluate(() => { window.__lastFocus = document.activeElement; document.activeElement.blur(); });
  await p.waitForTimeout(120);
  const bimg = PNG.sync.read(await p.screenshot({ clip, animations:'disabled' }));
  await p.evaluate(() => window.__lastFocus?.focus({ focusVisible: true }));
  await p.waitForTimeout(80);
  const n = pixelmatch(a.data, bimg.data, null, a.width, a.height, { threshold: 0.1 });
  return { measured:true, changedPx:n, ratio: +(n/(a.width*a.height)).toFixed(3), visible: n > Math.max(20, 0.02*a.width*a.height) };
}
