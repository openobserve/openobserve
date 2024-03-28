//<reference types="cypress" />
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
    cy.intercept("GET", "**/api/default/streams**").as("streams");
  });
  it("should click on interesting fields icon and display query in editor", () => {
    cy.get('[data-cy="index-field-search-input"]').type('_timestamp')
    cy.wait(2000)
    cy.get('.field-container').find('[data-test="log-search-index-list-interesting-_timestamp-field-btn"]:last').click({force:true});
    cy.get('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    cy.get('[data-test="logs-search-bar-query-editor"]').contains('_timestamp');
  });
  it("should display quick mode toggle button", () => {
    cy.get('[data-test="logs-search-bar-quick-mode-toggle-btn"]').should("be.visible")  
  });

  it("should click on interesting fields icon in histogram mode and run query", () => {
    cy.get('[data-cy="index-field-search-input"]').type('_timestamp')
    cy.wait(2000)
    cy.get('.field-container').find('[data-test="log-search-index-list-interesting-_timestamp-field-btn"]:last').click({force:true});
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content').click();
    cy.get('[data-test="log-table-column-0-source"]').contains('_timestamp');
  });

  it("should display error on entering random text in histogram mode when quick mode is on", () => {
    cy.get('[data-test="logs-search-bar-query-editor"]').type('oooo')
    cy.wait(2000)
    // cy.get('.field-container').find('[data-test="log-search-index-list-interesting-_timestamp-field-btn"]:last').click({force:true});
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content').click();
    cy.get('[data-test="logs-search-error-message"]').contains('Error: Search field not found.');
  });

  it("should click on interesting fields icon and display query in editor", () => {

    cy.get('.field-container').find('[data-test="log-search-index-list-interesting-_timestamp-field-btn"]:last').click({force:true});
    cy.get('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    cy.get('[data-test="logs-search-bar-query-editor"]').contains('_timestamp');
  });
})  