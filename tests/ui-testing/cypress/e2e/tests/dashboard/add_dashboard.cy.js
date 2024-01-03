///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
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
        cy.intercept("*", (req) => {
            delete req.headers["if-none-match"];
          });
      
        cy.login();
        cy.intercept('GET', '**/api/default/organizations**').as('allorgs');
        cy.intercept('GET', '/api/default/settings').as('settings')
        cy.intercept('GET', '/api/default/folders').as('folders')
        cy.intercept('GET', '**/api/default/dashboards**').as('dashboards');
        cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
        cy.get('[data-test="menu-link-/dashboards-item"]')
          .contains(dashboardData.ModuleDashboard)
          .click();
        cy.get("table.q-table", { timeout: 3000 }).should("be.visible")
       
        
    });

    it("Add dashboard", () => {
        // Create dynamic dashboard name
        cy.wait("@allorgs")
        cy.wait('@settings')
        cy.wait('@folders')
        dashboardName = `${dashboardData.DashboardName}_${randomNumber}`;
        console.log("==dashboardName==", dashboardName);
        cy.wait('@dashboards')
        cy.contains("New Dashboard").click()
        cy.wait(1000)
        cy.get('[data-test="dashboard-name"]').type(dashboardName);
        cy.get('[data-test="dashboard-add-submit"]').click();
        cy.url().should("include", dashboardData.ViewDashboardUrl);
    });

    
    it("Delete dashboard", () => {
        cy.wait("@allorgs")
        cy.wait('@settings')
        cy.wait('@folders')
        dashboardName = `${dashboardData.DashboardName}_${randomNumber}`;
        console.log("==dashboardName==", dashboardName);
        cy.wait('@dashboards')
        cy.contains("New Dashboard").click()
        cy.wait(1000)
        cy.get('[data-test="dashboard-name"]').type(dashboardName);
        cy.get('[data-test="dashboard-add-submit"]').click();
        cy.url().should("include", dashboardData.ViewDashboardUrl);
        cy.get('.q-pa-sm > :nth-child(1) > .q-btn > .q-btn__content > .q-icon').click({force:true})
        
        // find the dashboard name and click on the delete dashboard button. We can see that confirm dialog and click on cancel button

        // cy.contains('[data-test="dashboard-table"] td', dashboardName) // gives you the cell
        cy.get('[data-test="dashboard-delete"]:first').click({force:true})
        // cy.get('tbody > :nth-child(1) > :nth-child(2)')
        // .siblings() // gives you all the other cells in the row
        // .find(':nth-child(1) >> [data-test="dashboard-delete"]:first') // finds the delete button and clicks on it
        // .click();
        cy.get('[data-test="dashboard-confirm-dialog"]').should("be.visible"); // check that the dialog is visible
        cy.wait(2000); // wait for 2ms for the dialogues
        cy.get('[data-test="cancel-button"]').click(); // click on the cancel button
        cy.reload(); // reload the window
        // TODO: Change locator ID here
        // cy.get('[data-test="dashboard-table"] td').should(
        // "contain",
        // dashboardName
        // );
        // TODO: Change locator ID here
        // find the dashboard name and click on the delete dashboard button. we cab see the confirm dialog and click on the confirm button
        // cy.contains('[data-test="dashboard-table"] td', dashboardName) // gives you the cell
        // .siblings() // gives you all the other cells in the row
        // .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
        // .click();
        cy.get('[data-test="dashboard-delete"]:first').click({force:true})
        cy.get('[data-test="dashboard-confirm-dialog"]').should("be.visible"); // check that the dialog is visible
        cy.wait(2000); // wait for 2ms for the dialogues
        cy.get('[data-test="confirm-button"]').click(); // click on the confirm button
        cy.wait(1000)
        cy.reload(); // reload the window
        // cy.get('[data-test="dashboard-table"] td').should(
        // "not.contain",
        // dashboardName
        // ); // check that the dashboard is not available
    });


    it("should display save button disabled if dashboard name is blank", () => {
        cy.wait("@allorgs")
        cy.wait('@settings')
        cy.wait('@folders')
        cy.wait('@dashboards')
        cy.contains("New Dashboard").click()
        cy.wait(1000)
        cy.get('[data-test="dashboard-name"]').type('     ');
        cy.get('[data-test="dashboard-add-submit"]').should('be.disabled');
    });
        
})
