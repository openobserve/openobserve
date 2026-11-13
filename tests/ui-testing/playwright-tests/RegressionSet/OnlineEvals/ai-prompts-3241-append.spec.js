// ENT#3241: Playground > Save as Prompt > append to an existing prompt saves a new version instead of failing with 400.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { PromptPlaygroundPage } = require('../../../pages/onlineEvalsPages/promptPlaygroundPage.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';

async function findPrompt(name) {
  const res = await fetch(`${BASE}/api/${ORG()}/prompts`, { headers: getAuthHeaders() });
  const body = await res.json().catch(() => ({}));
  return (body.list || body.prompts || body || []).find?.((p) => p.name === name) || null;
}

test.describe('Save as Prompt appends a version (ENT#3241)', { tag: ['@aiObservability', '@regression', '@P1', '@enterprise'] }, () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const cfg = await (await fetch(`${BASE}/api/${ORG()}/config`, { headers: getAuthHeaders() })).json().catch(() => ({}));
    test.skip(cfg.build_type !== 'enterprise', 'AI observability is enterprise-only');
    await navigateToBase(page);
  });

  test('appending from the Playground sends baseVersion + ifHead and creates v2', async ({ page }) => {
    test.setTimeout(150000);
    const name = `ovnc_prompt_${Date.now()}`;
    let entityId = null;
    try {
      const playground = new PromptPlaygroundPage(page);
      await playground.goto(ORG());
      const userMsg = playground.userMessageInput;
      await expect(userMsg).toBeVisible({ timeout: 30000 });
      const dialog = playground.saveDialog;

      // a chat prompt needs non-empty role and content on every message
      await playground.systemMessageInput.fill('You are a terse assistant.');
      await userMsg.fill(`first draft ${name}`);
      await playground.openSaveAsPrompt('A');
      await playground.fillNewPrompt(name, 'v1');
      const created = page.waitForResponse((r) => new RegExp(`/api/${ORG()}/prompts(\\?|$)`).test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await playground.clickSave();
      expect((await created).ok(), 'v1 create').toBeTruthy();
      await expect(dialog).toBeHidden({ timeout: 15000 });
      const v1 = await findPrompt(name);
      expect(v1, 'v1 stored').toBeTruthy();
      entityId = v1.entityId || v1.entity_id || v1.id;
      expect(v1.latestVersion ?? v1.latest_version).toBe(1);

      await userMsg.fill(`second draft ${name}`);
      await playground.openSaveAsPrompt('A');
      await playground.chooseAppendTo(name, 'v2');

      const appendReq = page.waitForRequest((r) => /\/prompts\/[^/]+\/versions(\?|$)/.test(r.url()) && r.method() === 'POST', { timeout: 30000 });
      const appendRes = page.waitForResponse((r) => /\/prompts\/[^/]+\/versions(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
      await playground.clickSave();
      const req = await appendReq;
      const body = req.postDataJSON();
      expect(new URL(req.url()).searchParams.get('if_head')).toBe('1');
      expect(body.baseVersion).toBe(1);
      expect(body.baseHash ?? null, 'baseVersion and baseHash are mutually exclusive').toBeNull();
      const res = await appendRes;
      expect(res.status(), `append returned ${res.status()}`).toBe(200);
      await expect(dialog).toBeHidden({ timeout: 15000 });

      await expect.poll(async () => { const p = await findPrompt(name); return p?.latestVersion ?? p?.latest_version; }, { timeout: 15000 }).toBe(2);
    } finally {
      if (entityId) await fetch(`${BASE}/api/${ORG()}/prompts/${entityId}/archive`, { method: 'POST', headers: getAuthHeaders() }).catch(() => {});
    }
  });
});
