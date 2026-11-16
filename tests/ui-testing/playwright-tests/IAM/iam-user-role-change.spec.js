const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe("IAM user role change", () => {
    let pageManager;

    test("Changing an existing user's role closes the edit dialog after Save (ENT#2677)", { tag: ['@regression', '@P3'] }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const org = process.env["ORGNAME"];
        pageManager = new PageManager(page);
        const users = pageManager.userPage;
        test.skip(!(await users.isRbacEnabledViaApi()), 'viewer/editor org roles need OpenFGA, which only the IAM shard starts');

        const email = `ovn_role_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
        const status = await users.createUserViaApi(email, 'viewer');
        expect(status, `create user: ${status}`).toBeLessThan(300);
        try {
            await navigateToBase(page);
            await users.gotoIamPage();
            await users.searchUser(email);
            await users.getEditUserButton(email).click();
            const dialog = users.userDialog;
            await expect(dialog).toBeVisible({ timeout: 15000 });
            await users.selectUserRole('Editor');

            const saved = page.waitForResponse((r) => r.url().includes(`/api/${org}/users/`) && r.request().method() === 'PUT', { timeout: 15000 });
            await users.userCreate();
            expect((await saved).ok()).toBeTruthy();
            await expect(dialog).toBeHidden({ timeout: 3000 });
            await expect.poll(() => users.getUserRoleViaApi(email), { timeout: 10000 }).toBe('editor');
            await expect(dialog, 'the dialog stays closed after the role is saved').toBeHidden();
        } finally {
            await users.deleteUserViaApi(email);
        }
    });
});
