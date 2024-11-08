class PipelinePage {
  constructor(page) {
    this.page = page;
    // Locators
    this.pipelineMenuLink = page.locator(
      '[data-test="menu-link-\\/pipeline-item"]'
    );
    this.addPipelineButton = page.locator(
      '[data-test="pipeline-list-add-pipeline-btn"]'
    );
    this.streamButton = page.getByRole("button", { name: "Stream" }).first();
    this.vueFlowPane = page.locator(".vue-flow__pane");
    this.logsDropdown = page.locator("div").filter({ hasText: /^logs$/ });
    this.logsOption = page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2);
    this.saveButton = page.locator('[data-test="input-node-stream-save-btn"]');
    this.selectStreamError = page.getByText("Please select Stream from the");
    this.savePipelineButton = page.locator(
      '[data-test="add-pipeline-save-btn"]'
    );
    this.pipelineNameRequiredMessage = page.getByText(
      "Pipeline name is required"
    );
    this.pipelineNameInput = page.getByLabel("Enter Pipeline Name");
    this.sourceNodeRequiredMessage = page.getByText("Source node is required");
    this.streamNameInput = page.getByLabel("Stream Name *");
    this.e2eAutomateOption = page.getByRole("option", { name: "e2e_automate" });
    this.inputNodeStreamSaveButton = page.locator(
      '[data-test="input-node-stream-save-btn"]'
    );
    this.destinationNodeRequiredMessage = page.getByText(
      "Destination node is required"
    );
    this.deleteButton = page.locator("button").filter({ hasText: "delete" });
    this.confirmDeleteButton = page.locator('[data-test="confirm-button"]');
    this.secondStreamButton = page.getByRole('button', { name: 'Stream' }).nth(1);
   this.selectPreviousNodeDropdown = page.getByLabel('Select Previous Node');

  }

  async openPipelineMenu() {
    await this.pipelineMenuLink.click();
  }

  async addPipeline() {
    await this.addPipelineButton.waitFor({ state: 'visible' });
    await this.addPipelineButton.click();
  }

  async selectStream() {
    await this.streamButton.click();
  }

  async dragStreamToTarget(streamElement) {
    const targetBox = await this.vueFlowPane.boundingBox();
    const streamBox = await streamElement.boundingBox();
  
    if (streamBox && targetBox) {
      await this.page.mouse.move(streamBox.x + streamBox.width / 2, streamBox.y + streamBox.height / 2);
      await this.page.mouse.down();
      await this.page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
      await this.page.mouse.up();
    }
  }

  async selectLogs() {
    await this.logsDropdown.click();
    await this.logsOption.click();
  }

  async saveStream() {
    await this.saveButton.click();
  }

  async confirmStreamError() {
    await this.selectStreamError.click();
  }

  async savePipeline() {
    await this.savePipelineButton.click();
  }

  async confirmPipelineNameRequired() {
    await this.pipelineNameRequiredMessage.click();
  }

  async enterPipelineName(pipelineName) {
    await this.pipelineNameInput.click();
    await this.pipelineNameInput.fill(pipelineName);
  }

  async confirmSourceNodeRequired() {
    await this.sourceNodeRequiredMessage.click();
  }
  async enterStreamName(streamName) {
    await this.streamNameInput.fill(streamName);
    await this.streamNameInput.press("Enter");
  }

  async selectStreamOption() {
    await this.e2eAutomateOption.click();
  }

  async saveInputNodeStream() {
    await this.inputNodeStreamSaveButton.click();
  }

  async confirmDestinationNodeRequired() {
    await this.destinationNodeRequiredMessage.click();
  }
  async deletePipeline() {
    await this.deleteButton.click();
  }

  async confirmDelete() {
    await this.confirmDeleteButton.click();
  }

  async selectAndDragSecondStream() {
    await this.secondStreamButton.click();
    await this.dragStreamToTarget(this.secondStreamButton);
  }
  async selectPreviousNode() {
    await this.selectPreviousNodeDropdown.click();
  }
}

export default PipelinePage;
