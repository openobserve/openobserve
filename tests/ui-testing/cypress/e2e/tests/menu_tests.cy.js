///<reference types="cypress" />
import * as menutests from "../allfunctions/menufunctions";
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
    applyQueryButton()
    cy.intercept("GET", "**/api/default/streams**").as("streams")
    cy.intercept('GET', '/api/default/e2e_automate/_values?').as('getValues')

    
  });

  // This test checks if menu items load and pag url is updated as per menu
  it.skip("Should  click on all options under Menu", () => {
    cy.get('.q-list').should('be.visible')
    // cy.get('.q-drawer__content > .q-list').should('be.visible')
    cy.get('[data-test="menu-link-/logs-item"]').click({force:true})
    cy.url().should("include", "logs")
    cy.get('[data-test="logs-search-bar-show-histogram-toggle-btn"]').should('be.visible')
    cy.get('[data-test="menu-link-/metrics-item"]').click({ force: true })
    cy.intercept("POST", logData.applyQuery).as("search");
    cy.url().should("include", "metrics")
    cy.contains('Add to dashboard').should('be.visible')
    cy.get('[data-test="menu-link-/traces-item"]').click({ force: true })
    cy.url().should("include", "traces")
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content').should('be.visible')
    cy.contains('Dashboard').click({ force: true })
    cy.url().should("include", "dashboard")
    cy.get('[data-test="dashboard-add"]').should('be.be.visible')
    cy.wait(2000)
    cy.get('[data-test="menu-link-/functions-item"]').click({ force: true })
    cy.url().should("include", "functions")
    cy.contains('Create new function').should('be.visible')
    cy.wait(2000)
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.url().should("include", "dashboards")
    cy.get('[data-test="dashboard-add"]').should('be.visible')
    cy.wait(2000)
    cy.get('[data-test="menu-link-/streams-item"]').click()
    cy.url().should("include", "streams")
    cy.get('[data-test="log-stream-refresh-stats-btn"]').should('be.visible')
    cy.get('[data-test="menu-link-/alerts-item"]').click({ force: true })
    cy.url().should("include", "alerts")
    cy.get('[data-test="alert-list-add-alert-btn"]').should('be.visible')
    cy.get('[data-test="menu-link-/ingestion-item"]').click({ force: true })
    cy.url().should("include", "ingestion")
    cy.contains('Reset Token').should('be.visible')
    cy.get('[data-test="menu-link-/iam-item"]').click({ force: true })
    cy.url().should("include", "users")
    cy.get('[data-test="iam-users-tab"]').should('be.visible')

  });

});