///<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import logsdata from "../../data/logs_data.json";
// import { login } from "../../support/commons"
// import { selectStreamAndStreamType } from "../../support/log-commons";
const randomStreamName = "stream1traces_" + Cypress._.random(0, 9999); // Generate a unique name

Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Streams testcases", () => {
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
    cy.intercept("GET", "**/api/default/streams**").as("streams");
  });

//   // This is a test case to navigate to the logs page
//   it("Navigate to the logs page", () => {
//     // Visit the base URL
//     // cy.visit("/");
//     // // Trigger a mouseover   event on the logs menu link
//     // cy.get('[data-test="menu-link-/logs-item"]').trigger("mouseover");
//     // // Click on the logs menu link that contains the module log data
//     // cy.get('[data-test="menu-link-/logs-item"]')
//     //   .contains(logData.moduleLog)
//     //   .click();
//   });

  // This test checks if the histogram toggle button works correctly by clicking it and verifying that the chart is hidden.

  // This test checks that clicking on the histogram toggle button in SQL mode does not toggle the chart
  it("should display error if blank spaces added under stream name and clicked create stream ", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="add-stream-name-input"]').type('  ')
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.contains('Field is required').should('exist')
    
 
  });

  it("should display error if create stream is clicked without adding name", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.contains('Field is required').should('exist')
  });
  
  it("should create stream with logs stream type", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="add-stream-name-input"]').type(randomStreamName)
    cy.get('[data-test="add-stream-type-input"]').click()
    cy.get('.q-menu').within(() => {
      // Use cy.contains() to find the option with the label "Logs" and click it
      cy.contains('Logs').click()
    })
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.get('[data-test="streams-search-stream-input"]').type(randomStreamName)
    cy.get('[title="Delete"]').click()
    cy.get('.q-card__actions > .bg-primary > .q-btn__content').click({force:true})
    cy.get('.q-notification__message').contains('Stream deleted')
  });

  it("should create stream with metrics stream type and delete", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="add-stream-name-input"]').type(randomStreamName)
    cy.get('[data-test="add-stream-type-input"]').click()
    cy.get('.q-menu').within(() => {
      // Use cy.contains() to find the option with the label "Logs" and click it
      cy.contains('Metrics').click()
    })
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.get('[data-test="streams-search-stream-input"]').type(randomStreamName)
    cy.wait(300)
    cy.get('[title="Delete"]').click()
    cy.get('.q-card__actions > .bg-primary > .q-btn__content').click({force:true})
    cy.get('.q-notification__message').contains('Stream deleted')
  });


  it("should create stream with traces stream type and delete", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="add-stream-name-input"]').type(randomStreamName);
    cy.get('[data-test="add-stream-type-input"]').click();
    cy.get('.q-menu').within(() => {
      cy.contains('Traces').click();
    });
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.get('[data-test="streams-search-stream-input"]').type(randomStreamName);
    cy.wait(300);
    cy.get('[title="Delete"]').click();
    cy.get('.q-card__actions > .bg-primary > .q-btn__content').click({ force: true });
    cy.get('.q-notification__message').contains('Stream deleted');
  });

  it("should create a stream with a field", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="add-stream-name-input"]').type(randomStreamName)
    cy.get('[data-test="add-stream-type-input"]').click()
    cy.get('.q-menu').within(() => {
      // Use cy.contains() to find the option with the label "Logs" and click it
      cy.contains('Logs').click()
    })
    cy.get('[data-test="add-stream-add-field-btn"]').click()
    cy.get('[data-test="add-stream-field-name-input"] > .q-field > .q-field__inner > .q-field__control').type('field1')
    cy.get('[data-test="add-stream-field-type-select-input"] > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click()
    cy.get('.q-virtual-scroll__content').within(() => {
      cy.contains('Inverted Index').click()
    })
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.get('[data-test="streams-search-stream-input"]').type(randomStreamName)
    cy.wait(300)
    cy.get('[title="Delete"]').click()
    cy.get('.q-card__actions > .bg-primary > .q-btn__content').click({force:true})
    cy.get('.q-notification__message').contains('Stream deleted')
  });
  
 
 
 
});
