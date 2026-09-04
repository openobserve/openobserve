// dashLogin.js
//
// Login helper for dashboard e2e tests.
//
// SELECTOR POLICY (strictly enforced):
//   Only `data-test` attributes are used here. No class names, no element
//   types, no `getByText` / `getByRole` / `getByLabel`, no `:has-text`,
//   `:nth-`, `filter({ hasText: ... })`, or any text-based locator.
//   If a needed UI element doesn't have a `data-test`, add one in the
//   corresponding `.vue` source under `web/src/` first.

const LOGIN_SELECTORS = Object.freeze({
  internalUserLink: '[data-test="login-as-internal-user"]',
  // OInput's wrapper carries data-test="<name>"; the inner <input> element
  // carries data-test="<name>-field". Playwright's fill() needs the input,
  // so we target the -field suffix.
  userIdInput: '[data-test="login-user-id-field"]',
  passwordInput: '[data-test="login-password-field"]',
  signInButton: '[data-test="login-sign-in"]',
});

/**
 * Logs in via the internal-user form. When SSO is enabled, first clicks
 * the "Login as internal user" toggle (located by data-test) to reveal
 * the form. Otherwise the form is rendered immediately.
 */
export const login = async (page) => {
  await page.goto(process.env["ZO_BASE_URL"], {
    waitUntil: "domcontentloaded",
  });

  await page
    .waitForLoadState("networkidle", { timeout: 10000 })
    .catch(() => {});

  const internalLinkLocator = page.locator(LOGIN_SELECTORS.internalUserLink);
  if (await internalLinkLocator.count()) {
    if (await internalLinkLocator.first().isVisible().catch(() => false)) {
      await internalLinkLocator.first().click();
    }
  }

  await page.waitForSelector(LOGIN_SELECTORS.userIdInput, { timeout: 10000 });

  await page
    .locator(LOGIN_SELECTORS.userIdInput)
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);

  const waitForLogin = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/login") && response.status() === 200,
  );

  await page
    .locator(LOGIN_SELECTORS.passwordInput)
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.locator(LOGIN_SELECTORS.signInButton).click();

  await waitForLogin;

  await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", {
    waitUntil: "domcontentloaded",
  });
};
