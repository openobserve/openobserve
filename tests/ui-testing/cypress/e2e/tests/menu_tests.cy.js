///<reference types="cypress" />
import * as menutests from "../allfunctions/menufunctions";
// import { login } from "../../support/commons"
// import { selectStreamAndStreamType } from "../../support/log-commons";

Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Sanity testcases", () => {
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
    cy.login();
  });


  // This test checks if menu items load and pag url is updated as per menu
  it.skip("Should  click on all options under Menu", () => {
    menutests.menuDisplayed()
    // cy.get('.q-drawer__content > .q-list').should('be.visible')
    cy.get('[data-test="menu-link-/logs-item"]').click({force:true})
    cy.url().should("include", "logs")
    cy.get('[data-test="logs-search-bar-show-histogram-toggle-btn"]').should('be.visible')
    cy.contains('Metrics').click({ force: true })
    cy.intercept("POST", logData.applyQuery).as("search");
    cy.url().should("include", "metrics")
    cy.contains('Add to dashboard').should('be.visible')
    cy.contains('Traces').click({ force: true })
    cy.url().should("include", "traces")
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content').should('be.visible')
    cy.contains('Dashboard').click({ force: true })
    cy.url().should("include", "dashboard")
    cy.get('[data-test="dashboard-add"]').should('be.be.visible')
    cy.contains('Functions').click({ force: true })
    cy.url().should("include", "functions")
    cy.contains('Create new function').should('be.visible')
    cy.contains('Streams').click({ force: true })
    cy.url().should("include", "logstreams")
    cy.get('[data-test="log-stream-refresh-stats-btn"]').should('be.visible')
    cy.contains('Alerts').click({ force: true })
    cy.url().should("include", "alerts")
    cy.get('[data-test="alert-list-add-alert-btn"]').should('be.visible')
    cy.contains('Ingestion').click({ force: true })
    cy.url().should("include", "ingestion")
    cy.contains('Reset Token').should('be.visible')
    cy.contains('Users').click({ force: true })
    cy.url().should("include", "users")
    cy.contains('Add User').should('be.visible')

  });

});
