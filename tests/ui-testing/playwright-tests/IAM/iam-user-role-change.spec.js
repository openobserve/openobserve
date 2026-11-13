const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe("IAM user role change", () => {
    let pageManager;

    test("Changing an existing user's role closes the edit dialog after Save (ENT#2677)", { tag: ['@regression', '@P3'] }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const org = process.env["ORGNAME"];
        const api = page.context().request;
        const apiBase = process.env["ZO_BASE_URL_SC"] || process.env["ZO_BASE_URL"];
        const auth = { Authorization: 'Basic ' + Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64') };
        const cfg = await (await api.get(`${apiBase}/api/${org}/config`, { headers: auth })).json();
        test.skip(cfg.rbac_enabled !== true, 'viewer/editor org roles need OpenFGA, which only the IAM shard starts');

        const email = `ovn_role_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
        const created = await api.post(`${apiBase}/api/${org}/users`, {
            headers: auth,
            data: { email, password: process.env["ZO_ROOT_USER_PASSWORD"], first_name: 'r', last_name: 'c', role: 'viewer' },
        });
        expect(created.ok(), `create user: ${created.status()}`).toBeTruthy();
        try {
            await navigateToBase(page);
            pageManager = new PageManager(page);
            await pageManager.userPage.gotoIamPage();
            await pageManager.userPage.searchUser(email);
            await pageManager.userPage.getEditUserButton(email).click();
            const dialog = pageManager.userPage.userDialog;
            await expect(dialog).toBeVisible({ timeout: 15000 });
            await pageManager.userPage.selectUserRole('Editor');

            const saved = page.waitForResponse((r) => r.url().includes(`/api/${org}/users/`) && r.request().method() === 'PUT', { timeout: 15000 });
            await pageManager.userPage.userCreate();
            expect((await saved).ok()).toBeTruthy();
            await expect(dialog).toBeHidden({ timeout: 3000 });
            await page.waitForTimeout(2000);
            await expect(dialog).toBeHidden();

            const list = await (await api.get(`${apiBase}/api/${org}/users`, { headers: auth })).json();
            const row = (list.data || []).find((u) => u.email === email);
            expect(row?.role).toBe('editor');
        } finally {
            await api.delete(`${apiBase}/api/${org}/users/${encodeURIComponent(email)}`, { headers: auth });
        }
    });
});
