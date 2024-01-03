///<reference types="cypress" />
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
export const fieldType = {
  X: "x",
  Y: "y",
  F: "filter",
};
let dashboardData;
let logsData;
before(function () {
  cy.fixture("dashboard").then(function (data) {
    dashboardData = data;
  });
  cy.fixture("logs").then(function (data) {
    logsData = data;
  });
});
Cypress.Commands.add("addDashboardPanel", () => {
  cy.contains(
    '[data-test="dashboard-table"] td',
    dashboardData.DashboardName
  ).click();
  cy.url().should("include", dashboardData.ViewDashboardUrl);
  cy.get('[data-test="dashboard-panel-add"]').click();
  cy.url().should("include", dashboardData.AddPanel);
});
Cypress.Commands.add("addFieldToAxis", (type, streamType, stream, field) => {
  cy.get("[data-test='index-field-search-input']").click().type(field);
  cy.get(
    `[data-test="field-list-item-${streamType}-${stream}-${field}"]`
  ).trigger("mouseover");
  cy.get(
    `[data-test="field-list-item-${streamType}-${stream}-${field}"] [data-test="dashboard-add-${type}-data"]`
  ).click();
   cy.get("[data-test='index-field-search-input']").clear();
});
Cypress.Commands.add("selectStream", (stream,streamType) => {
  cy.wait(2000);
  cy.get('[data-test="index-dropdown-stream_type"]').click();
  cy.get("div.q-item").contains(`${streamType}`).click();
  cy.get('[data-test="index-dropdown-stream"]').click();
  cy.get("div.q-item").contains(`${stream}`).click();
});
Cypress.Commands.add("addAndSavePanel", () => {
  cy.intercept("POST", dashboardData.SearchQuery).as("search");
  cy.get('[data-test="dashboard-apply"]').click({force:true});
  cy.get('[data-test="dashboard-error"]').should("not.exist");
  cy.wait("@search",{timeout:8000}).its("response.statusCode").should("eq",200);
  cy.get("@search").its("response.body.hits").should("be.an","array");
  // cy.wait("@search").then(({ response }) => {
  //   expect(response.statusCode).to.eq(200);
  //   expect(response.body.hits).to.be.an("array");
  // });
  cy.get("#chart1").should("exist").and("be.visible");
  cy.get('[data-test="dashboard-panel-name"]').type(
    dashboardData.DashboardPanelName
  );
  cy.get('[data-test="dashboard-panel-save"]').click();
  cy.url().should("include", dashboardData.ViewDashboardUrl);
});
Cypress.Commands.add("editAndSavePanel", () => {
  cy.intercept("POST", dashboardData.SearchQuery).as("search");
  cy.get('[data-test="dashboard-apply"]').click();
  cy.wait(2000);
  cy.get('[data-test="dashboard-error"]').should("not.exist");
  cy.wait("@search").its("response.statusCode").should("eq",200);
  cy.get("@search").its("response.body.hits").should("be.an","array");
  // cy.wait("@search").then(({ response }) => {
  //   expect(response.statusCode).to.eq(200);
  //   expect(response.body.hits).to.be.an("array");
  // });
  cy.get("#chart1").should("exist").and("be.visible");
  cy.get('[data-test="dashboard-panel-name"]')
    .clear()
    .type(dashboardData.EditPanelName);
  cy.get('[data-test="dashboard-panel-save"]').click();
  cy.url().should("include", dashboardData.ViewDashboardUrl);
});
// function addDashboard() {}
// function selectStream(stream) {}
// function addFieldToAxis(type, streamType, stream, field) {}
Cypress.Commands.add("login", () => {
  Cypress.on("uncaught:exception", (err, runnable) => {
    return false;
  });
  // Alpha login
  cy.session(Cypress.env("EMAIL"), () => {
    cy.visit(Cypress.env("BASEURL"));
    cy.wait(1000);
    cy.get('[data-cy="login-user-id"]').type(Cypress.env("EMAIL"));
    //Enter Password
    cy.get('[data-cy="login-password"]').type(Cypress.env("PASSWORD"));
    cy.get('[data-cy="login-sign-in"]').click();
    cy.wait(4000);
  });
  cy.visit(Cypress.env("BASEURL"));
});
// TODO: need to delete this function after completing all the test cases
Cypress.Commands.add("addDashboard", () => {
  cy.wait(2000);
  cy.get('[data-test="dashboard-add"]').click({force:true});
  cy.get('[data-test="dashboard-name"]').type(dashboardData.DashboardName);
  cy.get('[data-test="dashboard-add-submit"]').click();
  cy.url().should("include", dashboardData.ViewDashboardUrl);
});
Cypress.Commands.add("addAreaChartPanel", () => {
  cy.addDashboardPanel();
  cy.get(
    `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
  ).click();
  cy.selectStream(dashboardData.Stream, dashboardData.StreamType);
  cy.addFieldToAxis(
    fieldType.X,
    dashboardData.StreamType,
    dashboardData.Stream,
    dashboardData.fields.XAxisValue1
  );
  cy.addFieldToAxis(
    fieldType.Y,
    dashboardData.StreamType,
    dashboardData.Stream,
    dashboardData.fields.YAxisValue1
  );
  cy.addAndSavePanel();
});

Cypress.Commands.add("testingaddAreaChartPanel", () => {
  cy.addDashboardPanel();
  cy.get(
    `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
  ).click();
  cy.selectStream(dashboardData.Stream);
  cy.addFieldToAxis(
    fieldType.X,
    dashboardData.StreamType,
    dashboardData.Stream,
    dashboardData.addValues.XAxisValue1
  );
  cy.addFieldToAxis(
    fieldType.Y,
    dashboardData.StreamType,
    dashboardData.Stream,
    dashboardData.addValues.YAxisValue1
  );
  cy.addAndSavePanel();
});

Cypress.Commands.add("selectStreamAndStreamTypeForLogs", (stream) => {
  cy.wait(4000);
  cy.get('[data-test="log-search-index-list-select-stream"]').click({force:true});
  cy.get("div.q-item").contains(`${stream}`).click({force:true});
});


