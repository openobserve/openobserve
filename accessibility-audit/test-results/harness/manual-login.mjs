import { chromium } from 'playwright';
const BASE = process.env.A11Y_BASE_URL || 'http://localhost:5080/web';
const b = await chromium.launch({ headless: false });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto(BASE + '/login');
const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  await p.waitForTimeout(2000);
  const u = p.url();
  if (!/\/(login|cb)(\?|$|\/)/.test(u) && u.startsWith(BASE)) {
    await p.waitForTimeout(6000);
    await ctx.storageState({ path: process.argv[2] });
    console.log('SAVED session; landed on', p.url().split('?')[0]);
    break;
  }
}
await b.close();
