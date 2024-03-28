///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
import logsdata from "../../../../../test-data/logs_data.json"
// import logsdata from "../../../data/logs_data.json";
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Tabs settings testcases", () => {
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

  //should go to tabs setting tab and click on add tab
  it("should go to tabs setting tab and click on add tab", () => {
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
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })

  //should go to tabs, click on add tab, add its name and save it
  it("should go to tabs, click on add tab, add its name and save it", () => {
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
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-tab-submit"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })

  //should go to tabs setting tab, add name and click on cancel and close it
  it("should go to tabs setting tab, add name and click on cancel and close it", () => {
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
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-cancel"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })
  //should edit tab name and save it 
  it("should edit tab name and save it", () => {
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
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-tab-submit"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-edit-btn"]:first').click({ force: true });
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-panel"]')
      .find('[data-test="dashboard-tab-settings-tab-name-edit"]')
      .clear()
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-name-edit-save"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })

  //should edit tab name and cancel it
  it("should edit tab name and cancel it", () => {
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
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-tab-submit"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-edit-btn"]:first').click({ force: true });
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-panel"]')
      .find('[data-test="dashboard-tab-settings-tab-name-edit"]')
      .clear()
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-name-edit-cancel"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })

  //should drag and drop the tabs
  it.skip("should drag and drop the tabs", () => {
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
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-tab-submit"]').click({force: true});

      // Get the draggable element
      cy.get('[data-test="dashboard-tab-settings-drag-row"]:first').as("draggable");
      cy.wait(1000);
      // Get the droppable area
      cy.get('[data-test="dashboard-tab-settings-drag-row"]:last').as("droppable");
      cy.wait(1000);
      // Trigger dragstart on draggable
      cy.get("@draggable").trigger("dragstart");
      cy.wait(1000);
      // Trigger drop on droppable
      cy.get("@droppable").trigger("drop");

      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })
  //should delete tab, move panels to another tab and delete all panels popup, cancel and confirm it
  it("should delete tab, move panels to another tab and delete all panels popup, cancel and confirm it", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.wait(2000);
      cy.addAreaChartPanel();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.wait(1000);
    cy.contains(
        '[data-test="dashboard-table"] td',
        dashboardData.DashboardName
      ).click({force:true});
      cy.url().should("include", dashboardData.ViewDashboardUrl);
      cy.wait(1000);
      cy.get('[data-test="dashboard-setting-btn"]').click({ force: true })
      cy.wait(2000);
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-tab-submit"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab"]').click({force: true})/
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .find('[data-test="dashboard-add-tab-name"]')
      .type(randomDashboardName);
      cy.wait(1000);
      cy.get('[data-test="dashboard-add-tab-submit"]').click({force: true});
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-delete-btn"]:first').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-delete-tab-panels-move"]').click();
      cy.wait(1000);
      cy.get('[data-test="confirm-button"] > .q-btn__content').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-setting-btn"]').click({ force: true })
      cy.wait(2000);
      cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-delete-btn"]:first').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-delete-tab-panels-delete"]').click();
      cy.wait(1000);
      cy.get('[data-test="cancel-button"]').click({force: true})
      // cy.wait(1000);
      // cy.get('[data-test="dashboard-setting-btn"]').click({ force: true })
      // cy.wait(2000);
      // cy.get('[data-test="dashboard-tab-settings-tab"]').click({force:true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-settings-tab-delete-btn"]:first').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-tab-delete-tab-panels-delete"]').click();
      cy.wait(1000);
      cy.get('[data-test="confirm-button"] > .q-btn__content').click({force: true})
      cy.wait(1000);
      cy.get('[data-test="dashboard-back-btn"]').click({ force: true });  
      cy.wait(2000)
        cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true})
        cy.wait(2000)
        deleteDashboard()
  })


//delete all dashboards
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