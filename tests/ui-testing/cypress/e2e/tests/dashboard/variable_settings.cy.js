///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
import logsdata from "../../../../../test-data/logs_data.json"
// import logsdata from "../../../data/logs_data.json";
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Settings testcases", () => {
  let dashboardData;
  let dashboardName;
  const randomDashboardName = `dashboard_${Math.floor(Math.random() * 100000)}`;

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
  function deleteDashboard(){
    cy.get('[data-test="dashboard-table"]')
    .find("td")
    .filter((index, element) =>
      Cypress.$(element).text().includes(dashboardData.DashboardName)
    )
    .each((item) => {
      console.log("==", item);
      // cy.wrap(item).contains(dashboardData.DashboardName).then(($el)=>{
      cy.wrap(item)
        .siblings()
        .wait(2000)
        .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
        .click({ force: true });
      cy.get('[data-test="confirm-button"]').click();
      // })
    });
}
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

  //in view dashboard click on setting
  it("should click on settings icon", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.contains(
        '[data-test="dashboard-table"] td',
        dashboardData.DashboardName
      ).click({force:true});
      cy.url().should("include", dashboardData.ViewDashboardUrl);
      cy.wait(1000);
      cy.get('[data-test="dashboard-setting-btn"]').click({ force: true })
      cy.wait(1000);
      cy.get('[data-test="close-dashboard-settings-popup"]').click({force:true})
      cy.wait("@dashboards");
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  });

  //should go to variables setting tab and click on add variable
  it("should go to variables setting tab and click on add variable", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.contains(
        '[data-test="dashboard-table"] td',
        dashboardData.DashboardName
      ).click({force:true});
      cy.url().should("include", dashboardData.ViewDashboardUrl);
      cy.wait(1000);
      cy.get('[data-test="dashboard-setting-btn"]').click({ force: true })
      cy.wait(2000);
      cy.get('[data-test="dashboard-variable-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-variables-settings-add-variable"]').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })

// should go to variables setting tab and click on add variable and from dropdown select query values and check its UI
// should go to variables setting tab and click on add variable and from dropdown select constant and check its UI
// should go to variables setting tab and click on add variable and from dropdown select textbox and check its UI
// should go to variables setting tab and click on add variable and from dropdown select custom and check its UI
// should go to variables setting tab and click on add variable and cancel in UI
// should go to variables setting tab and add all variables once and try to edit and delete it
  it.skip("Delete All", () => {
    cy.get('[data-test="dashboard-table"]')
      .find("td")
      .filter((index, element) =>
        Cypress.$(element).text().includes(dashboardData.DashboardName)
      )
      .each((item) => {
        console.log("==", item);
        // cy.wrap(item).contains(dashboardData.DashboardName).then(($el)=>{
        cy.wrap(item)
          .siblings()
          .wait(2000)
          .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
          .click({ force: true });
          cy.wait(1000);
        cy.get('[data-test="confirm-button"]').click();
        // })
      });
  });
})