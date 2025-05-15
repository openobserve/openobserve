import { expect } from '@playwright/test';

export class StreamPage {
  constructor(page) {
    this.page = page;
    this.streamExplorerLink = '[data-test="menu-link-/streams-item"]';
    this.searchStreamInput = '[placeholder="Search Stream"]';
    this.exploreButton = 'button:has-text("Explore")';
  }

  async navigateToStreamExplorer() {
    await this.page.locator(this.streamExplorerLink).click({ force: true });
    await this.page.waitForTimeout(1000);
  }

  async searchStream(streamName) {
    await this.page.getByPlaceholder("Search Stream").click();
    await this.page.getByPlaceholder("Search Stream").fill(streamName);
    await this.page.waitForTimeout(3000);
  }

  async verifyStreamNameVisibility(streamName) {
    await expect(this.page.getByText(streamName)).toBeVisible();
  }

  async exploreStream() {
    const streamButton = this.page.getByRole("button", { name: 'Explore' });
    await expect(streamButton).toBeVisible();
    await streamButton.click({ force: true });
    await this.page.waitForTimeout(1000);
  }

  async verifyStreamExploration() {
    await expect(this.page.url()).toContain("logs");
  }

  async goBack() {
    await this.page.goBack();
    await this.page.waitForTimeout(1000);
  }
} 