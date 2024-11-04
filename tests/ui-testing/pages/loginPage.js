// loginPage.js
import { expect } from '@playwright/test';

export class LoginPage {
  constructor(page) {
    this.page = page;
    this.userIdInput = page.locator('[data-test="login-user-id"]');
    this.passwordInput = page.locator('[data-test="login-password"]');
    this.loginButton = page.locator('[data-cy="login-sign-in"]');
  }

  async gotoLoginPage() {
    await this.page.goto(process.env["ZO_BASE_URL"]);
  }

  async login() {
    // Fill in user credentials and login
    await this.page.waitForSelector('[data-test="login-user-id"]');
    await this.userIdInput.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    // wait for login api response
    const waitForLogin = this.page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") && response.status() === 200
    );


    await this.page.waitForSelector('[data-test="login-password"]');
    await this.passwordInput.fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await this.page.waitForSelector('[data-cy="login-sign-in"]');
    await this.waitForLogin;
    await this.loginButton.click();
    await this.page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", {
      waitUntil: "networkidle",
    });
    await this.page
      .locator('[data-test="navbar-organizations-select"]')
      .getByText("arrow_drop_down")
      .click();
    await this.page.getByRole("option", { name: "default", exact: true }).click();
  }
}
