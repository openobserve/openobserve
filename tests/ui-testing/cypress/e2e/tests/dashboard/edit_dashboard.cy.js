///<reference types="cypress" />
import { fieldType } from "../../../support/commons";
// import logsdata from "../../../data/logs_data.json"
import logsdata from "../../../../../test-data/logs_data.json"
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
  function editDashboard(panelname) {
    //click on dashboard name
    cy.contains(
      '[data-test="dashboard-table"] td',
      dashboardData.DashboardName
    ).click({force:true});
    cy.url().should("include", dashboardData.ViewDashboardUrl);
    // Click on edit dashboard panel
    cy.wait(3000);
    cy.get(
      '[data-test="dashboard-edit-panel-' + panelname + '-dropdown"]'
    ).click({force:true});
    cy.get('[data-test="dashboard-edit-panel"]').click();
    cy.url().should("include", dashboardData.AddPanel);
  }
  beforeEach(() => {
    cy.intercept("*", (req) => {
        delete req.headers["if-none-match"];
      });
    cy.login();
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
    // cy.origin(Cypress.env('CYPRESS_BASEURL'),{args:{dashboardData}},({dashboardData})=>
    //   {
    cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
    cy.get('[data-test="menu-link-/dashboards-item"]')
      .contains(dashboardData.ModuleDashboard)
      .click();
    cy.get("table.q-table", { timeout: 30000 }).should("be.visible");
    //   })
  });

//   it("Add dashboard", () => {
//     cy.addDashboard();
//   });

//   it("Add area chart panel", () => {
//     cy.addAreaChartPanel();
//   });

  it.skip("Edit area chart panel", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.addAreaChartPanel();
    
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true });
    cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
    editDashboard(dashboardData.DashboardPanelName);
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue1 +
        '-remove"]'
    ).click();
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.XAxisValue3
    );
    cy.editAndSavePanel();
    cy.wait(300)
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })

    editDashboard(dashboardData.EditPanelName);
    cy.get(
        '[data-test="dashboard-x-item-' +
          dashboardData.fields.XAxisValue3 +
          '-remove"]'
      ).click();
      cy.get(
        '[data-test="dashboard-y-item-' +
          dashboardData.fields.YAxisValue1 +
          '-remove"]'
      ).click();
      cy.get('[data-test="dashboard-apply"]').click();
      cy.get('[data-test="dashboard-error"]').should("exist");
    

  });

//   it("Edit panel errors without fields", () => {
//     editDashboard(dashboardData.EditPanelName);
//     cy.get(
//       '[data-test="dashboard-x-item-' +
//         dashboardData.fields.XAxisValue3 +
//         '-remove"]'
//     ).click();
//     cy.get(
//       '[data-test="dashboard-y-item-' +
//         dashboardData.fields.YAxisValue1 +
//         '-remove"]'
//     ).click();
//     cy.get('[data-test="dashboard-apply"]').click();
//     cy.get('[data-test="dashboard-error"]').should("exist");
//   })

  it.skip("drag and drop element", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.addAreaChartPanel();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.get('[data-test="menu-link-/dashboards-item"]').trigger("mouseover");
    cy.wait(200)
    editDashboard(dashboardData.DashboardPanelName);
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue1 +
        '-remove"]'
    ).click();
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.XAxisValue3
    );
    cy.editAndSavePanel();
    cy.wait(200)
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    // cy.get('.flex.justify-between > :nth-child(2) > :nth-child(4)').click({force:true})

    editDashboard(dashboardData.EditPanelName);
    //select bar chart
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();

    // remove x and y axis values
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue3 +
        '-remove"]'
    ).click();
    cy.get(
      '[data-test="dashboard-y-item-' +
        dashboardData.fields.YAxisValue1 +
        '-remove"]'
    ).click();
    // search field value
    cy.get("[data-test='index-field-search-input']")
      .click()
      .clear()
      .type(dashboardData.fields.XAxisValue1);
    // Get the draggable element
    cy.get(
      '[data-test="field-list-item-' +
        dashboardData.StreamType +
        "-" +
        dashboardData.Stream +
        "-" +
        dashboardData.fields.XAxisValue1 +
        '"] [data-test="dashboard-add-data-indicator"]'
    ).as("draggable");

    // Get the droppable area
    cy.get('[data-test="dashboard-x-layout"]').as("droppable");

    cy.get("@draggable").trigger("dragstart");
    cy.get("@droppable").trigger("drop");

    cy.wait(5000);
    cy.get('[data-test="dashboard-x-layout"]').should(
      "contain",
      dashboardData.fields.XAxisValue1
    );

    //---------------------------------------------------------
    // Get the draggable element
    cy.get("[data-test='index-field-search-input']")
      .click()
      .clear()
      .type(dashboardData.fields.YAxisValue2);
    cy.get(
      '[data-test="field-list-item-' +
        dashboardData.StreamType +
        "-" +
        dashboardData.Stream +
        "-" +
        dashboardData.fields.YAxisValue2 +
        '"] [data-test="dashboard-add-data-indicator"]'
    ).as("draggable");

    // Get the droppable area
    cy.get('[data-test="dashboard-y-layout"]').as("droppable");

    cy.get("@draggable").trigger("dragstart");
    cy.get("@droppable").trigger("drop");

    cy.wait(5000);
    cy.get('[data-test="dashboard-y-layout"]').should(
      "contain",
      dashboardData.fields.YAxisValue2
    );

    //------------------------------------------------------------
    cy.editAndSavePanel();
    // cy.intercept("POST", dashboardData.SearchQuery).as("search");
    // cy.get('[data-test="dashboard-apply"]').click();
    // cy.wait(2000);
    // cy.get('[data-test="dashboard-error"]').should("not.exist");
    // cy.wait("@search").then(({ response }) => {
    //   expect(response.statusCode).to.eq(200);
    //   expect(response.body.hits).to.be.an("array");
    // });
    // cy.get("#chart1").should("exist").and("be.visible");
    // // cy.get('[data-test="dashboard-panel-name"]').type(dashboardData.DashboardPanelName)
    // cy.get('[data-test="dashboard-panel-save"]').click();
    // cy.url().should("include", dashboardData.ViewDashboardUrl);
  });

  it.skip("should verify query generation on the when fields are added and removed from axis", () => {
    editDashboard(dashboardData.EditPanelName);
    //select bar chart
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();

    // remove x axis value and add other value and check query
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue1 +
        '-remove"]'
    ).click();
    cy.selectStream(dashboardData.Stream,dashboardData.StreamType);
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.YAxisValue1
    );
    // cy.get(
    //   '[data-test="field-list-item-'+ dashboardData.StreamType + '-' + dashboardData.Stream + '-'+ dashboardData.fields.YAxisValue1 +'"]'
    // ).trigger("mouseover");
    // cy.get(
    //   '[data-test="field-list-item-'+ dashboardData.StreamType +'-' +
    //     dashboardData.Stream +
    //     '-'+ dashboardData.fields.YAxisValue1 +'"] [data-test="dashboard-add-x-data"]'
    // ).click();
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.YAxisValue1 +
        '-remove"]'
    ).click();
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.XAxisValue1
    );
    // cy.get(
    //   '[data-test="field-list-item-'+ dashboardData.StreamType + '-' +
    //     dashboardData.Stream +
    //     '-'+ dashboardData.fields.XAxisValue1 +'"] [data-test="dashboard-add-x-data"]'
    // ).click();

    cy.get('[data-test="dashboard-query-data"]').click();
    cy.wait(2000);
    const expectedString = `SELECT histogram(_timestamp) as "x_axis_1", count(log) as "y_axis_1"  FROM "default"  GROUP BY x_axis_1 ORDER BY x_axis_1`;
     cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
       let text = editor.text();
      //  console.log(text, "text");
       text = removeUTFCharacters(text);
       console.log(text,"txt");
       console.log(expectedString);
      //  console.log(dashboardData.QueryValue);
       expect(text.includes(expectedString)).to.be.true;
     });
    // cy.get('[data-test="dashboard-query"]').should(
    //   "contain",
    //   dashboardData.QueryValue
    // );
  });

  it.skip("Should update the chart when field configurations are updated including filters", () => {
    editDashboard(dashboardData.EditPanelName);
    //select bar chart
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();

    cy.get(
      '[data-test="dashboard-x-item-' + dashboardData.fields.XAxisValue1 + '"]'
    ).click();
    // Click to open the inner dropdown
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue1 +
        '-menu"]'
    ).within(() => {
      cy.get('[data-test="dashboard-x-item-dropdown"]').click();
    });

    // get the dropdown value
    cy.get("div.q-item").contains("Histogram").click();

    // change the label value
    // cy.get('[data-test="dashboard-x-item-input"]')
    //   .clear()
    //   .type(dashboardData.XLabel);

    // TODO: change this when devs change the locators
    // Assert that the input field has the updated value
    // cy.get('[data-test="dashboard-x-item-input"]').should(
    //   "have.value",
    //   dashboardData.XLabel
    // );

    // cy.get('[data-test="dashboard-x-layout"]').click();
    // // add y drop down value
    // cy.get(
    //   '[data-test="dashboard-y-item-' + dashboardData.fields.YAxisValue2 + '"]'
    // ).click();

    // // Click to open the inner dropdown
    // cy.get(
    //   '[data-test="dashboard-y-item-' +
    //     dashboardData.fields.YAxisValue2 +
    //     '-menu"]'
    // ).within(() => {
    //   cy.get('[data-test="dashboard-y-item-dropdown"]')
    //     .children()
    //     .first()
    //     .should("have.text", "Count");
    //   cy.get('[data-test="dashboard-y-item-dropdown"]').click();
    // });

    // // get the dropdown value
    // cy.get("div.q-item").contains("Count (Distinct)").click();

    // // change the label value
    // cy.get('[data-test="dashboard-y-item-input"]')
    //   .clear()
    //   .type(dashboardData.YLabel);
    // // Assert that the input field has the updated value
    // cy.get('[data-test="dashboard-y-item-input"]').should(
    //   "have.value",
    //   dashboardData.YLabel
    // );

    // // change the color picker color
    // cy.get('[data-test="dashboard-y-item-color"]').click();
    // cy.wait(4000);
    // // Set the color value in the color picker dialog
    // cy.get('input[type="color"]').invoke("val", "#ff0000").trigger("input");

    // //Assert that input field color has the updated value
    // cy.get('[data-test="dashboard-y-item-color"]').should(
    //   "have.value",
    //   "#ff0000"
    // );
    // cy.addFieldToAxis(
    //   fieldType.F,
    //   dashboardData.StreamType,
    //   dashboardData.Stream,
    //   dashboardData.fields.FilterValue1
    // );
    // // cy.get(
    // //   '[data-test="field-list-item-'+ dashboardData.StreamType + '-' + dashboardData.Stream + '-'+ dashboardData.fields.FilterValue1 +'"]'
    // // ).trigger("mouseover");
    // // cy.get(
    // //   '[data-test="field-list-item-'+ dashboardData.StreamType + '-' +
    // //     dashboardData.Stream +
    // //     '-'+ dashboardData.fields.FilterValue1 +'"] [data-test="dashboard-add-filter-data"]'
    // // ).click();
    // cy.get(
    //   '[data-test="dashboard-filter-item-' +
    //     dashboardData.fields.FilterValue1 +
    //     '"]'
    // ).click();
    // cy.get(
    //   '[data-test="dashboard-filter-item-' +
    //     dashboardData.fields.FilterValue1 +
    //     '-menu"] .q-tab[data-test="dashboard-filter-list-tab"]'
    // ).click();

    // // get the dropdown value
    // cy.get(
    //   '[data-test="dashboard-filter-list-panel"] [data-test="dashboard-filter-list-dropdown"]'
    // ).click();

    // // select check box value
    // cy.get("div.q-item__section")
    //   .contains(dashboardData.FilterDropdownValue)
    //   .as("filter-checkbox");
    // cy.get("@filter-checkbox").click({ force: true });

    // cy.intercept("POST", dashboardData.SearchQuery).as("search");
    // cy.get('[data-test="dashboard-apply"]').click();
    // cy.wait(2000);
    // cy.get('[data-test="dashboard-error"]').should("not.exist");
    // cy.wait("@search").its("response.statusCode").should("eq", 200);
    // cy.get("@search").its("response.body.hits").should("be.an", "array");
    // // cy.wait("@search").then(({ response }) => {
    // //   expect(response.statusCode).to.eq(200);
    // //   expect(response.body.hits).to.be.an("array");
    // // });
    // cy.get("#chart1").should("exist").and("be.visible");
    // cy.get("#chart1").should("contain", dashboardData.XLabel);
    // cy.get("#chart1").should("contain", dashboardData.YLabel);
    //  cy.get('[data-test="dashboard-query-data"]').click();
    //   cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
    //     let text = editor.text();
    //     console.log(text, "text");
    //     text = removeUTFCharacters(text);
    //     console.log(text);
    //     console.log(dashboardData.FilterQueryValue);
    //     expect(text.includes(dashboardData.FilterQueryValue)).to.be.true;
    //   });
    // // cy.get('[data-test="dashboard-query"]').should(
    // //   "contain",
    // //   dashboardData.FilterQueryValue
    // // );
  });

  it.skip("should update the value automatically when trying to save the chart after switching from the auto to custom mode", () => {
    //click on dashboard name
    editDashboard(dashboardData.EditPanelName);
    //select bar chart
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();

    // check for the auto field generated
    cy.get('[data-test="dashboard-auto"]');
    cy.get('[data-test="dashboard-query-data"]').click({ force: true });
    cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      console.log(text, "text");
      // let modifiedQueryString = queryString.replace(/_1/g, "");
      // console.log(modifiedQueryString,"modifiedQueryString");
      const expectedString = dashboardData.EditQuery;
      console.log(expectedString, "expectedString");
      expect(text.includes(expectedString)).to.be.true;
    });
    // cy.get('[data-test="dashboard-panel-query-editor"]').should(
    //   "contain",
      
    // );
    // check for the custom sql button
    cy.get('[data-test="dashboard-customSql"]').click();
    cy.wait(4000);
    // Assertion for field is automatically on the x-axis and y-axis layout
    cy.get('[data-test="dashboard-x-layout"]').should(
      "contain",
      dashboardData.customQueryValue.field1
    );
    cy.get('[data-test="dashboard-y-layout"]').should(
      "contain",
      dashboardData.customQueryValue.field2
    );
    // cy.get('[data-test="dashboard-panel-searchbar"]').click();
    cy.get('[data-test="dashboard-panel-query-editor"]')
      .contains(dashboardData.customQueryValue.field1) // Find the specific word within the editor
      .click()
      .type(
        `{cmd+d}{cmd+d}{cmd+d}${dashboardData.editCustomQueryValue.field1}`
      ); // Select the desired text

    // cy.get('[data-test="dashboard-x-layout"]').should(
    //   "contain",
    //   dashboardData.addCustomQueryValue.field1
    // );
    const updatedQuery = 'SELECT stream as "x_axis_12", count(code) as "y_axis_1"  FROM "e2e_automate"  GROUP BY x_axis_12'
    console.log(updatedQuery);
    cy.intercept("POST", dashboardData.SearchQuery).as("search");
    cy.wait(2000);
    cy.get('[data-test="dashboard-error"]').should("not.exist");
    cy.get('[data-test="dashboard-apply"]').click();
   cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
     let text = editor.text();
     text = removeUTFCharacters(text);
     console.log(text, "text");
     // let modifiedQueryString = queryString.replace(/_1/g, "");
     // console.log(modifiedQueryString,"modifiedQueryString");
     expect(text.includes(updatedQuery)).to.be.true;
   });
    cy.wait("@search", { timeout: 5000 }).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.hits).to.be.an("array");
    });
    cy.get("#chart1").should("exist").and("be.visible");
    // TODO: change this when devs change the locators
    // cy.get("[data-test='dashboard-x-label']").should(
    //   "contain",
    //   dashboardData.editXLabel
    // );
    // cy.get("[data-test='dashboard-y-label']").should(
    //   "contain",
    //   dashboardData.editYLabel
    // );
  });
  it.skip("should clear the field after switch from custom to auto mode", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.addAreaChartPanel();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    editDashboard(dashboardData.DashboardPanelName);
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue1 +
        '-remove"]'
    ).click();
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.XAxisValue3
    );
    cy.editAndSavePanel();
    cy.wait(200)
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    editDashboard(dashboardData.EditPanelName);
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();
    cy.selectStream(dashboardData.Stream,dashboardData.StreamType);
    cy.get('[data-test="dashboard-customSql"]').click();
    // cy.get('[data-test="dashboard-panel-searchbar"]').click();
    // cy.get('[data-test="dashboard-panel-query-editor"]').type(
    //   dashboardData.QueryValue
    // );
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"]`
    ).trigger("mouseover");
    cy.get(
      `[data-test="field-list-item-logs-${dashboardData.Stream}-x_axis_1"] [data-test="dashboard-add-x-data"]`
    ).click();
     cy.get(
       `[data-test="field-list-item-logs-${dashboardData.Stream}-y_axis_1"]`
     ).trigger("mouseover");
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
    // Assertion for the clear value in the editor
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
  // it("Should be able to generate chart with custom query mode after switching from the auto mode", () => {
  //   //click on dashboard name
  //   editDashboard(dashboardData.EditPanelName);
  //   //select bar chart
  //   cy.get(
  //     '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
  //   ).click();

  //   // check for the auto field generated
  //   cy.get('[data-test="dashboard-auto"]');

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
  //     '[data-test="field-list-item-'+ dashboardData.StreamType + '-' + dashboardData.Stream + '-x_axis_1"]'
  //   ).trigger("mouseover");
  //   cy.get(
  //     '[data-test="field-list-item-'+ dashboardData.StreamType + '-' +
  //       dashboardData.Stream +
  //       '-x_axis_1"] [data-test="dashboard-add-x-data"]'
  //   ).click();
  //   cy.get(
  //     '[data-test="field-list-item-'+ dashboardData.StreamType + '-' +
  //       dashboardData.Stream +
  //       '-y_axis_1"] [data-test="dashboard-add-y-data"]'
  //   ).click();
  //   cy.editAndSavePanel();
  //   // cy.intercept("POST", dashboardData.SearchQuery).as("search");
  //   // cy.get('[data-test="dashboard-apply"]').click();
  //   // // cy.get('[data-test="dashboard-error"]').should('exist');
  //   // cy.wait(2000);
  //   // cy.get('[data-test="dashboard-error"]').should("not.exist");
  //   // cy.wait("@search").then(({ response }) => {
  //   //   expect(response.statusCode).to.eq(200);
  //   //   expect(response.body.hits).to.be.an("array");
  //   // });
  //   // cy.get("#chart1").should("exist").and("be.visible");
  //   // // cy.get('[data-test="dashboard-panel-name"]').type(dashboardData.DashboardPanelName)
  //   // cy.get('[data-test="dashboard-panel-save"]').click();
  //   // cy.url().should("include", dashboardData.ViewDashboardUrl);
  // });

  it.skip("Should be able to generate chart with the custom query mode", () => {
    cy.addDashboard();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    cy.addAreaChartPanel();
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    editDashboard(dashboardData.DashboardPanelName);
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();
    cy.get(
      '[data-test="dashboard-x-item-' +
        dashboardData.fields.XAxisValue1 +
        '-remove"]'
    ).click();
    cy.addFieldToAxis(
      fieldType.X,
      dashboardData.StreamType,
      dashboardData.Stream,
      dashboardData.fields.XAxisValue3
    );
    cy.editAndSavePanel();
    cy.wait(400)
    cy.get('[data-test="menu-link-/dashboards-item"]').click({ force: true })
    //click on dashboard name
    editDashboard(dashboardData.EditPanelName);
    //select bar chart
    cy.get(
      '[data-test="selected-chart-' + dashboardData.EditChartType + '-item"]'
    ).click();
    cy.selectStream(dashboardData.Stream, dashboardData.StreamType);

    // check for the custom sql button
    cy.get('[data-test="dashboard-customSql"]').click();
    // cy.get('[data-test="dashboard-query-data"]').click({force: true});
    cy.get('[data-test="dashboard-panel-query-editor"]')
      .click()
      .type("{selectall}{backspace}")
      .type(dashboardData.QueryValue);
    cy.wait(4000);
    cy.get(
      '[data-test="field-list-item-' +
        dashboardData.StreamType +
        "-" +
        dashboardData.Stream +
        '-x_axis_1"]'
    ).trigger("mouseover");
    cy.get(
      '[data-test="field-list-item-' +
        dashboardData.StreamType +
        "-" +
        dashboardData.Stream +
        '-x_axis_1"] [data-test="dashboard-add-x-data"]'
    ).click();
    cy.get(
      '[data-test="field-list-item-' +
        dashboardData.StreamType +
        "-" +
        dashboardData.Stream +
        '-y_axis_1"] [data-test="dashboard-add-y-data"]'
    ).click();
    cy.editAndSavePanel();
    // cy.intercept("POST", dashboardData.SearchQuery).as("search");
    // cy.get('[data-test="dashboard-apply"]').click();
    // cy.wait(2000);
    // cy.get('[data-test="dashboard-error"]').should("not.exist");
    // cy.wait("@search").then(({ response }) => {
    //   expect(response.statusCode).to.eq(200);
    //   expect(response.body.hits).to.be.an("array");
    // });
    // cy.get("#chart1").should("exist").and("be.visible");
    // cy.get('[data-test="dashboard-panel-save"]').click();
    // cy.url().should("include", dashboardData.ViewDashboardUrl);
  });

  it.skip("Delete panel", () => {
    cy.contains(
      '[data-test="dashboard-table"] td',
      dashboardData.DashboardName
    ).click();
    cy.url().should("include", dashboardData.ViewDashboardUrl);
    cy.get(
      '[data-test="dashboard-edit-panel-' +
        dashboardData.EditPanelName +
        '-dropdown"]'
    ).click();
    cy.get('[data-test="dashboard-delete-panel"]').click();
    cy.reload();
    // cy.get('[data-test="dashboard-panel-title"]').should(
    //     "not.contain",
    //     dashboardData.EditPanelName
    // );
    // cy.get('[data-test="panels-grid"]')
    //   .contains(dashboardData.EditPanelName)
    //   .should("not.be.visible");
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
          .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
          .click();
        cy.get('[data-test="confirm-button"]').click();
        // })
      });
  });
});
