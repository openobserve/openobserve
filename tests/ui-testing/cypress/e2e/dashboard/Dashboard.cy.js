///<reference types="cypress" />
import { fieldType } from "../../support/commons";
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
    // cy.origin(Cypress.env('CYPRESS_BASEURL'),{args:{dashboardData}},({dashboardData})=>
    //   {
    cy.login();
    cy.wait(4000);
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

  it("Add dashboard", () => {
    cy.addDashboard();
  });

  it("Add area chart panel", () => {
    cy.addAreaChartPanel();
  });

  it("Add panel errors without fields", () => {
    cy.addDashboardPanel();
    cy.get('[data-test="dashboard-apply"]').click();
    cy.get('[data-test="dashboard-error"]').should("exist");
  });

  it("drag and drop element", () => {
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

  it("Verify query generation on the when fields are added and removed from axis", () => {
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

  it("should update the chart when field configurations are updated including filters", () => {
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

    // change the label value
    cy.get('[data-test="dashboard-x-item-input"]').clear().type("X-value");
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
    cy.get("[data-test='dashboard-x-label']").should(
      "contain",
      dashboardData.filterLabel.XLabel
    );
    cy.get("[data-test='dashboard-y-label']").should(
      "contain",
      dashboardData.filterLabel.YLabel
    );
     cy.get('[data-test="dashboard-panel-query-editor"]').then((editor) => {
       let text = editor.text();
       text = removeUTFCharacters(text);
      //  console.log(text, "text");
       // let modifiedQueryString = queryString.replace(/_1/g, "");
       // console.log(modifiedQueryString,"modifiedQueryString");
       const expectedString = dashboardData.FilterQueryValue;
      //  console.log(expectedString, "expectedString");
       expect(text.includes(expectedString)).to.be.true;
     });
   
  });

  it("should update the value automatically when trying to save the chart after switching from the auto to custom mode", () => {
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
      .type(`{ctrl+d}{ctrl+d}{ctrl+d}${dashboardData.addCustomQueryValue.field1}`, { force: true }); // Select the desired text

    // cy.get('[data-test="dashboard-x-layout"]').should(
    //   "contain",
    //   dashboardData.addCustomQueryValue.field1
    // );
    const updatedQuery = `SELECT histogram(_timestamp) as "${dashboardData.addCustomQueryValue.field1}", count(code) as "${dashboardData.customQueryValue.field2}" FROM "default" GROUP BY ${dashboardData.addCustomQueryValue.field1} ORDER BY ${dashboardData.addCustomQueryValue.field1}`;
    // console.log(updatedQuery);
    cy.intercept("POST", dashboardData.SearchQuery).as("search");
    cy.wait(2000);
    cy.get('[data-test="dashboard-error"]').should("not.exist");
    cy.get('[data-test="dashboard-apply"]').click();
    cy.get('[data-test="dashboard-panel-query-editor"]').should(
      "contain",
      updatedQuery
    );
    cy.wait("@search", { timeout: 5000 }).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.hits).to.be.an("array");
    });
    cy.get("#chart1").should("exist").and("be.visible");
    cy.get("[data-test='dashboard-x-label']").should(
      "contain",
      dashboardData.XLabel
    );
    cy.get("[data-test='dashboard-y-label']").should(
      "contain",
      dashboardData.YLabel
    );
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
  it("should clear the field after switch from custom to auto mode", () => {
    cy.addDashboardPanel();

    cy.get(
      `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
    ).click();
    cy.selectStream(dashboardData.Stream, dashboardData.StreamType);

    cy.get('[data-test="dashboard-customSql"]').click();
    // cy.get('[data-test="dashboard-query-data"]').click({force:true});
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
  it("should be able to generate chart with the custom query mode", () => {
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
  it("should display error when add new chartype with existing chart type value", () => {
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
      .contains("Only one values field is allowed for donut and pie charts")
      .should("exist");
  });
  it("Delete dashboard", () => {
    cy.get('[data-test="dashboard-table"]') // Assuming your table is represented by the <table> element
      .should("be.visible"); // Ensure the table is visible on the page
    // find the dashboard name and click on the delete dashboard button. We can see that confirm dialog and click on cancel button
    cy.get('[data-test="dashboard-table"]') // Step 1: Locate the table element
      .find("tr") // Step 2: Select all rows
      .eq(6) // Step 2: Select the 6th row (zero-based)
      .should("exist") // Step 3: Assert that the row exists
      .within(() => {
        // Perform actions or assertions on the row's contents
        // For example, check if a specific cell contains expected text
        cy.get('[data-test="dashboard-delete"]').click();
      });
    // cy.get('[data-test="dashboard-table"] td')
    //   .first()
    //   .trigger("mouseover", { force: true })
    //   .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
    //   .click();
    // cy.contains('[data-test="dashboard-table"] td', dashboardData.DashboardName) // gives you the cell
    //   .siblings() // gives you all the other cells in the row
    //   .first()
    //   .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
    //   .click();
    cy.get('[data-test="dashboard-confirm-dialog"]').should("be.visible"); // check that the dialog is visible
    cy.wait(2000); // wait for 2ms for the dialogues
    cy.get('[data-test="cancel-button"]').click(); // click on the cancel button
    cy.reload(); // reload the window
    cy.get('[data-test="dashboard-table"] td').should(
      "contain",
      dashboardData.DashboardName
    );

    // find the dashboard name and click on the delete dashboard button. we cab see the confirm dialog and click on the confirm button
    // cy.contains('[data-test="dashboard-table"] td', dashboardData.DashboardName) // gives you the cell
    //   .siblings() // gives you all the other cells in the row
    //   .find('[data-test="dashboard-delete"]') // finds the delete button and clicks on it
    //   .click();
    cy.get('[data-test="dashboard-table"]') // Step 1: Locate the table element
      .find("tr") // Step 2: Select all rows
      .eq(6) // Step 2: Select the 6th row (zero-based)
      .should("exist") // Step 3: Assert that the row exists
      .within(() => {
        // Perform actions or assertions on the row's contents
        // For example, check if a specific cell contains expected text
        cy.get('[data-test="dashboard-delete"]').click();
      });
    cy.get('[data-test="dashboard-confirm-dialog"]').should("be.visible"); // check that the dialog is visible
    cy.wait(2000); // wait for 2ms for the dialogues
    cy.get('[data-test="confirm-button"]').click(); // click on the confirm button
    cy.reload(); // reload the window
    cy.wait(5000);

    // cy.get('[data-test="dashboard-table"] td').should(
    //   "not.contain",
    //   dashboardData.DashboardName
    // ); // check that the dashboard is not available
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

  // it("should add multiple charts in dashboard", () => {
  //   addDashboard();
  //   cy.get(
  //     `[data-test="selected-chart-${dashboardData.ChartType}-item"]`
  //   ).click();
  //   selectStream(dashboardData.Stream);
  //   addFieldToAxis(
  //     fieldType.X,
  //     dashboardData.StreamType,
  //     dashboardData.Stream,
  //     dashboardData.fields.XAxisValue1
  //   );
  //   addFieldToAxis(
  //     fieldType.Y,
  //     dashboardData.StreamType,
  //     dashboardData.Stream,
  //     dashboardData.fields.YAxisValue1
  //   );
  //   cy.intercept("POST", dashboardData.SearchQuery).as("search");
  //   cy.get('[data-test="dashboard-apply"]').click();
  //   cy.wait(2000);
  //   cy.get('[data-test="dashboard-error"]').should("not.exist");
  //   cy.wait("@search").then(({ response }) => {
  //     expect(response.statusCode).to.eq(200);
  //     expect(response.body.hits).to.be.an("array");
  //   });
  //   cy.get("#chart1").should("exist").and("be.visible");
  //   cy.get('[data-test="dashboard-panel-name"]').type(
  //     dashboardData.DashboardPanelName
  //   );
  //   cy.get('[data-test="dashboard-panel-save"]').click();
  //   cy.url().should("include", dashboardData.ViewDashboardUrl);
  //   cy.get('[data-test="dashboard-panel-add"]').click();
  //   cy.url().should("include", dashboardData.AddPanel);
  //    cy.get(
  //      `[data-test="selected-chart-${dashboardData.ChartType2}-item"]`
  //    ).click();
  //    selectStream(dashboardData.Stream);
  //     addFieldToAxis(
  //       fieldType.X,
  //       dashboardData.StreamType,
  //       dashboardData.Stream,
  //       dashboardData.fields.XAxisValue2
  //     );
  //     addFieldToAxis(
  //       fieldType.Y,
  //       dashboardData.StreamType,
  //       dashboardData.Stream,
  //       dashboardData.fields.YAxisValue2
  //     );
  //     cy.intercept("POST", dashboardData.SearchQuery).as("search");
  //     cy.get('[data-test="dashboard-apply"]').click();
  //     cy.wait(2000);
  //     cy.get('[data-test="dashboard-error"]').should("not.exist");
  //     cy.wait("@search").then(({ response }) => {
  //       expect(response.statusCode).to.eq(200);
  //       expect(response.body.hits).to.be.an("array");
  //     });
  //     cy.get("#chart1").should("exist").and("be.visible");
  //     cy.get('[data-test="dashboard-panel-name"]').type(
  //       dashboardData.DashboardPanelName
  //     );
  //     cy.get('[data-test="dashboard-panel-save"]').click();
  //     cy.url().should("include", dashboardData.ViewDashboardUrl);
  // });
});
