///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
import logsdata from "../../../data/logs_data.json"
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
    // function editDashboard(panelname) {
    //     //click on dashboard name
    //     cy.contains(
    //       '[data-test="dashboard-table"] td',
    //       dashboardData.DashboardName
    //     ).click({force:true});
    //     cy.url().should("include", dashboardData.ViewDashboardUrl);
    //     // Click on edit dashboard panel
    //     cy.wait(5000);
    //     cy.get(
    //       '[data-test="dashboard-edit-panel-' + panelname + '-dropdown"]'
    //     ).click({force:true});
    //     cy.get('[data-test="dashboard-edit-panel"]').click();
    //     cy.url().should("include", dashboardData.AddPanel);
    //   }

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
    const basicAuthCredentials = btoa(`${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`);

    
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

    
    it("Delete dashboard", () => {

        dashboardName = `${dashboardData.DashboardName}_${randomNumber}`;
        console.log("==dashboardName==", dashboardName);
        cy.wait('@dashboards')
        cy.contains("New Dashboard").click()
        cy.wait(1000)
        cy.get('[data-test="add-dashboard-name"]').type(dashboardName);
        cy.get('[data-test="dashboard-add-submit"]').click({force:true});
        cy.url().should("include", dashboardData.ViewDashboardUrl);
        cy.wait(300)
        cy.get('.flex.justify-between > :nth-child(1) > .q-btn > .q-btn__content > .q-icon').click({force:true})
        
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
        cy.get('[data-test="confirm-button"]').click({force:true}); // click on the confirm button
        cy.wait(1000)
        cy.reload(); // reload the window
        // cy.get('[data-test="dashboard-table"] td').should(
        // "not.contain",
        // dashboardName
        // ); // check that the dashboard is not available
    });


      it("should not enable Add button on drilldown UI if name is blank", () => {
        cy.addDashboard();
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
        cy.addAreaChartPanel();
        cy.get('[data-test="dashboard-edit-panel-Automated Testing Panel-dropdown"] > .q-btn__content > .q-icon').click({ force: true })
        cy.get('[data-test="dashboard-edit-panel"]').click();
        cy.get("[data-test='dashboard-sidebar']").click();
        cy.get('[data-test="dashboard-addpanel-config-drilldown-add-btn"] > .q-btn__content > .block').click();
        cy.get('[data-test="dashboard-drilldown-folder-select"]').click();
        cy.get('.q-virtual-scroll__content') // Locate the container div
            .contains('div', 'drilldown') // Find the div containing the text 'drilldown'
             .click(); // Click on the div

        cy.get('[data-test="confirm-button"]').should('be.disabled');
    
      });


      it.only("should not enable Add button on drilldown UI if name is blank", () => {
        cy.addDashboard();
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
        cy.addAreaChartPanel();
        cy.get('[data-test="dashboard-edit-panel-Automated Testing Panel-dropdown"] > .q-btn__content > .q-icon').click({ force: true })
        cy.get('[data-test="dashboard-edit-panel"]').click();
        cy.get("[data-test='dashboard-sidebar']").click();
        cy.get('[data-test="dashboard-addpanel-config-drilldown-add-btn"] > .q-btn__content > .block').click();
        cy.get('[data-test="dashboard-drilldown-folder-select"]').click();

        cy.get('.q-virtual-scroll__content') // Locate the container div
            .contains('div', 'Default') // Find the div containing the text 'drilldown'
             .click({force:true}); // Click on the div

        cy.get('[data-test="confirm-button"]').should('be.disabled');
    
      });

      it("Delete All", () => {
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
      });
    
  
        
})
