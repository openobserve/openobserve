///<reference types="cypress" />
import { fieldType } from "../../support/commons";
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Create a new dashboard", () => {
    let dashboardData;
    let dashboardName;

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
        cy.login();
        cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
        cy.get('[data-test="menu-link-/dashboards-item"]')
          .contains(dashboardData.ModuleDashboard)
          .click();
        cy.get("table.q-table", { timeout: 3000 }).should("be.visible");
        
    });

    it("Add dashboard", () => {
        // Create dynamic dashboard name
        dashboardName = `${dashboardData.DashboardName}_${randomNumber}`;
        console.log("==dashboardName==", dashboardName);
        cy.get('[data-test="dashboard-add"]').click();
        cy.get('[data-test="dashboard-name"]').type(dashboardName);
        cy.get('[data-test="dashboard-add-submit"]').click();
        cy.url().should("include", dashboardData.ViewDashboardUrl);
    });

    
    it("Delete dashboard", () => {
        // find the dashboard name and click on the delete dashboard button. We can see that confirm dialog and click on cancel button
        cy.contains('[data-test="dashboard-table"] td', dashboardName) // gives you the cell
        .siblings() // gives you all the other cells in the row
        .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
        .click();
        cy.get('[data-test="dashboard-confirm-dialog"]').should("be.visible"); // check that the dialog is visible
        cy.wait(2000); // wait for 2ms for the dialogues
        cy.get('[data-test="cancel-button"]').click(); // click on the cancel button
        cy.reload(); // reload the window
        cy.get('[data-test="dashboard-table"] td').should(
        "contain",
        dashboardName
        );

        // find the dashboard name and click on the delete dashboard button. we cab see the confirm dialog and click on the confirm button
        cy.contains('[data-test="dashboard-table"] td', dashboardName) // gives you the cell
        .siblings() // gives you all the other cells in the row
        .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
        .click();
        cy.get('[data-test="dashboard-confirm-dialog"]').should("be.visible"); // check that the dialog is visible
        cy.wait(2000); // wait for 2ms for the dialogues
        cy.get('[data-test="confirm-button"]').click(); // click on the confirm button
        cy.wait(1000)
        cy.reload(); // reload the window
        cy.get('[data-test="dashboard-table"] td').should(
        "not.contain",
        dashboardName
        ); // check that the dashboard is not available
    });
        
})
