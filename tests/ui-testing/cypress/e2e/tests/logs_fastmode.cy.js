///<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import logsdata from "../../data/logs_data.json";
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
    cy.get("@search")
      .its("response.body.hits")
      .should("be.an", "array")
      .then((hits) => {
        expect(hits.length).to.be.at.most(20);
        // Add more assertions if needed
  });

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
    cy.wait("@allsearch");
    cy.selectStreamAndStreamTypeForLogs(logData.Stream);
    cy.intercept("GET", "**/api/default/streams**").as("streams");
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
//   it.only("should not toggle chart when clicking on the histogram toggle in the sql mode", () => {
   
//     cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
//       .click() // Click on the editor to focus
//       .type("match_all_indexed('provide_credentials')")
//     cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
//     cy.intercept("POST", logData.applyQuery).as("search");
//     cy.wait(3000);
//     cy.get("[data-test='logs-search-bar-refresh-btn']", {
//       timeout: 2000,
//     }).click({ force: true });
//     // Type the value of a variable into an input field
//     cy.intercept("POST", logData.applyQuery).as("search");
//     cy.wait(3000);

//     // Get the data from the search variable
//     cy.wait("@search").its("response.statusCode").should("eq", 200);
//     cy.get("@search").its("response.body.hits").should("be.an", "array");
//     cy.get("@search").its("response.body.took").should("be.greaterThan", 0);


//     // cy.get('[data-test="logs-search-bar-fast-mode-toggle-btn"]').click()
  
//   });
it.only("should contain options to include, exclude and add field to table under Json", () => {
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




});
