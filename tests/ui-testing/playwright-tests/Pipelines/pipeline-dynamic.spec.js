import { test, expect } from "../baseFixtures.js";
import PageManager from "../../pages/page-manager.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dynamic Pipeline Tests", () => {
  let pageManager;
  let page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    pageManager = new PageManager(page);
  });

  test("should create and delete dynamic pipeline", async () => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();
    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pageManager.pipelinesPage.confirmDeletePipeline();
    await pageManager.pipelinesPage.verifyPipelineDeleted();
  });
}); 