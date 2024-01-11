//<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import logsdata from "../../data/logs_data.json";
// import { login } from "../../support/commons"
// import { selectStreamAndStreamType } from "../../support/log-commons";

Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Alerts testcases", () => {
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
    cy.visit(`web/alerts/templates??org_identifier=${Cypress.env("ORGNAME")}`);
    // cy.intercept('GET', '**/api/default/_search**').as('allsearch')
  });

  it("should display Create template on destination page and clicking on it to navigate template page", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.contains("Create Template").should("be.visible").click({ force: true });
    cy.contains("Add Template").should("be.visible");
  });

  it("should display Create template on alerts page and clicking on it to navigate template page", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-alerts-tab"]').click({ force: true });
    cy.wait(100);
    cy.contains("Create Template").should("be.visible").click({ force: true });
    cy.contains("Add Template").should("be.visible");
  });

  // This test checks if the histogram toggle button works correctly by clicking it and verifying that the chart is hidden.
  it("should display error when body not added under templates", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true,
    });
    cy.wait(100);
    cy.get('[data-test="add-template-name-input"]').type("test");
    cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Please fill required fields")
      .should("be.visible");
  });

  it("should display error when body added but name left blank under templates", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true,
    });
    cy.wait(100);
    cy.get(".view-line").type("test");
    cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Please fill required fields")
      .should("be.visible");
  });

  it("should display error only blank spaces added under  template name", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true,
    });
    cy.wait(100);
    cy.get('[data-test="add-template-name-input"]').type("    ");
    cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
    cy.contains("Field is required").should("be.visible");
    cy.get(".q-notification__message")
      .contains("Please fill required fields")
      .should("be.visible");
  });

  it("should saved template successfully", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true,
    });
    cy.wait(100);
    cy.get('[data-test="add-template-name-input"]').type("automationalert");
    const jsonString = '{"text": "{alert_name} is active"}';
    cy.get(".view-line").type(jsonString, { parseSpecialCharSequences: false });
    cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Template Saved Successfully")
      .should("be.visible");
  });

  it("should display error when valid JSON not entered under template body", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true,
    });
    cy.wait(100);
    cy.get('[data-test="add-template-name-input"]').type("test");
    cy.get(".view-line").type("test");
    cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Please enter valid JSON")
      .should("be.visible");
  });

  it("should click on add destination button and display error if user clicks directly on save", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
      force: true,
    });
    cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Please fill required fields")
      .should("be.visible");
  });

  it("should display error if name has only spaces under destination", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
      force: true,
    });
    cy.get('[data-test="add-destination-name-input"]').type("    ");
    cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
    cy.contains("Field is required").should("be.visible");
    cy.get(".q-notification__message")
      .contains("Please fill required fields")
      .should("be.visible");
  });

  it("should display error if name has only spaces under destination", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
      force: true,
    });
    cy.get('[data-test="add-destination-name-input"]').type("    ");
    cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
    cy.contains("Field is required").should("be.visible");
    cy.get(".q-notification__message")
      .contains("Please fill required fields")
      .should("be.visible");
  });

  it("should add destination successfully", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
      force: true,
    });
    cy.get('[data-test="add-destination-name-input"]').type("cy-destination");
    cy.get('[data-test="add-destination-template-select"]').click({
      force: true,
    });
    cy.contains(".q-item__label span", "automationalert").click();
    cy.get('[data-test="add-destination-url-input"]').type(
      "https://slack.com/api"
    );
    cy.get('[data-test="add-destination-method-select"]').click({
      force: true,
    });
    cy.get(".q-menu").should("be.visible");
    cy.contains(".q-item__label span", "get").click();
    cy.get(".q-toggle__inner").click({ force: true });
    cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Destination saved successfully")
      .should("be.visible");
    // cy.get('tbody tr').each(($row) => {
    // Delete each row
    // cy.wrap($row).find('[data-test*="-delete-destination"]').click();
    // cy.get('[data-test="confirm-button"]').click({ force: true });
    // });
  });

  it("should click cancel button under destinations", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
      force: true,
    });
    cy.get('[data-test="add-destination-name-input"]').type("cy-destination");
    cy.get('[data-test="add-destination-cancel-btn"]').click({ force: true });
    cy.get('[data-test="alert-destinations-tab"]').should("be.visible");
  });

  it("should display error when stream name is not added under alerts", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-alerts-tab"]').click({ force: true });
    cy.get('[data-test="alert-list-add-alert-btn"]').click({ force: true });
    cy.get('[data-test="add-alert-name-input"]').type("cy-alert");
    cy.get(
      ".alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon"
    ).click({ force: true });
    // Find and click on the item with text 'logs'
    cy.contains(".q-item__label", "logs").click({ force: true });
    cy.get('[data-test="add-alert-submit-btn"]').click({ force: true });
    cy.contains("Field is required").should("be.visible");
  });


  it("should display error when directly Save button clicked on alerts page", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-alerts-tab"]').click({ force: true });
    cy.get('[data-test="alert-list-add-alert-btn"]').click({ force: true });
    cy.get('[data-test="add-alert-submit-btn"]').click({ force: true });
    cy.contains("Field is required").should("be.visible");
  });

  it("should create template, destination, logs-alerts and then delete all successfully", () => {
    cy.wait(2000);
    cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true,
    });
    cy.wait(100);
    cy.get('[data-test="add-template-name-input"]').type("automationalert");
    const jsonString = '{"text": "{alert_name} is active"}';
    cy.get(".view-line").type(jsonString, { parseSpecialCharSequences: false });
    cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Template Saved Successfully")
      .should("be.visible");
    cy.wait(2000);
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
      force: true,
    });
    cy.get('[data-test="add-destination-name-input"]').type("cy-destination");
    cy.get('[data-test="add-destination-template-select"]').click({
      force: true,
    });
    cy.contains(".q-item__label span", "automationalert").click();
    cy.get('[data-test="add-destination-url-input"]').type(
      "https://slack.com/api"
    );
    cy.get('[data-test="add-destination-method-select"]').click({
      force: true,
    });
    cy.get(".q-menu").should("be.visible");
    cy.contains(".q-item__label span", "get").click();
    cy.get(".q-toggle__inner").click({ force: true });
    cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
    cy.get(".q-notification__message")
      .contains("Destination saved successfully")
      .should("be.visible");
    cy.wait(2000);
    cy.get('[data-test="alert-alerts-tab"]').click({ force: true });
    cy.get('[data-test="alert-list-add-alert-btn"]').click({ force: true });
    cy.get('[data-test="add-alert-name-input"]').type("cy-alert");
    cy.get(
      ".alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon"
    ).click({ force: true });
    // Find and click on the item with text 'logs'
    cy.contains(".q-item__label", "logs").click({ force: true });
    cy.get(
      ":nth-child(3) > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon"
    ).click({ force: true });
    cy.contains(".q-item__label", "e2e_automate").click();
    cy.get('[data-test="add-alert-scheduled-alert-radio"]').click({
      force: true,
    });
    cy.get(
      ".q-mt-md > .justify-start > :nth-child(1) > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon"
    ).click({ force: true });
    cy.contains(".q-item__label", "kubernetes_labels_role").click();
    cy.get(
      ".q-mt-md > .justify-start > :nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon"
    ).click({ force: true });
    cy.contains(".q-item__label", "=").click();
    cy.get('.justify-start > .flex > .q-field').type("200");
    cy.get(
      ":nth-child(5) > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon"
    ).click({ force: true });
    cy.contains(".q-item__label", "cy-destination").click();
    cy.get('[data-test="add-alert-submit-btn"]').click({ force: true });
    cy.get('[data-test$="-delete-alert"]').first().scrollIntoView();
    cy.get('[data-test$="-delete-alert"]').first().click();
    cy.get('[data-test="cancel-button"] ').click({ force: true });
    cy.get('[data-test$="-delete-alert"]').each(($button) => {
      cy.wrap($button).click();
      cy.get('[data-test="confirm-button"]').click({ force: true });
    });
    cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
    cy.get("tbody tr").each(($row) => {
      // Delete each row
      cy.wrap($row).find('[data-test*="-delete-destination"]').click();
      cy.get('[data-test="confirm-button"]').click({ force: true });
    });
    cy.get('[data-test="alert-templates-tab"]').click({ force: true });
    cy.get('tbody [data-test$="-delete-template"]').each(($button) => {
      cy.wrap($button).click();
      cy.get('[data-test="confirm-button"]').click({ force: true });
    });
  });
});
