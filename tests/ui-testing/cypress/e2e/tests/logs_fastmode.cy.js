///<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import logsdata from "../../../../test-data/logs_data.json"
// import { login } from "../../support/commons"
// import { selectStreamAndStreamType } from "../../support/log-commons";

Cypress.on("uncaught:exception", (err, runnable) => {
  return false;
});
describe("Logs testcases", () => {
  let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }

  function applyQueryButton() {
    // click on the run query button
    // Type the value of a variable into an input field
    cy.intercept("POST", logData.applyQuery).as("search");
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // get the data from the search variable
    cy.wait("@search").its("response.statusCode").should("eq", 200);
    cy.get("@search").its("response.body.hits").should("be.an", "array");
    cy.get("@search")
      .its("response.body.hits")
      .should("be.an", "array")
      .then((hits) => {
        console.log(hits, "hits");
        if (hits.length > 0) {
          expect(Object.keys(hits[0]).length).to.be.at.most(5);
          // Add more assertions if needed
        }
       
  });

  }


  function quickModeOff() {
    // click on the run query button
    // Type the value of a variable into an input field
    cy.intercept("POST", logData.applyQuery).as("search");
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // get the data from the search variable
    cy.wait("@search").its("response.statusCode").should("eq", 200);
    cy.get("@search").its("response.body.hits").should("be.an", "array");
    cy.get("@search")
      .its("response.body.hits")
      .should("be.an", "array")
      .then((hits) => {
        console.log(hits, "hits");
        if (hits.length > 0) {
          expect(Object.keys(hits[0]).length).greaterThan(5)
          // Add more assertions if needed
        }
       
  });

  

  }
  before(function () {
    cy.fixture("log").then(function (data) {
      logData = data;
    });
    console.log("--logData--", logData);
  });

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

    // });
    cy.intercept("GET", "**/api/default/organizations**").as("allorgs");
    cy.intercept("GET", "**/api/default/functions**").as("functions");
    cy.visit(`${logData.logsUrl}?org_identifier=${Cypress.env("ORGNAME")}`);
    cy.intercept("POST", "**/api/default/_search**").as("allsearch");
    cy.wait("@allsearch");
    cy.selectStreamAndStreamTypeForLogs(logData.Stream);
    cy.intercept("GET", "**/api/default/streams**").as("streams");
  });


  it("should display results for fast mode off for match all case", () => {
   
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
      .click() // Click on the editor to focus
      .type("match_all('provide_credentials')")
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
    cy.get('[data-test="logs-search-bar-quick-mode-toggle-btn"]').click()
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // Type the value of a variable into an input field
    cy.wait(3000);
    quickModeOff()
  
  });

  it("should display results for fast mode off and match all", () => {
   
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
      .click() // Click on the editor to focus
      .type("match_all('provide_credentials')")
    cy.get('[data-test="logs-search-bar-quick-mode-toggle-btn"]').click()
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // Type the value of a variable into an input field
    cy.wait(3000);
    quickModeOff()
  
  });


  it("should display results for fast mode on and match all", () => {
   
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
      .click() // Click on the editor to focus
      .type("match_all('provide_credentials')")
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // Type the value of a variable into an input field
    cy.wait(3000);
  applyQueryButton()
  
  });

  it("should display results for fast mode on and match all raw ignore case", () => {
   
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
      .click() // Click on the editor to focus
      .type("match_all_raw_ignore_case('provide_credentials')")
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // Type the value of a variable into an input field
    cy.wait(3000);
   applyQueryButton()
  
  });


  it("should display results for fast mode on and run query", () => {
   
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // Type the value of a variable into an input field
    cy.wait(3000);
    applyQueryButton()
  });

  it("should display results for fast mode on with sql mode on and run query", () => {
    cy.get('[aria-label="SQL Mode"]').click({force:true})
   
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content')
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    // Type the value of a variable into an input field
    cy.wait(3000);
    applyQueryButton()
  
  });


it("should display correct results when fast mode on", () => {
    // Wait for 2 seconds
    cy.wait(2000);
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    logstests.addFeildandSubValue();
    logstests.addsubFeildValue();
    //click on the field
    // get the data from the value variable
    cy.wait("@value", { timeout: 5000 })
      .its("response.statusCode")
      .should("eq", 200);
    logstests.addsubFeildValue();
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.clickFeildSubvalue();
    cy.wait(2000);
    logstests.valueAddedOnPlusClick();
    cy.intercept("GET", logData.ValueQuery).as("value");
    logstests.clickOnFirstField();
    cy.wait("@value", { timeout: 4000 })
      .its("response.statusCode")
      .should("eq", 200);
    cy.get("@value").its("response.body.hits").should("be.an", "array");
    logstests.addSecondFieldOnEditor();
    logstests.clickOnEqualToButton();
    logstests.bothFieldAddedOnEqualToClick();
    cy.wait(2000);
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(1)
      .click({ force: true });
    cy.wait(300);
    cy.get(
      '[data-test="log-detail-json-content"] >>> [data-test="log-details-include-exclude-field-btn"] :first'
    ).click({ force: true });
    cy.get('[data-test="log-details-include-field-btn"]').click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include(
        "code='200' and code='200' and _timestamp="
      );
    });
    applyQueryButton();
    cy.get('[data-test="logs-search-bar-query-editor"]').type(
      "{selectall}{del}"
    );
    applyQueryButton();
    cy.get('[data-test="logs-search-result-logs-table"]')
      .find("tbody")
      .find("tr")
      .eq(2)
      .click({ force: true });
    cy.wait(2000);
    cy.get(
      '[data-test="log-detail-json-content"] >>> [data-test="log-details-include-exclude-field-btn"] :first'
    ).click({ force: true });
    cy.get('[data-test="log-details-exclude-field-btn"]', {
      timeout: 2000,
    }).click({ force: true });
    // cy.wait(2000);
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      // Confirm that the text contains 'code' not equal to '200'
      expect(cleanedText).to.include("_timestamp!=");
      applyQueryButton();
      cy.wait(200);
      //   cy.get('[data-test="[data-test="logs-search-bar-query-editor"]"]').type("{selectall}{del}");
      //   applyQueryButton();
      cy.get('[data-test="logs-search-result-logs-table"]')
        .find("tbody")
        .find("tr")
        .eq(2)
        .click({ force: true });
      cy.wait(2000);
      cy.get(
        '[data-test="log-detail-json-content"] >>> [data-test="log-details-include-exclude-field-btn"] :first'
      ).click({ force: true });
      cy.contains("Add field to table").click({ force: true });
      applyQueryButton();
    });
  });


});
