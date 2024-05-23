///<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import logsdata from "../../../../test-data/logs_data.json"
// import logsdata from "../../data/logs_data.json";
// import { login } from "../../support/commons"
// import { selectStreamAndStreamType } from "../../support/log-commons";

Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Logs testcases", () => {
  let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }

  function applyQueryButton() {
    // click on the run query button
    // Type the value of a variable into an input field
    cy.intercept("POST", logData.applyQuery).as("search");
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // get the data from the search variable
    cy.wait("@search").its("response.statusCode").should("eq", 200);
    cy.get("@search").its("response.body.hits").should("be.an", "array");
  }

  before(function () {
    cy.fixture("log").then(function (data) {
      logData = data;
    });
    console.log("--logData--", logData);
  });

  beforeEach(() => {
    cy.intercept("*", (req) => {
      delete req.headers["if-none-match"];
    });
    cy.login();
    // ("ingests logs via API", () => {
    const orgId = Cypress.env("ORGNAME");
    const streamName = "e2e_automate";
    const basicAuthCredentials = btoa(
      `${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`
    );

    // Making a POST request using cy.request()
    cy.request({
      method: "POST",
      url: `${Cypress.config().ingestionUrl}/api/${orgId}/${streamName}/_json`,
      body: logsdata,
      headers: {
        Authorization: `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      },
    }).then((response) => {
      // Logging response content to the Cypress console
      cy.log(response.body);

      // Assertion: Ensure the response status is 200 OK
      expect(response.status).to.eq(
        200,
        `Expected status code 200, but got ${response.status}`
      );
    });

    // });
    cy.intercept("GET", "**/api/default/organizations**").as("allorgs");
    cy.intercept("GET", "**/api/default/functions**").as("functions");
    cy.visit(`${logData.logsUrl}?org_identifier=${Cypress.env("ORGNAME")}`);
    cy.intercept("POST", "**/api/default/_search**").as("allsearch");
    cy.selectStreamAndStreamTypeForLogs(logData.Stream);
    applyQueryButton()
    cy.wait("@allsearch");
    cy.intercept("GET", "**/api/default/streams**").as("streams")
    cy.intercept('GET', '/api/default/e2e_automate/_values?').as('getValues')

    
  });

  // This is a test case to navigate to the logs page
  it("Navigate to the logs page", () => {
    // Visit the base URL
    // cy.visit("/");
    // // Trigger a mouseover   event on the logs menu link
    // cy.get('[data-test="menu-link-/logs-item"]').trigger("mouseover");
    // // Click on the logs menu link that contains the module log data
    // cy.get('[data-test="menu-link-/logs-item"]')
    //   .contains(logData.moduleLog)
    //   .click();
  });

  // This test checks if the histogram toggle button works correctly by clicking it and verifying that the chart is hidden.

  // This test checks that clicking on the histogram toggle button in SQL mode does not toggle the chart
  it.skip("should not toggle chart when clicking on the histogram toggle in the sql mode", () => {
    logstests.clickHistogramToggle();
    cy.wait(3000);
    logstests.clickSearchBarSqlMode();
    cy.wait(3000);
    logstests.confirmLogsSearchHidden();
    cy.wait(3000);
    logstests.histogramToggleEnabled();
  });
  it.skip("should toggle chart when clicking on the histogram toggle", () => {
    cy.wait(3000);
    logstests.clickHistogramToggle();
    cy.wait(3000);
    logstests.confirmLogsSearchHidden();
  });

  // This test case checks if the function editor is toggled on/off when the 'functions toggle' button is clicked
  it("should toggle the function editor on functions toggle click", () => {
    logstests.displayVrlFunctionEditor();
    logstests.clickLogsSearchQueryToggle();
    logstests.vrlFunctionEditorHidden();
    logstests.clickLogsSearchQueryToggle();
    logstests.displayVrlFunctionEditor();
  });

  it("should clear the value of a function on functions toggle click", () => {
    // Wait for 5 seconds
    cy.wait(5000);
    logstests.enterVrlFunctionvalue();
    logstests.clickLogsSearchQueryToggle();
    logstests.clickLogsSearchQueryToggle();
    logstests.attributeToNotHaveVrlFunctionvalue();
  });

  it.skip("should load the values of a field when the field is expanded", () => {
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();
    cy.wait(2000);
    logstests.expandLogsSearch();
    logstests.verifyLogsStatusCode();
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-test="logs-search-subfield-add-code-200"]').should(
      "be.visible"
    );
  });

  it("should add the field to the editor when + is clicked", () => {
    // Wait for 5 seconds
    cy.wait(4000);
    // get the value of the field name
    logstests.clickValueEditor();
    logstests.clickExpandedViewplusButton();
    logstests.addValueInQueryEditor();
    logstests.verifyAddedValue();
    // add second field to the editor
    cy.wait(4000);
    logstests.clickValueEditor();
    logstests.addMoreValueQueryEditor();
    logstests.addSecondValues();
    logstests.valueAddedInSqlMode();
    applyQueryButton();
  });

  it("should add the value to the editor when the = is clicked next to the field value", () => {
    // Wait for 2 seconds
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    logstests.addFeildandSubValue();
    logstests.addsubFeildValue();
    //click on the field
    // get the data from the value variable
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    logstests.addsubFeildValue();
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.clickFeildSubvalue();
    cy.wait(2000);
    logstests.valueAddedOnPlusClick();
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickOnFirstField();
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.addSecondFieldOnEditor();
    logstests.clickOnEqualToButton();
    logstests.bothFieldAddedOnEqualToClick();
    applyQueryButton();
  });

  it.skip("should add the value to the editor when the != is clicked next to the field value", () => {
    // Wait for 2 seconds
    cy.wait(5000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    //click on the field
    cy.get(
      `[data-test="log-search-expand-${logData.addFieldAndSubFieldValueWithNotEqual.field}-field-btn"]`
    ).click({ force: true });
    // get the data from the value variable
    cy.wait("@value", { timeout: 15000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");

    cy.get(
      `[data-test="logs-search-subfield-add-${logData.addFieldAndSubFieldValueWithNotEqual.field}-${logData.addFieldAndSubFieldValueWithNotEqual.subFieldValue}"] `
    ).trigger("mouseover", { force: true });
    // click on = button
    cy.get(
      `[data-test="logs-search-subfield-add-${logData.addFieldAndSubFieldValueWithNotEqual.field}-${logData.addFieldAndSubFieldValueWithNotEqual.subFieldValue}"] [data-test="log-search-subfield-list-not-equal-${logData.addFieldAndSubFieldValueWithNotEqual.field}-field-btn"]`
    ).click({ force: true });

    // assertion for value is added on the editor when = is clicked
    cy.get('[data-test="logs-search-bar-query-editor"]')
      .invoke("text")
      .then((text) => {
        expect(
          text.includes(
            `${logData.addFieldAndSubFieldValueWithNotEqual.field}!='${logData.addFieldAndSubFieldValueWithNotEqual.subFieldValue}'`
          )
        ).to.be.true;
      });
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    //click on the field
    cy.get(
      `[data-test="log-search-expand-${logData.expandedFieldValue.field1}-field-btn"]`
    ).click({ force: true });
    // get the data from the value variable
    cy.wait("@value", { timeout: 4000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    cy.get(
      '[data-test="logs-search-subfield-add-code-401"] > .text-black > [data-test="log-search-subfield-list-equal-code-field-btn"]'
    ).click({ force: true });
    cy.get(
      '[data-test="log-search-subfield-list-not-equal-stream-field-btn"]'
    ).click({ force: true });
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.not.include("code: 200");
      // Confirm that the text contains 'stream' not equal to 'stderr'
      expect(cleanedText).to.not.include("stream: stderr");
    });
    applyQueryButton();
  });

  it("should click run query after SQL toggle on but without any query", () => {
    // Wait for 2 seconds
    cy.wait(3000);
    // Type the value of a variable into an input field
    cy.get('[aria-label="SQL Mode"]').click({ force: true });
    cy.get('[data-test="logs-search-bar-query-editor"]').type(
      "{selectall}{del}"
    );
    cy.wait(3000);
    cy.get('[data-cy="search-bar-refresh-button"]', { timeout: 2000 }).click({
      force: true,
    });
    cy.contains("Invalid SQL Syntax").should("be.visible");
  });

  it("should enter a valid SQL query", () => {
    // Wait for 2 seconds
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    logstests.addFeildandSubValue();
    logstests.addsubFeildValue();
    //click on the field
    // get the data from the value variable
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    logstests.addsubFeildValue();
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.clickFeildSubvalue();
    cy.wait(2000);
    logstests.valueAddedOnPlusClick();
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickOnFirstField();
    cy.wait("@value", { timeout: 4000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.bothFieldAddedOnEqualToClick();
    cy.get('[aria-label="SQL Mode"]').click({ force: true });
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include(
        "SELECT * FROM \"e2e_automate\" WHERE code = '200' ORDER BY _timestamp DESC"
      );
    });
    applyQueryButton();
  });

  it.skip("should contain options to include, exclude and add field to table under Json", () => {
    // Wait for 2 seconds
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    logstests.addFeildandSubValue();
    logstests.addsubFeildValue();
    //click on the field
    // get the data from the value variable
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    logstests.addsubFeildValue();
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.clickFeildSubvalue();
    cy.wait(2000);
    logstests.valueAddedOnPlusClick();
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickOnFirstField();
    cy.wait("@value", { timeout: 4000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.addSecondFieldOnEditor();
    logstests.clickOnEqualToButton();
    logstests.bothFieldAddedOnEqualToClick();
    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true });
    cy.wait(300);
    cy.get(
      '[data-test="log-detail-json-content"] >>> [data-test="log-details-include-exclude-field-btn"] :first'
    ).click({ force: true });
    cy.get('[data-test="log-details-include-field-btn"]').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include(
        "code='200' and code='200' and _timestamp="
      );
    });
    applyQueryButton();
    cy.get('[data-test="logs-search-bar-query-editor"]').type(
      "{selectall}{del}"
    );
    applyQueryButton();
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(2)
      .click({ force: true });
    cy.wait(2000);
    cy.get(
      '[data-test="log-detail-json-content"] >>> [data-test="log-details-include-exclude-field-btn"] :first'
    ).click({ force: true });
    cy.get('[data-test="log-details-exclude-field-btn"]', {
      timeout: 2000,
    }).click({ force: true });
    // cy.wait(2000);
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include("_timestamp!=");
      applyQueryButton();
      cy.wait(200);
      //   cy.get('[data-test="[data-test="logs-search-bar-query-editor"]"]').type("{selectall}{del}");
      //   applyQueryButton();
      cy.get('[data-test="logs-search-result-logs-table"]')
        .find("tbody")
        .find("tr")
        .eq(2)
        .click({ force: true });
      cy.wait(2000);
      cy.get(
        '[data-test="log-detail-json-content"] >>> [data-test="log-details-include-exclude-field-btn"] :first'
      ).click({ force: true });
      cy.contains("Add field to table").click({ force: true });
      applyQueryButton();
    });
  });

  it("should contain options to include, exclude and add field to table under TABLE", () => {
    // Wait for 2 seconds
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    logstests.addFeildandSubValue();
    logstests.addsubFeildValue();
    //click on the field
    // get the data from the value variable
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    logstests.addsubFeildValue();
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.clickFeildSubvalue();
    cy.wait(2000);
    logstests.valueAddedOnPlusClick();
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickOnFirstField();
    cy.wait("@value", { timeout: 4000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.addSecondFieldOnEditor();
    logstests.clickOnEqualToButton();
    logstests.bothFieldAddedOnEqualToClick();
    cy.get('[data-test="logs-search-result-logs-table"]', { timeout: 2000 })
      .find("tbody")
      .find("tr")
      .eq(1)
      .trigger("mouseover", { force: true });
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true }); // select first row from the table
    cy.get('[data-test="log-detail-table-tab"]').click({ force: true });
    cy.get(
      '[data-test="log-details-include-exclude-field-btn-_timestamp"]'
    ).click({ force: true });
    cy.get('[data-test="log-details-include-field-btn"]:first').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include("code='200' and _timestamp=");
    });
    applyQueryButton();

    cy.get('[data-test="logs-search-bar-query-editor"]').type(
      "{selectall}{del}"
    );
    applyQueryButton();
    cy.wait(2000);
    // cy.get('[data-test="logs-search-result-logs-table"]')
    // .find("tbody")
    // .find("tr")
    // .eq(1)
    // .trigger("mouseover", { force: true });
    cy.get('[data-test="logs-search-result-logs-table"]', { timeout: 2000 })
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true }); // select first row from the table
    cy.get('[data-test="log-detail-table-tab"]').click({ force: true });
    cy.get(
      '[data-test="log-details-include-exclude-field-btn-_timestamp"]'
    ).click({ force: true });
    cy.get('[data-test="log-details-exclude-field-btn"]').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include("_timestamp!=");
    });
    applyQueryButton();
    cy.get('[data-test="logs-search-bar-query-editor"]').type(
      "{selectall}{del}"
    );
    applyQueryButton();
    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .trigger("mouseover", { force: true });
    cy.get('[data-test="logs-search-result-logs-table"]', { timeout: 2000 })
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true }); // select first row from the table
    cy.wait(2000);
    cy.get('[data-test="log-detail-table-tab"]').click({ force: true });
    cy.get(
      '[data-test="log-details-include-exclude-field-btn-_timestamp"]'
    ).click({ force: true });
    cy.contains("Add field to table").click({ force: true });
    applyQueryButton();
  });

  it("should be able to search around logs from the sidebar", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();

    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]') // Assuming your table is represented by the <table> element
      .should("be.visible");
    cy.wait(4000);
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .trigger("mouseover", { force: true });
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true }); // select first row from the table
    cy.wait(4000);
    cy.get('[data-test="dialog-box"]').should("be.visible"); // Assertion for the dialog-box is open
    cy.intercept("GET", logData.SearchQuery).as("code");
    cy.get("[data-test='logs-detail-table-search-around-btn']").click(); // click on search around btn
    cy.wait("@code").its("response.statusCode").should("eq", 200);
  });

  it("should be able to toggle to the json tab and see json log", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();
    cy.get('[data-test="logs-search-result-logs-table"]') // Assuming your table is represented by the <table> element
      .should("be.visible");
    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .trigger("mouseover", { force: true });
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true }); // select first row from the table
    cy.wait(2000);
    cy.get('[data-test="dialog-box"]').should("be.visible"); // Assertion for the dialog-box is open
    cy.get("[data-test='log-detail-json-tab']").click(""); // click on json tab
    cy.get('[data-test="log-detail-tab-container"]').should("be.visible"); // Assertion for the json tab is open
  });

  it("should be able to navigate to the next and previous logs from the next and previous button", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();
    cy.get('[data-test="logs-search-result-logs-table"]') // Assuming your table is represented by the <table> element
      .should("be.visible");
    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]', { timeout: 2000 })
      .find("tbody")
      .find("tr")
      .eq(1)
      .trigger("mouseover", { force: true });
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true }); // select first row from the table
    cy.get('[data-test="dialog-box"]', { timeout: 3000 }).should("be.visible"); // Assertion for the dialog-box is open
    cy.get('[data-test="log-detail-previous-detail-btn"]')
      .trigger("mouseover", { force: true })
      .should("be.disabled"); // button is disabled when first click
    cy.get('[data-test="log-detail-next-detail-btn"]').click({ force: true }); // click on next btn
    cy.get('[data-test="log-detail-next-detail-btn"]').click({ force: true }); // click on next btn
    cy.get('[data-test="log-detail-previous-detail-btn"]').click({
      force: true,
    }); // click on previous btn
    cy.get('[data-test="log-detail-previous-detail-btn"]').click({
      force: true,
    }); // click on previous btn
    cy.get('[data-test="log-detail-previous-detail-btn"]')
      .trigger("mouseover", { force: true })
      .should("be.disabled"); // button is disabled when first click
  });

  it("should be able to enter valid text in VRL and run query", () => {
    // cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();
    cy.get(
      "#fnEditor > .monaco-editor > .overflow-guard > .monaco-scrollable-element > .lines-content > .view-lines"
    ).type(".a=2");
    applyQueryButton();
    cy.get(' [data-test="table-row-expand-menu"]')
      .first()
      .click({ force: true });
    cy.contains("a:2").should("be.visible");
    cy.get('[data-test="logs-search-result-logs-table"]').should("be.visible");
  });

  it("should hide and display again after clicking the arrow  ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-show-query-toggle-btn"] ').click({
      force: true,
    });
    cy.get(".bg-primary > .q-btn__content > .q-icon").click({ force: true });
    cy.wait(2000);
    cy.get(".bg-primary > .q-btn__content > .q-icon").click({ force: true });
    cy.get('[data-cy="index-field-search-input"]').should("be.visible");
  });

  // TODO: Need to change the locators for Saved views once added
  it("should verify if special characters allowed saved views name  ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-show-query-toggle-btn"] ').click({
      force: true,
    });
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown--current > .q-btn__content > :nth-child(1)'
    ).click({ force: true });
    cy.get('[data-test="add-alert-name-input"]').type("e2e@@@@@");
    cy.wait(2000);
    cy.get(".q-card__actions > .bg-primary > .q-btn__content").click({
      force: true,
    });
    cy.get(".q-notification__message").should(
      "contain",
      "Please provide valid view name"
    );
  });

  // TODO: Need to change the locators for Saved views once added
  it("should allow alphanumeric name under saved view  ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-show-query-toggle-btn"] ').click({
      force: true,
    });
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown--current > .q-btn__content > :nth-child(1)'
    ).click({ force: true });
    cy.get('[data-test="add-alert-name-input"]').type("e2etest2");
    cy.wait(2000);
    cy.get('[data-test="saved-view-dialog-save-btn"]').click({
      force: true,
    });
    cy.get(".q-notification__message").should(
      "contain",
      "View created successfully"
    );
    cy.wait(2000);
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon'
    ).click({ force: true });
    cy.wait(2000);
    cy.get(":nth-child(1) > .q-item__section--main > .q-item__label").click({
      force: true,
    });
    cy.contains("e2etest2").click({ force: true });
    cy.get(".q-notification__message").should(
      "contain",
      "e2etest2 view applied successfully"
    );
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon'
    ).click();
    cy.get(".saved-view-item")
      .first()
      .within(() => {
        cy.get(
          '[data-test="logs-search-bar-delete-e2etest2-saved-view-btn"]'
        ).click({ force: true });
      });

    cy.get('[data-test="confirm-button"] > .q-btn__content').click({
      force: true,
    });
  });

  // TODO: Need to change the locators for Saved views once added
  it("should display error when user directly clicks on OK without adding name  ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-show-query-toggle-btn"] ').click({
      force: true,
    });
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown--current > .q-btn__content > :nth-child(1)'
    ).click({ force: true });
    cy.get('[data-test="saved-view-dialog-save-btn"]').click({
      force: true,
    });
    cy.get(".q-notification__message").should(
      "contain",
      "Please provide valid view name"
    );
  });

  // TODO: Need to change the locators for Saved views once added
  it("should display the details of logs results on graph  ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();
    cy.get(".search-list > :nth-child(1) > .text-left").should("be.visible");
    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true });
    cy.get('[data-test="close-dialog"] > .q-btn__content > .q-icon').click({
      force: true,
    });
    cy.get(".search-list > :nth-child(1) > .text-left").should("not.be.hidden");
  });

  it("should click on live mode on button and select 5 sec, switch off and then click run query   ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    cy.get(".q-pl-sm > .q-btn > .q-btn__content").click({ force: true });
    cy.get('[data-test="logs-search-bar-refresh-time-5"]').click({
      force: true,
    });
    cy.get(".q-notification__message").should(
      "contain",
      "Live mode is enabled"
    );
    cy.get(".q-pl-sm > .q-btn > .q-btn__content").click({ force: true });
    cy.get(
      '[data-test="logs-search-off-refresh-interval"] > .q-btn__content'
    ).click({ force: true });
    applyQueryButton();
  });

  it("should click on vrl toggle and display the field and on disable toggle the VRL field to disappear ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    // cy.get(
    //   '[data-test="logs-search-bar-show-query-toggle-btn"] > .q-toggle__inner'
    // ).click({ force: true });
    cy.get("#fnEditor >>>>> .view-lines").should("be.visible");
    cy.get(
      '[data-test="logs-search-bar-show-query-toggle-btn"] > .q-toggle__inner'
    ).click({ force: true });
    cy.get("#fnEditor >>>>> .view-lines").should("not.be.visible");
  });

  it("should switch from past 6 weeks to past 6 days on date-time UI  ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    cy.get('[data-cy="date-time-button"]').should("contain", "Past 6 Weeks");
    applyQueryButton();
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-d-btn"]').click({ force: true });
    cy.get('[data-cy="date-time-button"]').should("contain", "Past 6 Days");
    applyQueryButton();
  });

  it.skip("should only display results for selected date time ", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-absolute-tab"]').click({ force: true });
    const date = new Date().getDate();
    cy.get(".q-date").contains(date).click({ force: true });
    cy.wait(100);
    cy.get(".q-date").contains(date).click({ force: true });
    cy.get(".startEndTime td:nth-child(1) input")
      .click({ force: true })
      .wait(200)
      .clear()
      .type("{ctrl+a}", { delay: 10 })
      .type("0000", { delay: 10 });
    cy.get(".startEndTime td:nth-child(2) input")
      .click({ force: true })
      .wait(200)
      .clear()
      .type("{ctrl+a}", { delay: 10 })
      .type("2359", { delay: 10 });
    applyQueryButton();
    // wait for the query results to appear
    cy.wait(2000);

    // const children = cy.get('[data-test="logs-search-result-logs-table"]')
    //   .find("tbody:last()")
    //   .find("tr")
    //   .children.length

    const startDate = new Date();
    startDate.setHours(0);
    startDate.setMinutes(0);
    startDate.setSeconds(0);

    const endDate = new Date();
    endDate.setHours(0);
    endDate.setMinutes(0);
    endDate.setSeconds(0);

    const startDateStr =
      startDate.getFullYear() +
      "-" +
      String(startDate.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(startDate.getDate()).padStart(2, "0") +
      " 00:00:00";
    const endDateStr =
      endDate.getFullYear() +
      "-" +
      String(endDate.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(endDate.getDate()).padStart(2, "0") +
      " 23:59:59";
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .eq(1)
      .find("tr")
      .each(($el, index, $list) => {
        if (index > 1) {
          // skip the first row
          cy.wrap($el)
            .find("td:first() div div:nth-child(2) span span")
            .should(($el) => {
              const date = $el.text();
              expect(date >= startDateStr && date <= endDateStr).to.be.true;
            });
        }
      });
  });

  // TODO: change the last line to '.should('be.visible')' when bug https://github.com/openobserve/openobserve/issues/2210 is fixed
  it("should display SQL query on switching between Menu options & navigating to Logs again", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[aria-label="SQL Mode"]').click({ force: true });
    cy.contains("SELECT * FROM").should("be.visible");
    cy.get('[data-test="menu-link-/-item"]').click({ force: true });
    cy.get('[data-test="menu-link-/logs-item"]').click({ force: true });
    cy.contains("SELECT * FROM").should("be.visible");
  });

  it("should display error when save function is clicked without any VRL function", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickSaveFunctionButton();
    logstests.noFunctionFoundMessage();
  });

  it.skip("should save a function and then delete it", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.wait(2000);
    logstests.enterTextVrlQueryEditor(".a=1");
    logstests.clickSaveFunctionButton();
    logstests.enterFunctionName("e2e_function");
    logstests.clickSavedOkButton();
    cy.wait(4000);
    cy.wait("@functions");
    cy.get('[data-test="menu-link-pipeline-item"]').click({ force: true });
    cy.wait(4000);
    cy.get("tbody")
      .should("be.visible")
      .contains("e2e_function")
      .parent("tr")
      .find('[title="Delete Function"]')
      .click({ force: true });
    cy.get('[data-test="confirm-button"]').click({ force: true });
  });

  it.skip("should display error on adding only blank spaces under function name", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.wait(2000);
    logstests.enterTextVrlQueryEditor(".a=1");
    logstests.clickSaveFunctionButton();
    logstests.enterFunctionName("   ");
    logstests.clickSavedOkButton();
    cy.get(".q-notification__message")
      .contains("Function name is not valid")
      .should("be.visible");
  });

  it.skip("should display error on special characters under function name", () => {
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.wait(2000);
    logstests.enterTextVrlQueryEditor("a=1");
    logstests.clickSaveFunctionButton();
    logstests.enterFunctionName("e2e@@@@@");
    logstests.clickSavedOkButton();
    cy.get(".q-notification__message")
      .contains("Function name is not valid")
      .should("be.visible");
  });

  // TODO: change the last line to '.should('be.visible')' when bug is resolved
  it("should display added function on switching between tabs and again navigate to logs", () => {
    // cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="date-time-relative-6-w-btn"] > .q-btn__content').click({
      force: true,
    });
    applyQueryButton();
    cy.get(
      "#fnEditor > .monaco-editor > .overflow-guard > .monaco-scrollable-element > .lines-content > .view-lines"
    ).type(".a=2");
    applyQueryButton();
    cy.get('[data-test="menu-link-/metrics-item"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="menu-link-/logs-item"]').click({ force: true });
    cy.contains(".a=2").should("be.visible");
  });

  it.skip("should verify if user searches a value and graph appears when user selects SQL toggle and switches off again", () => {
    // Wait for 2 seconds
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    applyQueryButton()
    cy.wait(2000);
    
    logstests.addFeildandSubValue();
    logstests.addsubFeildValue();
    //click on the field
    // get the data from the value variable
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    logstests.addsubFeildValue();
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.clickFeildSubvalue();
    cy.wait(2000);
    logstests.valueAddedOnPlusClick();
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickOnFirstField();
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.addSecondFieldOnEditor();
    logstests.clickOnEqualToButton();
    logstests.bothFieldAddedOnEqualToClick();
    cy.get('[aria-label="SQL Mode"] > .q-toggle__label').click({ force: true });
    applyQueryButton();
    cy.get('[aria-label="SQL Mode"] > .q-toggle__label').click({ force: true });
    cy.get(".q-spinner").should("not.exist");
  });

  it("should  display ingested logs - search logs, navigate on another tab, revisit logs page", () => {
    // cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    applyQueryButton();
    cy.get('[data-test="menu-link-/traces-item"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="menu-link-/logs-item"]').click({ force: true });
    cy.get('[data-test="logs-search-result-bar-chart"]').should("exist");
  });

  it("should redirect to logs after clicking on stream explorer via stream page", () => {
    // cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.wait(1000)
    cy.get('[title="Explore"]:last').click({ force: true });
    cy.url().should("include", "logs");
  });

});
