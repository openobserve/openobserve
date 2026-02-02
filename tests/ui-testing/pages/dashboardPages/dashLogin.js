// dashLogin.js
export const login = async (page) => {  
    await page.goto(process.env["ZO_BASE_URL"], { waitUntil: "networkidle" });
    
    if (await page.getByText('Login as internal user').isVisible()) {
      await page.getByText('Login as internal user').click();
    }
    await page.waitForSelector('[data-test="login-user-id"]', { timeout: 10000 });
    await page
      .locator('[data-test="login-user-id"]')
      .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  
    const waitForLogin = page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") && response.status() === 200
    );
  
    await page
      .locator('[data-test="login-password"]')
      .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await page.locator('[data-cy="login-sign-in"]').click();
  
    await waitForLogin;
  
    await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", {
      waitUntil: "networkidle",
    });
  }
