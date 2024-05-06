///<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import "cypress-file-upload";
import logsdata from "../../../../test-data/logs_data.json"
// import logsdata from "../../data/logs_data.json";
import { getRandomText } from "../utils";
// import { login } from "../../support/commons"
// import { selectStreamAndStreamType } from "../../support/log-commons";
const { v4: uuidv4 } = require("uuid");

// Generate UUID
const uuid = uuidv4();

// Remove non-alphabetic characters from UUID
const alphaUuid = uuid.replace(/[^a-zA-Z]/g, "");

// Construct function name
const functionName = `automate${alphaUuid}`;

Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Functions testcases", () => {
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
      url: `${Cypress.config().baseUrl}/api/${orgId}/${streamName}/_json`,
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

    cy.visit(
      `web/pipeline/functions?org_identifier=${Cypress.env("ORGNAME")}`
    );

    cy.intercept("GET", "**/api/default/streams**").as("streams");
    // cy.intercept('GET', '**/api/default/_search**').as('allsearch')
  });

  // This is a test case to navigate to the logs page
  it("should display error when creating function without mandatory fields", () => {
    // cy.get('[data-test="menu-link-pipeline-item"]').click({ force: true });
    cy.contains("Create new function").click({ force: true });
    cy.contains("Save").should("be.visible").click({ force: true });
    cy.contains("Field is required").should("be.visible");
  });

  it("should display error on entering invalid name under function and save", () => {
    // cy.get('[data-test="menu-link-pipeline-item"]').click({ force: true });
    cy.contains("Create new function").click({ force: true });
    cy.get(".q-pb-sm > .q-field > .q-field__inner > .q-field__control").type(
      getRandomText
    );
    cy.contains("Save").should("be.visible").click({ force: true });
    cy.contains("Invalid method name.").should("be.visible");
  });

  it("should display error on entering invalid function and save", () => {
    // cy.get('[data-test="menu-link-pipeline-item"]').click({ force: true });
    cy.contains("Create new function").click({ force: true });
    cy.get(".q-pb-sm > .q-field > .q-field__inner > .q-field__control").type(
      functionName
    );
    cy.get(".view-lines").type(".test=1");
    cy.contains("Save").should("be.visible").click({ force: true });
    cy.get(".q-notification__message")
      .contains("Function saved successfully")
      .should("be.visible");
    cy.get('[data-test="functions-list-search-input"]').type(functionName);
    cy.get("tr")
      .contains(functionName)
      .parent("tr")
      .within(() => {
        // Click the delete button
        cy.get('button[title="Delete Function"]').click();
      });
    cy.get('[data-test="confirm-button"] > .q-btn__content').click();
  });

  it("should display error on adding function with same name", () => {
    // cy.get('[data-test="menu-link-pipeline-item"]').click({ force: true });
    cy.contains("Create new function").click({ force: true });
    cy.get(".q-pb-sm > .q-field > .q-field__inner > .q-field__control").type(
      functionName
    );
    cy.get(".view-lines").type(".test=1");
    cy.contains("Save").should("be.visible").click({ force: true });
    cy.get(".q-notification__message")
      .contains("Function saved successfully")
      .should("be.visible");
    cy.contains("Create new function").click({ force: true });
    cy.get(".q-pb-sm > .q-field > .q-field__inner > .q-field__control").type(
      functionName
    );
    cy.get(".view-lines").type(".test=1");
    cy.contains("Save").should("be.visible").click({ force: true });
    cy.get(".q-notification__message")
      .contains("Function creation failed")
      .should("be.visible");
    cy.contains("Cancel").click({ force: true });
    cy.get('[data-test="functions-list-search-input"]').type(functionName);
    cy.get("tr")
      .contains(functionName)
      .parent("tr")
      .within(() => {
        // Click the delete button
        cy.get('button[title="Delete Function"]').click();
      });
    cy.get('[data-test="confirm-button"] > .q-btn__content').click();
  });

  it.skip("should add a function and associate a stream with the same", () => {
    cy.contains("Create new function").click({ force: true });
    cy.get(".q-pb-sm > .q-field > .q-field__inner > .q-field__control").type(
      functionName
    );
    cy.get(".view-lines").type(".test=1");
    cy.contains("Save").should("be.visible").click({ force: true });
    cy.get(".q-notification__message")
      .contains("Function saved successfully")
      .should("be.visible");
    cy.get('[data-test="function-stream-tab"]').click({ force: true });
    cy.wait(2000);
    cy.get('[data-test="stream-association-search-input"]').type(
      "e2e_automate"
    );
    cy.get(
      '[data-test="log-stream-table"] >>> :nth-child(2) > :nth-child(1) > :nth-child(2)'
    ).click();
    // cy.get('[style="cursor: pointer;"] > :nth-child(3)').click({ force: true });
    cy.contains("Associate Function").click({ force: true });
    cy.get(
      '[style="height: min-content; border: 1px solid black;"] > [colspan="100%"] > [style=""] > .q-table__container > .q-table__middle > .q-table > tbody > .q-tr > :nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container'
    ).type(functionName);
    cy.wait(2000);
    cy.get(".q-item__label > span").click({ force: true });
    cy.wait(1000);
    cy.get("tr.q-tr")
      .contains(functionName)
      .parent("tr")
      .within(() => {
        // Click the delete button
        cy.get(
          'button[data-test="stream-association-delete-function-btn"]'
        ).click();
      });
    cy.get(
      '[href="/web/functions/functions?org_identifier=default"] > .q-tab__content'
    ).click({ force: true });
    cy.get('[data-test="functions-list-search-input"]').type(functionName);
    cy.get("tr")
      .contains(functionName)
      .parent("tr")
      .within(() => {
        // Click the delete button
        cy.get('button[title="Delete Function"]').click();
      });
    cy.get('[data-test="confirm-button"] > .q-btn__content').click();
  });

  it("should upload a enrichment table under functions", () => {
    cy.wait(2000);
    // cy.contains('Create new function').click({ force: true })
    cy.get(
      '[data-test="function-enrichment-table-tab"] > .q-tab__content > .q-tab__label'
    ).click({ force: true });
    cy.contains("Add Enrichment Table").click({ force: true });

    const { v4: uuidv4 } = require("uuid");

    cy.fixture("enrichment_info.csv").then((fileContent) => {
      const fileName = `enrichment_info_${uuidv4()}.csv`;

      cy.get('input[type="file"]').attachFile({
        fileContent: fileContent.toString(),
        fileName: fileName,
        mimeType: "text/csv",
      });
      cy.wait(5000);
      cy.get(".q-input > .q-field__inner > .q-field__control").type(fileName);
      cy.contains("Save").click({ force: true });
      cy.wait(3000);
      cy.reload();
      // cy.get('[title="Delete Function"]').click({ force: true });
      // cy.get('[data-test="confirm-button"]').click({ force: true });
      cy.get("tbody tr").each(($row) => {
        const functionName = $row.find("td.text-left:eq(1)").text();
     

        // Check if the function name contains "enrichment_info"
        if (functionName.includes("enrichment_info")) {
          // Click the "Delete Function" button
          cy.wrap($row)
            .find('[title="Delete Function"]') // finds the delete function button and clicks on it
            .click();

          // You may need to handle any confirmation dialog that appears
          cy.get('[data-test="confirm-button"]').click();
        }
      });
    });
  });
});
