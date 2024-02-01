///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
import logsdata from "../../../data/logs_data.json";
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Folders testcases", () => {
  let dashboardData;
  let dashboardName;
  const randomFolderName = `folder_${Math.floor(Math.random() * 100000)}`;

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Generate a random number
  const randomNumber = getRandomInt(1000, 9999);

  before(function () {
    cy.fixture("dashboard").then(function (data) {
      dashboardData = data;
    });
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
    cy.intercept("GET", "**/api/default/organizations**").as("allorgs");
    cy.intercept("GET", "/api/default/settings").as("settings");

    cy.intercept("GET", "**/api/default/dashboards**").as("dashboards");
    cy.wait(200)
    cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
    cy.get('[data-test="menu-link-/dashboards-item"]')
      .contains(dashboardData.ModuleDashboard)
      .click();
    cy.get("table.q-table", { timeout: 3000 }).should("be.visible");
    cy.intercept("GET", "**/api/default/folders**").as("folders");
  });

  it("should create and delete a new folder", () => {
    // Create dynamic dashboard name
    cy.wait(1000);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-name"]')
      .click({ force: true })
      .type(randomFolderName);
    cy.get('[data-test="dashboard-folder-add-save"]').click({ force: true });
    cy.wait("@folders");
    cy.get('[data-test="dashboard-delete-folder-icon"]').each(($deleteIcon) => {
        // Get the parent div and click the delete icon
        cy.wrap($deleteIcon).parents('.q-tab').find('[data-test="dashboard-delete-folder-icon"]').click({ force: true });
        cy.get('[data-test="confirm-button"]').click({ force: true });
    });
    cy.wait(100);
    cy.get(".q-notification__message")
      .contains("Folder deleted successfully")
      .should("be.visible");
  });

  it("should create a dashboard within a folder and then delete dashboard and folder", () => {
    // Create dynamic dashboard name
    cy.wait(1000);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-name"]')
      .click({ force: true })
      .type(randomFolderName);
      cy.get('[data-test="dashboard-folder-add-save"]').click({ force: true });
    cy.get('[data-test="dashboard-add"]').click({ force: true });
    cy.contains(randomFolderName).click({ force: true });
    dashboardName = `${dashboardData.DashboardName}_${randomNumber}`;
    cy.wait("@dashboards");
    cy.contains("New Dashboard").click({ force: true });
    cy.wait(1000);
    cy.get('[data-test="add-dashboard-name"]').type(dashboardName);
    cy.get('[data-test="dashboard-add-submit"]').click();
    cy.url().should("include", dashboardData.ViewDashboardUrl);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.contains(randomFolderName).click({ force: true });
    cy.wait(200);
    cy.get('[data-test="dashboard-delete"]:first').click({ force: true });
    cy.get('[data-test="confirm-button"]').click({ force: true });
    cy.wait(200);
    cy.get('[data-test="dashboard-delete-folder-icon"]').each(($deleteIcon) => {
        // Get the parent div and click the delete icon
        cy.wrap($deleteIcon).parents('.q-tab').find('[data-test="dashboard-delete-folder-icon"]').click({ force: true });
        cy.get('[data-test="confirm-button"]').click({ force: true });
    });
    cy.wait(100);
    cy.get(".q-notification__message")
      .contains("Folder deleted successfully")
      .should("be.visible");
  });

  it("should display error if user creates folder with only spaces under folder name", () => {
    // Create dynamic dashboard name
    cy.wait(1000);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-name"]')
      .click({ force: true })
      .type("    ");
    cy.get('[data-test="dashboard-folder-add-save"]').click({ force: true });
    cy.contains("Name is required").should("be.visible");
  });

  it("should click on cancel on folder creation UI", () => {
    // Create dynamic dashboard name
    cy.wait(1000);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-cancel"]').click({ force: true });
    cy.get('[data-test="dashboard-table"] > .q-table__top').should('be.visible')
  });

  it('should create folders and move a dashboard, then delete dashboard and folders', () => {
    // Function to generate a random folder name
    const randomFolderName = 'Folder' + Math.floor(Math.random() * 1000);

    // Create a new folder with a random name
    cy.wait(100);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-name"]')
        .click({ force: true })
        .type(randomFolderName);
    cy.get('[data-test="dashboard-folder-add-save"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-name"]')
        .click({ force: true })
        .type(randomFolderName + "move folder");
    cy.get('[data-test="dashboard-folder-add-save"]').click({ force: true });

    // Go to the newly created folder
    cy.contains(randomFolderName).click({ force: true });

    // Create a dashboard in the new folder
    cy.contains("New Dashboard").click({ force: true });
    cy.wait(1000);
    cy.get('[data-test="add-dashboard-name"]').type('Dashboard in ' + randomFolderName);;
    cy.get('[data-test="dashboard-add-submit"]').click();
    cy.url().should("include", dashboardData.ViewDashboardUrl);
    cy.get('.flex.justify-between > :nth-child(1) > .q-btn > .q-btn__content > .q-icon').click();
    cy.wait(200)

    // Move the dashboard from the new folder to Folder 2
    cy.contains('Dashboard in ' + randomFolderName)
      .parent('tr')
      .within(() => {
      // Click on the Move to another Folder button
        cy.get('[data-test="dashboard-move-to-another-folder"]').click({ force: true });
    });
    cy.get('.items-baseline > .q-field > .q-field__inner > .q-field__control > .q-field__append').click()
    cy.get('.q-virtual-scroll__content').within(() => {
        // Find the specific option and click on it
        cy.contains(randomFolderName + "move folder").click({ force: true });
      });
      cy.get('[data-test="dashboard-folder-move"]').click({ force: true });
      cy.contains(randomFolderName + "move folder").click({ force: true });
      cy.wait(200);
      cy.get('[data-test="dashboard-delete"]:first').click({ force: true });
      cy.get('[data-test="confirm-button"]').click({ force: true });
      cy.wait(200);
      cy.get('[data-test="dashboard-delete-folder-icon"]').each(($deleteIcon) => {
          // Get the parent div and click the delete icon
          cy.wrap($deleteIcon).parents('.q-tab').find('[data-test="dashboard-delete-folder-icon"]').click({ force: true });
          cy.get('[data-test="confirm-button"]').click({ force: true });
      });
      cy.wait(100);
      cy.get(".q-notification__message")
        .contains("Folder deleted successfully")
        .should("be.visible");
      

});
});
