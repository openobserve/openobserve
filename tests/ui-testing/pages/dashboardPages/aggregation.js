const { expect } = require("@playwright/test");
import { randomDashboardName } from "../../playwright-tests/dashboards/dashboard-aggregation.spec.js.spec.js";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../../playwright-tests/utils/dashCreation.js";

export class Aggregations{
  constructor(page, yAxis, aggregation_options) {
    this.page = page;


    // Field Selection    
    this.yAxisField = page.locator(`[data-test="field-list-item-logs-e2e_automate-${yAxis}"] [data-test="dashboard-add-y-data"]`);
    this.yAxisOption = page.locator(`[data-test="dashboard-y-item-${yAxis}"]`);
    this.yAxisDropdown = page.locator('[data-test="dashboard-y-item-dropdown"]');

    //Aggregations
    this.yAxisDistinctOption = page.getByRole('option', { name: `${aggregation_options}` });


  // Query Inspector Locators
     this.queryEditor = this.page.locator('[data-test="dashboard-panel-query-editor"]').getByText('distinct');
     this.queryInspectorButton = this.page.locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]');
    this.queryInspectorCell = this.page.getByRole("cell", {
        name: `SELECT histogram(_timestamp) as "x_axis_1", ${aggregation_options === "Count (Distinct)" ? 'count(distinct' : aggregation_options.toLowerCase()}(${yAxis})${aggregation_options === "Count (Distinct)" ? ')' : ""} as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`,
        exact: true
    }).first();  
    

    // for breakdown 
    // this.queryInspectorCell = this.page.getByRole("cell", {
    //   name: `SELECT histogram(_timestamp) as "x_axis_1", ${aggregation_options === "Count (Distinct)" ? 'count(distinct' : aggregation_options.toLowerCase()}(${yAxis})${aggregation_options === "Count (Distinct)" ? ')' : ""} as "y_axis_1"${breakDownOrNot ? `, ${yAxis} as "breakdown_1"` : ""} FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`,
    //   exact: true
    // }).first();


    this.queryInspectorClose = this.page.locator('[data-test="query-inspector-close-btn"]');
  }

  // Methods

async configureYAxis() {
    await this.yAxisField.click();
    await this.yAxisOption.click();
    await this.yAxisDropdown.click();
}

async aggregation(){
    await this.yAxisDistinctOption.click();   
}

async verifyQueryInspector() {
 
    await this.queryInspectorButton.click(); 
    await this.queryInspectorCell.waitFor({ state: 'visible', timeout: 15000 }); 
    await this.queryInspectorClose.click(); 

}
}