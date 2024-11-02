// loginPage.js
import { expect } from '@playwright/test';

export class LoginPage {
  constructor(page) {
    this.page = page;
    this.userIdInput = page.locator('[data-test="login-user-id"]');
    this.passwordInput = page.locator('[data-test="login-password"]');
    //this.loginButton = this.page.getByRole('button', { name: 'Login' });
    this.loginButton = page.locator('[data-cy="login-sign-in"]');
  }

  async gotoLoginPage() {
    await this.page.goto(process.env["ZO_BASE_URL"]);
  }

  async login() {
    // Fill in user credentials and login
    await this.page.waitForSelector('[data-test="login-user-id"]');
    await this.userIdInput.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await this.page.waitForSelector('[data-test="login-password"]');
    await this.passwordInput.fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await this.page.waitForSelector('[data-cy="login-sign-in"]');
    await this.loginButton.click();
    
  }
}
