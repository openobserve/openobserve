import { test, expect } from "./baseFixtures";
import logData from "../../ui-testing/cypress/fixtures/log.json";
// import { log } from "console";
import logsdata from "../../test-data/logs_data.json";
import PipelinePage from "../pages/pipelinePage";
// import { pipeline } from "stream";
// import fs from "fs";
import { v4 as uuidv4 } from "uuid";

test.describe.configure({ mode: "parallel" });

const randomPipelineName = `Pipeline${Math.floor(Math.random() * 1000)}`;
const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;
const randomNodeName = `remote-node-${Math.floor(Math.random() * 1000)}`;

const getPasscode = async (page, url, headers) => {
  return await page.evaluate(
    async ({ url, headers }) => {
      const response = await fetch(url, {
        method: "GET",
        headers: headers,
      });
      return await response.json();
    },
    { url, headers }
  );
};
const getPasscodeUrl = (orgId) => {
  return `${process.env.INGESTION_URL}/api/${orgId}/passcode`;
};
export const b64EncodeStandard = (str) => {
  try {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
        return String.fromCharCode(parseInt(`0x${p1}`));
      })
    );
  } catch (e) {
    console.log("Error: getBase64Encode: error while encoding.");
  }
};

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
// await page.getByText("Login as internal user").click();
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(
    async ({ url, headers, orgId, streamName, logsdata }) => {
      const fetchResponse = await fetch(
        `${url}/api/${orgId}/${streamName}/_json`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify(logsdata),
        }
      );
      return await fetchResponse.json();
    },
    {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      logsdata: logsdata,
    }
  );
  console.log(response);
}

const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page
    .locator("div.q-item")
    .getByText(`${stream}`)
    .first()
    .click({ force: true });
};
async function exploreStreamAndNavigateToPipeline(page, streamName) {
  // Navigate to the streams menu
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();

  // Search for the stream
  await page.getByPlaceholder("Search Stream").click();
  await page.getByPlaceholder("Search Stream").fill(streamName);

  // Click on the 'Explore' button
  await page.getByRole("button", { name: "Explore" }).first().click();

  // Expand the log table menu
  await page
    .locator(
      '[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]'
    )
    .click();

  // Navigate to the pipeline menu
  await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
}

async function exploreStreamAndInteractWithLogDetails(page, streamName) {
  // Navigate to the streams menu
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();

  // Search for the stream
  await page.getByPlaceholder("Search Stream").click();
  await page.getByPlaceholder("Search Stream").fill(streamName);

  // Click on the 'Explore' button
  await page.getByRole("button", { name: "Explore" }).first().click();

  // Expand the log table menu
  await page
    .locator(
      '[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]'
    )
    .click();

  // Interact with the log detail key
  await page
    .locator('[data-test="log-expand-detail-key-new_k8s_id-text"]')
    .click();

  // Navigate to the pipeline menu
  await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
}

async function enableToggleIfOff(page) {
  const toggle = page.locator(
    '[data-test="associate-function-after-flattening-toggle"]'
  );

  // Wait for the toggle to appear
  await toggle.waitFor();

  // Check if it's a checkbox
  if (
    await toggle.evaluate(
      (el) => el.tagName.toLowerCase() === "input" && el.type === "checkbox"
    )
  ) {
    if (!(await toggle.isChecked())) {
      await toggle.click();
    }
  } else {
    // Handle non-checkbox toggles (e.g., buttons, divs)
    const isOff = await toggle.evaluate(
      (el) =>
        el.getAttribute("aria-checked") === "false" ||
        el.classList.contains("off")
    );
    if (isOff) {
      await toggle.click();
    }
  }
}

async function deletePipeline(page, randomPipelineName) {
  // Click the back button
  await page.locator('[data-test="add-pipeline-back-btn"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.waitForTimeout(2000);

  // Search for the pipeline
  await page.locator('[data-test="pipeline-list-search-input"]').click();
  await page
    .locator('[data-test="pipeline-list-search-input"]')
    .fill("automatepi");

  // Delete the pipeline
  await page
    .locator(
      `[data-test="pipeline-list-${randomPipelineName}-delete-pipeline"]`
    )
    .click();
  await page.locator('[data-test="confirm-button"]').click();
}
test.describe("Pipeline testcases", () => {
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
    // await search.hits.FIXME_should("be.an", "array");
  }
  let passcodeToBeSent;
  let AuthorizationToken;

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(5000);
    // ("ingests logs via API", () => {
    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString("base64");
    //this needs to be filled with the authorization (basic) token if exists otherwise it will be filled with the same environment authorization (not remote)
    AuthorizationToken = "";

    const headers = {
      Authorization: `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    await ingestion(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await applyQueryButton(page);
    //this only be called when no authorization token is present so that the remote will destination will be the same as the environment
    if (AuthorizationToken.length == 0) {
      const passcodeUrl = getPasscodeUrl(orgId);
      const response = await getPasscode(page, passcodeUrl, headers);
      AuthorizationToken = b64EncodeStandard(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${response.data.passcode}`
      );
    }
  });

  async function exploreStreamAndDeletePipeline(
    page,
    pipelinePage,
    streamName,
    pipelineName
  ) {
    await exploreStreamAndNavigateToPipeline(page, streamName);
    await pipelinePage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);

    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pipelinePage.confirmDeletePipeline();
    await pipelinePage.verifyPipelineDeleted();
  }
  test.skip("should add source & remote destination node and then delete the pipeline", async ({
    page,
  }) => {
    const pipelinePage = new PipelinePage(page);

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(3000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page
      .getByRole("button", { name: "e2e_automate" })
      .hover();  
    await pipelinePage.createRemoteDestination(randomNodeName, AuthorizationToken)
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();

    await ingestion(page);
    await exploreStreamAndDeletePipeline(
      page,
      pipelinePage,
      "remote_automate",
      pipelineName
    );

    await pipelinePage.deleteDestination(randomNodeName);
  });

  test.skip("should add source, function, remote destination and then delete pipeline", async ({
    page,
  }) => {
    const pipelinePage = new PipelinePage(page);

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    // await pipelinePage.selectAndDragFunction(); // Function drag
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Function", exact: true }).click();
    await pipelinePage.toggleCreateFunction();
    await pipelinePage.enterFunctionName(randomFunctionName);
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .locator(".view-lines")
      .click();
    // Type the function text with a delay to ensure each character registers
    await page.keyboard.type(".a=41", { delay: 100 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(".", { delay: 100 });
    await page.getByText("Note: The function will be").click();

    // Check if the required text is present in the editor
    await page.getByText(".a=41 .");

    // Optional: Add a short wait to confirm the action is processed
    await page.waitForTimeout(1000);

    // Optional: Add a brief wait to allow any validation messages to process
    await pipelinePage.saveNewFunction();
    await page.waitForTimeout(3000);
    await pipelinePage.saveFunction();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: randomFunctionName }).hover();
    
    await pipelinePage.createRemoteDestination(randomNodeName, AuthorizationToken)
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();

    await ingestion(page);
    await exploreStreamAndDeletePipeline(
      page,
      pipelinePage,
      "remote_automate",
      pipelineName
    );
    await pipelinePage.deleteDestination(randomNodeName);

  });

  test.skip("should add source, condition & remote destination node and then delete the pipeline", async ({
    page,
  }) => {
    const pipelinePage = new PipelinePage(page);

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Stream", exact: true }).click();
    await page.getByPlaceholder("Column").click();
    await page.getByPlaceholder("Column").fill("container_name");
    await page
      .getByRole("option", { name: "kubernetes_container_name" })
      .click();
    await page
      .locator(
        "div:nth-child(2) > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
      )
      .click();
    await page.getByText("Contains", { exact: true }).click();
    await page.getByPlaceholder("Value").click();
    await page.getByPlaceholder("Value").fill("prometheus");
    await pipelinePage.saveCondition();
    await page.waitForTimeout(2000);
    await page
      .getByRole("button", { name: "kubernetes_container_name" })
      .hover(); 
    await pipelinePage.createRemoteDestination(randomNodeName, AuthorizationToken)  
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);
    await exploreStreamAndDeletePipeline(
      page,
      pipelinePage,
      "remote_automate",
      pipelineName
    );
    await pipelinePage.deleteDestination(randomNodeName);
  });
  test("should add source, function,destination and then delete pipeline", async ({
    page,
  }) => {
    const pipelinePage = new PipelinePage(page);
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    // await pipelinePage.selectAndDragFunction(); // Function drag
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Function", exact: true }).click();
    await pipelinePage.toggleCreateFunction();
    await pipelinePage.enterFunctionName(randomFunctionName);
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .locator(".view-lines")
      .click();
    // Type the function text with a delay to ensure each character registers
    await page.keyboard.type(".new_k8s_id=.kubernetes_namespace_name", {
      delay: 100,
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type(".", { delay: 100 });
    await page.getByText("Note: The function will be").click();
    // Check if the required text is present in the editor
    await page.getByText(".new_k8s_id=.kubernetes_namespace_name .");
    // Optional: Add a short wait to confirm the action is processed
    await page.waitForTimeout(1000);
    // Optional: Add a brief wait to allow any validation messages to process
    await pipelinePage.saveNewFunction();
    await page
      .locator('[data-test="associate-function-after-flattening-toggle"]')
      .waitFor();
    await enableToggleIfOff(page);
    await pipelinePage.saveFunction();
    await page
      .getByRole("button", { name: randomFunctionName })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: randomFunctionName }).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    await pipelinePage.toggleCreateStream();
    await page.getByLabel("Name *").click();
    await page.getByLabel("Name *").fill("destination-node");
    await page
      .locator(
        ".q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
      )
      .click();
    await page
      .getByRole("option", { name: "Logs" })
      .locator("div")
      .nth(2)
      .click();
    await pipelinePage.clickSaveStream();
    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);
    // Verify the data ingested in destination & function and verify under logs page
    await exploreStreamAndInteractWithLogDetails(page, "destination_node");
    await pipelinePage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pipelinePage.confirmDeletePipeline();
    await pipelinePage.verifyPipelineDeleted();
  });
});
