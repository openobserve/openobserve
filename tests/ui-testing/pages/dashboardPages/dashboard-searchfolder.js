import { expect } from '@playwright/test';


class DashboardSearchFolder {
    constructor(page) {
      this.page = page;
      this.folderSearchInput = page.locator('[data-test="folder-search"]');
    }
  
    async searchFolder(folderName) {
      await this.folderSearchInput.click();
      await this.folderSearchInput.fill(folderName);
    }
  }
  