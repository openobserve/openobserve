// tests/ui-testing/playwright-tests/login/loginValidation.spec.js
//
// Client-side validation coverage for the migrated internal-user login form
// (OForm + zod schema in web/src/components/login/Login.vue). Complements the
// happy-path Login test in auth.spec.js.
//
// These run on a FRESH, UNAUTHENTICATED page, so they import the raw
// @playwright/test `test` (a clean context) rather than enhanced-baseFixtures —
// whose `test` injects the saved auth storageState and would land us
// already-logged-in, with no login form to validate.
//
// Native email-validation note: the email field is type="email" inside a real
// <form>. A value with no host part (e.g. "notanemail") trips the BROWSER's own
// constraint bubble and the submit event never reaches zod, so the app's custom
// message would not show. "user@invalid" passes the native check (it has "@" and
// a host) but fails zod (no TLD), reliably surfacing the app's invalid-email
// message. Empty fields carry no native `required` attribute, so the zod
// "required" messages always show for them.

import { test, expect } from '@playwright/test';
import PageManager from '../../pages/page-manager.js';
import { isCloudEnvironment } from '../utils/cloud-auth.js';

const VALID_EMAIL = 'user@example.com';
const NATIVELY_VALID_BUT_BAD_EMAIL = 'user@invalid'; // passes browser, fails zod
const SOME_PASSWORD = 'Password123';

test.describe('Login form validation', () => {
  // Serial: these share one browser context. None of them completes a real
  // login, so no auth cookies accumulate between them.
  test.describe.configure({ mode: 'serial' });

  // Cloud builds use Dex OIDC — there is no internal login form to validate.
  test.skip(isCloudEnvironment(), 'No internal login form on cloud (Dex OIDC)');

  let loginPage;

  test.beforeEach(async ({ page }) => {
    const pm = new PageManager(page);
    loginPage = pm.loginPage;
    await loginPage.openInternalLoginForm();
  });

  test('should show required errors and block submit when both fields are empty', async ({ page }) => {
    await loginPage.submitLoginForm();

    await expect(loginPage.userIdError).toBeVisible();
    await expect(loginPage.passwordError).toBeVisible();
    await expect(loginPage.userIdError).toHaveText('Email is required');
    await expect(loginPage.passwordError).toHaveText('Password is required');

    // Submission was blocked — still on the login form, not the app shell.
    await expect(loginPage.userIdInput).toBeVisible();
    await expect(page).not.toHaveURL(/\/web\/$/);
  });

  test('should show only a password error when the email is valid but the password is empty', async () => {
    await loginPage.fillLoginForm(VALID_EMAIL, '');
    await loginPage.submitLoginForm();

    await expect(loginPage.passwordError).toBeVisible();
    await expect(loginPage.passwordError).toHaveText('Password is required');
    await expect(loginPage.userIdError).toBeHidden();
  });

  test('should show only an email error when the password is valid but the email is empty', async () => {
    await loginPage.fillLoginForm('', SOME_PASSWORD);
    await loginPage.submitLoginForm();

    await expect(loginPage.userIdError).toBeVisible();
    await expect(loginPage.userIdError).toHaveText('Email is required');
    await expect(loginPage.passwordError).toBeHidden();
  });

  test('should show an invalid-email error for a malformed email', async () => {
    await loginPage.fillLoginForm(NATIVELY_VALID_BUT_BAD_EMAIL, SOME_PASSWORD);
    await loginPage.submitLoginForm();

    await expect(loginPage.userIdError).toBeVisible();
    await expect(loginPage.userIdError).toHaveText('Please enter a valid email');
  });

  test('should clear the email error once a valid email is entered (live re-validation)', async () => {
    // First submit reveals the error…
    await loginPage.fillLoginForm(NATIVELY_VALID_BUT_BAD_EMAIL, SOME_PASSWORD);
    await loginPage.submitLoginForm();
    await expect(loginPage.userIdError).toBeVisible();

    // …then the field re-validates on change — a valid email clears the error
    // without needing another submit.
    await loginPage.userIdInput.fill(VALID_EMAIL);
    await expect(loginPage.userIdError).toBeHidden();
  });
});
