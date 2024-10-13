///<reference types="cypress" />
// import logsdata from "../../../data/logs_data.json";
import logsdata from "../../../../../test-data/logs_data.json"

import { fieldType } from "../../../support/commons";
Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});

describe("Create a new dashboard", () => {
  let dashboardData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  before(function () {
    cy.fixture("dashboard").then(function (data) {
      dashboardData = data;
    });
  });
  beforeEach(() => {
    cy.intercept("*", (req) => {
      delete req.headers["if-none-match"];
    });

    // cy.origin(Cypress.env('CYPRESS_BASEURL'),{args:{dashboardData}},({dashboardData})=>
    //   {
    cy.login();
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

    cy.wait(4000);
    cy.intercept("GET", "**/api/default/organizations**").as("allorgs");
    cy.intercept("GET", "/api/default/settings").as("settings");
    cy.intercept("GET", "/api/default/folders").as("folders");
    cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
    cy.get('[data-test="menu-link-/dashboards-item"]')
      .contains(dashboardData.ModuleDashboard)
      .click();
    // cy.wait(2000)
    // cy.get('[data-test="menu-link-/dashboards-item"]').click();
    //   .contains(dashboardData.ModuleDashboard)

    cy.get("table.q-table", { timeout: 3000 }).should("be.visible");

    //   })
  });

  //   it("Add dashboard", () => {
  //     cy.addDashboard();
  //   });

  it.skip("Add area chart panel", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.wait(2000);
    cy.addAreaChartPanel();
  });

  it.skip("Add panel errors without fields", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.wait(2000);
    cy.addDashboardPanel();
    cy.get('[data-test="dashboard-apply"]').click();
    cy.get('[data-test="dashboard-error"]').should("exist");
  });

  it.skip("drag and drop element", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.wait(2000);
    cy.addDashboardPanel();
    cy.get(
      `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
    ).click();
    cy.selectStream(dashboardData.Stream, dashboardData.StreamType);
    cy.get("[data-test='index-field-search-input']")
      .click()
      .clear()
      .type(dashboardData.fields.XAxisValue1);
    // Get the draggable element
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-${dashboardData.fields.XAxisValue1}"] [data-test="dashboard-add-data-indicator"]`
    ).as("draggable");

    // Get the droppable area
    cy.get('[data-test="dashboard-x-layout"]').as("droppable");

    cy.get("@draggable").trigger("dragstart");
    cy.get("@droppable").trigger("drop");

    //cy.wait(5000);
    cy.get('[data-test="dashboard-x-layout"]').should("contain", "_timestamp");

    //---------------------------------------------------------
    // Get the draggable element
    cy.get("[data-test='index-field-search-input']")
      .click()
      .clear()
      .type(dashboardData.fields.YAxisValue2);
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-${dashboardData.fields.YAxisValue2}"] [data-test="dashboard-add-data-indicator"]`
    ).as("draggable");

    // Get the droppable area
    cy.get('[data-test="dashboard-y-layout"]').as("droppable");

    cy.get("@draggable").trigger("dragstart");
    cy.get("@droppable").trigger("drop");

    //cy.wait(3000);
    cy.get('[data-test="dashboard-y-layout"]').should(
      "contain",
      dashboardData.fields.YAxisValue2
    );
    cy.addAndSavePanel();
  });

  it.skip("Verify query generation on the when fields are added and removed from axis", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.wait(2000);
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

    cy.get(
      `[data-test="dashboard-x-item-${dashboardData.fields.XAxisValue1}-remove"]`
    ).click();
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.XAxisValue2
    );

    cy.get(
      `[data-test="dashboard-x-item-${dashboardData.fields.XAxisValue2}-remove"]`
    ).click();
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
    cy.get('[data-test="dashboard-query-data"]').click();
    cy.wait(5000);
    cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
      let text = editor.text();
      console.log(text, "text");
      text = removeUTFCharacters(text);
      console.log(text);
      console.log(dashboardData.QueryValue);
      expect(text.includes(dashboardData.QueryValue)).to.be.true;
    });
    // cy.get('[data-test="dashboard-panel-query-editor"]').should(
    //   "have.value",
    //   dashboardData.QueryValue
    // )
  });

  it.skip("should update the chart when field configurations are updated including filters", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click();
    cy.wait(2000);
    cy.addDashboardPanel();
    cy.get('[data-cy="date-time-button"]').click();
    cy.get('[data-test="date-time-relative-6-w-btn"]').click();
    cy.get('[data-test="dashboard-apply"]').click();
    cy.get("div.q-item__section");
    cy.wait(3000);
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
    cy.get(
      `[data-test="dashboard-x-item-${dashboardData.fields.XAxisValue1}"]`
    ).click();
    // Click to open the inner dropdown
    cy.get(
      `[data-test="dashboard-x-item-${dashboardData.fields.XAxisValue1}-menu"]`
    ).within(() => {
      cy.get('[data-test="dashboard-x-item-dropdown"]').click();
    });

    // get the dropdown value
    cy.get("div.q-item").contains("Histogram").click();
    cy.wait(1000);

    // change the label value
    cy.get('[data-test="dashboard-x-item-input"]', {timeout:2000}).clear().type("X-value");
    // Assert that the input field has the updated value
    cy.get('[data-test="dashboard-x-item-input"]').should(
      "have.value",
      "X-value"
    );
    cy.addFieldToAxis(
      fieldType.Y,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.YAxisValue1
    );
    // add y drop down value
    cy.get(
      `[data-test="dashboard-y-item-${dashboardData.fields.YAxisValue1}"]`
    ).click();
    // Click to open the inner dropdown
    cy.get(
      `[data-test="dashboard-y-item-${dashboardData.fields.YAxisValue1}-menu"]`
    ).within(() => {
      cy.get('[data-test="dashboard-y-item-dropdown"]')
        .children()
        .first()
        .should("have.text", "Count");
      cy.get('[data-test="dashboard-y-item-dropdown"]').click();
    });
    // get the dropdown value
    cy.get("div.q-item").contains("Sum").click();
    // change the label value
    cy.get('[data-test="dashboard-y-item-input"]').clear().type("Y-value");
    // Assert that the input field has the updated value
    cy.get('[data-test="dashboard-y-item-input"]').should(
      "have.value",
      "Y-value"
    );
    // change the color picker color
    cy.get('[data-test="dashboard-y-item-color"]').click();
    cy.wait(1000);
    // Set the color value in the color picker dialog
    cy.get('input[type="color"]').invoke("val", "#ff0000").trigger("input");

    // Close the color picker dialog (optional, if needed)
    // cy.get('input[type="color"]').blur();
    //Assert that input field color has the updated value
    cy.get('[data-test="dashboard-y-item-color"]').should(
      "have.value",
      "#ff0000"
    );
    cy.addFieldToAxis(
      fieldType.F,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.FilterValue1
    );
    cy.get(
      `[data-test="dashboard-filter-item-${dashboardData.fields.FilterValue1}"]`
    ).click();
    cy.get(
      `[data-test="dashboard-filter-item-${dashboardData.fields.FilterValue1}-menu"] .q-tab[data-test="dashboard-filter-list-tab"]`
    ).click();
    // get the dropdown value
    cy.get(
      '[data-test="dashboard-filter-list-panel"] [data-test="dashboard-filter-list-dropdown"]'
    ).click();
    // select check box value
    cy.get("div.q-item__section")
      .contains(dashboardData.FilterDropdownValue)
      .as("filter-checkbox");
    cy.get("@filter-checkbox").click({ force: true });
    cy.intercept("POST", dashboardData.SearchQuery).as("search");
    cy.get('[data-test="dashboard-apply"]').click();
    cy.wait(2000);
    cy.get('[data-test="dashboard-error"]').should("not.exist");
    cy.wait("@search", { timeout: 3000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@search").its("response.body.hits").should("be.an", "array");
    // cy.wait("@search").then(({ response }) => {
    //   expect(response.statusCode).to.eq(200);
    //   expect(response.body.hits).to.be.an("array");
    // });
    cy.get("#chart1").should("exist").and("be.visible");
    // cy.get('[data-test="dashboard-x-item-_timestamp"]').click()
    // cy.get('[data-test="dashboard-x-item-input"]')
    //     .contains("X-value")

    // cy.get("[data-test='dashboard-y-label']").should(
    //   "contain",
    //   dashboardData.filterLabel.YLabel
    // );
    //  cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
    //    let text = editor.text();
    //    text = removeUTFCharacters(text);
    //   //  console.log(text, "text");
    //    // let modifiedQueryString = queryString.replace(/_1/g, "");
    //    // console.log(modifiedQueryString,"modifiedQueryString");
    //    const expectedString = dashboardData.FilterQueryValue;
    //   //  console.log(expectedString, "expectedString");
    //    expect(text.includes(expectedString)).to.be.true;
    //  });
  });

  it.skip("should update the value automatically when trying to save the chart after switching from the auto to custom mode", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.wait(2000);
    cy.addDashboardPanel();
    cy.get(
      `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
    ).click();
    // check for the auto field generated
    cy.get('[data-test="dashboard-auto"]');
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
    cy.get('[data-test="dashboard-panel-query-editor"]').should("exist");
    cy.wait(5000);
    cy.get('[data-test="dashboard-query-data"]').click({ force: true });
    // assertion for value is added on the editor when = is clicked
    cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      console.log(text, "text");
      // let modifiedQueryString = queryString.replace(/_1/g, "");
      // console.log(modifiedQueryString,"modifiedQueryString");
      const expectedString = dashboardData.QueryValue;
      console.log(expectedString, "expectedString");
      expect(text.includes(expectedString)).to.be.true;
    });
    // check for the custom sql button
    cy.get('[data-test="dashboard-customSql"]').click();
    // Assertion for field is automatically on the x-axis and y-axis layout
    cy.get('[data-test="dashboard-x-layout"]').should(
      "contain",
      dashboardData.customQueryValue.field1
    );
    cy.get('[data-test="dashboard-y-layout"]').should(
      "contain",
      dashboardData.customQueryValue.field2
    );
    // cy.get('[data-test="dashboard-query-data"]').click({force:true});
    cy.get('[data-test="dashboard-panel-query-editor"]')
      .contains(dashboardData.customQueryValue.field1) // Find the specific word within the editor
      .click({ force: true })
      .wait(100)
      .type(`{cmd+d}{cmd+d}{cmd+d}${dashboardData.addCustomQueryValue.field1}`); // Select the desired text

    // cy.get('[data-test="dashboard-x-layout"]').should(
    //   "contain",
    //   dashboardData.addCustomQueryValue.field1
    // );
    const updatedQuery = `SELECT histogram(_timestamp) as "${dashboardData.addCustomQueryValue.field1}", count(code) as "${dashboardData.customQueryValue.field2}" FROM "e2e_automate" GROUP BY ${dashboardData.addCustomQueryValue.field1} ORDER BY ${dashboardData.addCustomQueryValue.field1} ASC`;
    // console.log(updatedQuery);
    cy.intercept("POST", dashboardData.SearchQuery).as("search");
    cy.wait(2000);
    cy.get('[data-test="dashboard-error"]').should("not.exist");
    cy.get('[data-test="dashboard-apply"]').click();
    cy.get('[data-test="dashboard-panel-query-editor"]').contains(updatedQuery)
    // should(
    //   "contain",
    //   updatedQuery
    // );
    cy.wait("@search", { timeout: 5000 }).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.hits).to.be.an("array");
    });
    // cy.get("#chart1").should("exist").and("be.visible");
    // cy.get("[data-test='dashboard-x-label']").should(
    //   "contain",
    //   dashboardData.XLabel
    // );
    // cy.get("[data-test='dashboard-y-label']").should(
    //   "contain",
    //   dashboardData.YLabel
    // );
  });

  // it("should be able to generate chart with custom query mode after switching from the auto mode", () => {
  //   cy.addDashboardPanel();
  //   cy.get(
  //     `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
  //   ).click();

  //   // check for the auto field generated
  //   cy.get('[data-test="dashboard-auto"]');
  //   cy.selectStream(dashboardData.Stream);
  //   cy.addFieldToAxis(
  //     fieldType.X,
  //     dashboardData.StreamType,
  //     dashboardData.Stream,
  //     dashboardData.fields.XAxisValue1
  //   );

  //   cy.addFieldToAxis(
  //     fieldType.Y,
  //     dashboardData.StreamType,
  //     dashboardData.Stream,
  //     dashboardData.fields.YAxisValue1
  //   );
  //   cy.get('[data-test="dashboard-query"]').should(
  //     "contain",
  //     dashboardData.QueryValue
  //   );
  //   // check for the custom sql button
  //   cy.get('[data-test="dashboard-customSql"]').click();
  //   //check for the popup cancel button
  //   cy.get('[data-test="cancel-button"]').click();
  //   cy.get('[data-test="dashboard-customSql"]').click();
  //   cy.wait(4000);
  //   //check for the popup confirm button
  //   cy.get('[data-test="confirm-button"]').click();
  //   cy.get('[data-test="dashboard-panel-searchbar"]').click();
  //   cy.get('[data-test="dashboard-panel-query-editor"]')
  //     .click()
  //     .type("{selectall}{backspace}")
  //     .type(dashboardData.QueryValue);
  //   cy.get(
  //     `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"]`
  //   ).trigger("mouseover");
  //   cy.get(
  //     `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"] [data-test="dashboard-add-x-data"]`
  //   ).click();
  //   cy.get(
  //     `[data-test="field-list-item-logs-${dashboardData.Stream}-y_axis_1"] [data-test="dashboard-add-y-data"]`
  //   ).click();
  //   cy.addAndSavePanel();
  // });
  it.skip("should clear the field after switch from custom to auto mode", () => {
    cy.addDashboard();
    cy.wait(1000);
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.wait(2000);
    cy.addDashboardPanel();

    cy.get(
      `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
    ).click();
    cy.selectStream(dashboardData.Stream, dashboardData.StreamType);

    cy.get('[data-test="dashboard-customSql"]').click();
    // cy.get('[data-test="dashboard-query-data"]').click({force:true});
    cy.get('[data-test="dashboard-panel-query-editor"]',{timeout:2000}).type(
      dashboardData.QueryValue
    );
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"]`
    ).trigger("mouseover");
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"] [data-test="dashboard-add-x-data"]`
    ).click();
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-y_axis_1"] [data-test="dashboard-add-y-data"]`
    ).click();
    cy.get("[data-test='dashboard-auto']").click();
    cy.get('[data-test="dialog-box"]').should("be.visible");
    //check for the popup cancel button
    cy.get('[data-test="cancel-button"]').click();
    cy.get('[data-test="dashboard-auto"]').click();
    //   cy.wait(4000);
    //  check for the popup confirm button
    cy.get('[data-test="confirm-button"]').click();
    cy.get('[data-test="dashboard-panel-searchbar"]').should("be.visible");
    cy.get('[data-test="dashboard-panel-query-editor"]').should(
      "have.value",
      ""
    );
    // Assertion for the clear value in the x and y layout
    cy.get(
      `[data-test='dashboard-x-item-${dashboardData.customQueryValue.field1}']`
    ).should("not.exist");
    cy.get(
      `[data-test='dashboard-x-item-${dashboardData.customQueryValue.field2}']`
    ).should("not.exist");
  });
  it.skip("should be able to generate chart with the custom query mode", () => {
    cy.addDashboardPanel();
    cy.get(
      `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
    ).click();
    cy.selectStream(dashboardData.Stream, dashboardData.StreamType);

    // check for the custom sql button
    cy.get('[data-test="dashboard-customSql"]').click();
    // //check for the popup cancel button
    // cy.get('[data-test="cancel-button"]').click();
    // cy.get('[data-test="dashboard-customSql"]').click();
    // // cy.wait(4000);
    // //check for the popup confirm button
    // cy.get('[data-test="confirm-button"]').click();
    // cy.get('[data-test="dashboard-query-data"]').click({ force: true });
    cy.get('[data-test="dashboard-panel-query-editor"]').type(
      dashboardData.QueryValue
    );
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"]`
    ).trigger("mouseover");
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"] [data-test="dashboard-add-x-data"]`
    ).click();
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-y_axis_1"] [data-test="dashboard-add-y-data"]`
    ).click();
    cy.addAndSavePanel();
  });
  it.skip("should display error when add new chartype with existing chart type value", () => {
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
    cy.addFieldToAxis(
      fieldType.Y,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.YAxisValue2
    );
    cy.get(
      `[data-test="selected-chart-${dashboardData.ChartType2}-item"]`
    ).click();
    cy.get('[data-test="dashboard-panel-name"]').type(
      dashboardData.DashboardPanelName
    );
    cy.get('[data-test="dashboard-panel-save"]').click();
    cy.get('[data-test="dashboard-error"] ul > li')
      .contains("Add one value field for donut and pie charts")
      .should("exist");
  });
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
        cy.get('[data-test="confirm-button"]').click();
        // })
      });
  });
});
