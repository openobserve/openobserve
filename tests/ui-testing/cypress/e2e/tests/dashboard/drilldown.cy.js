///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
import {getRandomText } from "../../utils";
import logsdata from "../../../../../test-data/logs_data.json"
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Drilldown testcases", () => {
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
    const basicAuthCredentials = btoa(`${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`);

    
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

    
    it.skip("Delete dashboard", () => {

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
        cy.get('[data-test="dashboard-drilldown-folder-select"]').click({force: true});
        cy.get(".q-item__label").contains("default").click({force: true});

        cy.get('[data-test="confirm-button"]').should('be.disabled');
        cy.get('[data-test="dashboard-panel-save"]').click( {force: true});
        cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
    
      });


      it("should save the drilldown successfully", () => {
        cy.addDashboard();
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
        cy.addAreaChartPanel();
        cy.get('[data-test="dashboard-edit-panel-Automated Testing Panel-dropdown"] > .q-btn__content > .q-icon').click({ force: true })
        cy.get('[data-test="dashboard-edit-panel"]').click();
        cy.get("[data-test='dashboard-sidebar']").click();
        cy.get('[data-test="dashboard-addpanel-config-drilldown-add-btn"] > .q-btn__content > .block').click();
        cy.get('[data-test="dashboard-drilldown-folder-select"]').click();

        cy.get(".q-item__label").contains("default").click();
        
        cy.get('[data-test="dashboard-config-panel-drilldown-name"]').type('drilldown');
        cy.wait(3000)

        cy.get('[data-test="confirm-button"]').should('be.visible').click();
        cy.get('[data-test="dashboard-addpanel-config-drilldown-name-0"]').should('contain', 'drilldown');
        cy.get('[data-test="dashboard-panel-save"]').click();
        cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
        cy.wait(2000)
        deleteDashboard()
   
    
      });

      it.skip("should save the drilldown successfully", () => {
        cy.addDashboard();
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
        cy.addAreaChartPanel();
        cy.get('[data-test="dashboard-edit-panel-Automated Testing Panel-dropdown"] > .q-btn__content > .q-icon').click({ force: true })
        cy.get('[data-test="dashboard-edit-panel"]').click();
        cy.get("[data-test='dashboard-sidebar']").click();
        cy.get('[data-test="dashboard-addpanel-config-drilldown-add-btn"] > .q-btn__content > .block').click();
        cy.get('[data-test="dashboard-drilldown-folder-select"]').click();

        cy.get(".q-item__label").contains("default").click();
        
        cy.get('[data-test="dashboard-config-panel-drilldown-name"]').type('drilldown');
        cy.get('[data-test="dashboard-drilldown-variable-name-0"]').type('test');
        cy.get('[data-test="dashboard-drilldown-variable-value-0"]').type('${var-test}',{parseSpecialCharSequences: false})
        
        cy.wait(2000)

        cy.get('[data-test="confirm-button"]').should('be.visible').click();
        cy.get('[data-test="dashboard-addpanel-config-drilldown-name-0"]').should('contain', 'drilldown');
        cy.get('[data-test="dashboard-panel-save"]').click();
        cy.wait(2000)
        cy.get("xpath///*[@data-test=\"date-time-btn\"]/span[2]").click();
        cy.get("[data-test='date-time-absolute-tab'] > span.q-btn__content").click();
        cy.get("div:nth-of-type(27) span.q-btn__content > span").click();
        cy.get('canvas[data-zr-dom-id="zr_0"]').then($canvas => {
            const canvas = $canvas[0];
            // Coordinates of the drilldown dot within the canvas
            const dotX = 100; // Adjust this value according to the dot's X coordinate
            const dotY = 100; // Adjust this value according to the dot's Y coordinate
          
            // Create a custom event object with the coordinates
            const event = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: dotX,
              clientY: dotY
            });
          
            // Dispatch the click event on the canvas element
            canvas.dispatchEvent(event);
          });
          
        // cy.get('canvas[data-zr-dom-id="zr_0"]').then($canvas => {
        //     const canvas = $canvas[0];
        //     const rect = canvas.getBoundingClientRect(); // Get the position of the canvas relative to the viewport
        //     const x = rect.left + canvas.width / 2; // Adjust X coordinate as needed
        //     const y = rect.top + canvas.height / 2; // Adjust Y coordinate as needed
          
        //     cy.wrap(canvas).trigger('mousedown', { button: 0, clientX: x, clientY: y })
        //                   .trigger('mouseup', { button: 0, clientX: x, clientY: y });
        //   });
        // cy.wait(2000)
        // cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
        // cy.wait(2000)
        // deleteDashboard()
   
    
      });
})