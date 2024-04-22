///<reference types="cypress" />
import * as logstests from "../allfunctions/logs";
import logsdata from "../../../../test-data/logs_data.json"
// import logsdata from "../../data/logs_data.json";
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
    cy.selectStreamAndStreamTypeForLogs(logData.Stream);
    applyQueryButton()
    cy.wait("@allsearch");
    cy.intercept("GET", "**/api/default/streams**").as("streams");
  });

  it.skip("should display results for limit query", () => {
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
      .click() // Click on the editor to focus
      .type("match_all('provide_credentials') limit 5");
    cy.wait(2000);
    cy.get('[aria-label="SQL Mode"]').click({ force: true });
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content');
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    cy.wait(2000);
    cy.get(".search-list > :nth-child(1) > .text-left").contains(
      "Showing 1 to 5 out of 5"
    );

    cy.get('[aria-label="SQL Mode"]').click({ force: true });
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
    .click() // Click on the editor to focus
    .type("match_all('provide_credentials')");
    cy.get('[aria-label="SQL Mode"]').click({ force: true });

    cy.wait(2000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    cy.get('[data-test="logs-search-result-records-per-page"]').click();
    cy.get(".q-virtual-scroll__content:last").click();

    // Select "25" from the dropdown using contains
    cy.wait(2000);
    cy.contains(".q-item__label", "25").should("be.visible").click();
    cy.get(".search-list > :nth-child(1) > .text-left")
      .contains("Showing 1 to 5 out of 5")
      .should("not.exist");
  });

  it("should redirect to logs after clicking on stream explorer via stream page", () => {
    applyQueryButton()
    cy.wait(2000);
    cy.get('[data-cy="index-field-search-input"]').type("code");
    cy.wait(2000);
    cy.get('[data-test="log-search-expand-code-field-btn"]').click();
    cy.wait(2000);
    cy.get('[data-test="logs-search-subfield-add-code-200"]').click({
      force: true,
    });
    cy.get('[data-cy="date-time-button"] > .q-btn__content').click();
    cy.get('[data-test="date-time-relative-15-m-btn"]').click();
    cy.get('[data-cy="search-bar-refresh-button"]').click();
    cy.get('[data-test="logs-search-saved-views-btn"]').click();
    cy.wait(2000);
    cy.get('[data-test="add-alert-name-input"]').type("streamlogsnavigate");
    cy.get('[data-test="saved-view-dialog-save-btn"]').click();
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[title="Explore"]:first').click({ force: true });
    cy.url().should("include", "logs");
    cy.wait(2000);
    cy.wait("@allsearch");
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon'
    ).click({ force: true });
    cy.wait(2000);
    cy.contains("streamlogsnavigate").click();
    cy.wait(200);
    cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
      let text = editor.text();
      text = removeUTFCharacters(text);
      const cleanedText = removeUTFCharacters(text);
      expect(cleanedText).to.include("code='200'");
    });
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon'
    ).click();
    cy.get(
      '[data-test="logs-search-bar-delete-streamlogsnavigate-saved-view-btn"]'
    ).each(($button, index) => {
      if (index === 2) {
        // Click on the delete button for the first item
        cy.wrap($button).click();
        cy.get('[data-test="confirm-button"]').click({ force: true });
      }
    });
  });
  it("should reset the editor on clicking reset filter button", () => {
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
    cy.get('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
      .click() // Click on the editor to focus
      .type("match_all_indexed_ignore_case('provide_credentials')");
    cy.wait(2000);
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content');
    cy.wait(3000);
    cy.get("[data-test='logs-search-bar-refresh-btn']", {
      timeout: 2000,
    }).click({ force: true });
    cy.contains("Reset Filters").click({ force: true });
    cy.get('[data-test="logs-search-bar-query-editor"]').should(
      "have.value",
      ""
    );
  });

//  Remove Skip after bug fix
  it.skip("should enter query, reset and then again click the field from LHS", () => {
    // cy.intercept("GET", logData.ValueQuery).as("value");
    cy.get('[aria-label="SQL Mode"]').click({ force: true });
    // cy.get('[data-cy="index-field-search-input"]').type("kubernetes_host")
    // cy.wait(3000)
    // cy.get(
    //   '[data-test="log-search-expand-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-btn"]'
    // ).click({ force: true });
    // cy.contains("Reset Filters").click({ force: true });
    // cy.get(
    //   '[data-test="log-search-expand-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-btn"]'
    // ).click({ force: true });
    // cy.get(".q-notification__message").should("not.exist");
  });

  it("should add invalid query and display error", () => {
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");

    applyQueryButton();
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-query-editor"]', {
      timeout: 2000,
    }).type("kubernetes");
    cy.wait(2000);
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content').click({
      force: true,
    });
    cy.wait("@allsearch");
    cy.get('[data-test="logs-search-error-message"]', { timeout: 2000 }).should(
      "exist"
    );
  });

  it("should not display error if match all case added in log query search", () => {
    // Type the value of a variable into an input field
    cy.intercept("GET", logData.ValueQuery).as("value");

    applyQueryButton();
    cy.get('[data-cy="date-time-button"]').click({ force: true });
    cy.get(
      '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block'
    ).click({
      force: true,
    });
    cy.get('[data-test="logs-search-bar-query-editor"]', {
      timeout: 2000,
    }).type("match_all('code')");
    cy.wait(200);
    cy.get('[data-cy="search-bar-refresh-button"] > .q-btn__content').click({
      force: true,
    });
    cy.wait("@allsearch");
    cy.get('[data-test="log-table-column-1-@timestamp"]', {
      timeout: 2000,
    }).should("exist");
  });

  it("should change stream settings and click on search stream", () => {
    // Type the value of a variable into an input field

    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="streams-search-stream-input"]').type("e2e_automate");
    cy.get('[title="Stream Detail"]:first').click({ force: true });
    cy.get(':nth-child(2) > [data-test="schema-stream-index-select"]').click();
    cy.get(".q-virtual-scroll__content").within(() => {
      cy.contains("Inverted Index").click();
    });

    cy.get('[data-test="schema-update-settings-button"]').click({
      force: true,
    });
    cy.get(".col-auto > .q-btn > .q-btn__content").click({ force: true });
    cy.get('[title="Explore"]:first').click({ force: true });
    cy.get('[data-test="log-table-column-0-@timestamp"]').should("exist");
  });
  it("should display error if blank spaces added under stream name and clicked create stream ", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="add-stream-name-input"]').type("  ");
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.contains("Field is required").should("exist");
  });

  it("should display error if create stream is clicked without adding name", () => {
    cy.get('[data-test="menu-link-/streams-item"]').click({ force: true });
    cy.get('[data-test="log-stream-add-stream-btn"]').click({ force: true });
    cy.get('[data-test="save-stream-btn"]').click({ force: true });
    cy.contains("Field is required").should("exist");
  });

  it.skip("should match total - SQL mode ignore case for normal and index search", () => {
    const orgId = Cypress.env("ORGNAME");
    const streamName = "e2e_automate";
    const basicAuthCredentials = btoa(
      `${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`
    );
    // First query
    cy.request({
      method: "POST",
      url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
      headers: {
        Authorization: `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      },
      body: {
        query: {
          sql: "SELECT * FROM \"e2e_automate\" where match_all_indexed_ignore_case('logger')",
          start_time: 1709726643160000,
          end_time: 1710072243160000,
          from: 0,
          size: 250,
          quick_mode: true,
          sql_mode: "full",
          track_total_hits: true,
        },
      },
    }).then((response1) => {
      const totalLogs1 = response1.body.total;

      // Second query
      cy.request({
        method: "POST",
        url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
        headers: {
          Authorization: `Basic ${basicAuthCredentials}`,
          "Content-Type": "application/json",
        },

        body: {
          query: {
            sql: "SELECT * FROM \"e2e_automate\" where match_all_ignore_case('logger')",
            start_time: 1709726508369000,
            end_time: 1710072108369000,
            from: 0,
            size: 250,
            quick_mode: true,
            sql_mode: "full",
            track_total_hits: true,
          },
        },
      }).then((response2) => {
        const totalLogs2 = response2.body.total;

        // Assertion
        expect(totalLogs1).to.equal(totalLogs2);
      });
    });
  });

  it.skip("should match total - SQL mode match_all for normal and index search", () => {
    const orgId = Cypress.env("ORGNAME");
    const streamName = "e2e_automate";
    const basicAuthCredentials = btoa(
      `${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`
    );
    // First query
    cy.request({
      method: "POST",
      url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
      headers: {
        Authorization: `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      },
      body: {
        query: {
          sql: "SELECT * FROM \"e2e_automate\" where match_all('logger')",
          start_time: 1709705928581000,
          end_time: 1710051528581000,
          from: 0,
          size: 250,
          quick_mode: true,
          sql_mode: "full",
          track_total_hits: true,
        },
      },
    }).then((response1) => {
      const totalLogs1 = response1.body.total;

      // Second query
      cy.request({
        method: "POST",
        url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
        headers: {
          Authorization: `Basic ${basicAuthCredentials}`,
          "Content-Type": "application/json",
        },

        body: {
          query: {
            sql: "SELECT * FROM \"e2e_automate\" where match_all_indexed('logger')",
            start_time: 1709706092870000,
            end_time: 1710051692870000,
            from: 0,
            size: 250,
            quick_mode: true,
            sql_mode: "full",
            track_total_hits: true,
          },
        },
      }).then((response2) => {
        const totalLogs2 = response2.body.total;

        // Assertion
        expect(totalLogs1).to.equal(totalLogs2);
      });
    });
  });

  it("should match total - histogram mode match all for normal and index search", () => {
    const orgId = Cypress.env("ORGNAME");
    const streamName = "e2e_automate";
    const basicAuthCredentials = btoa(
      `${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`
    );
    // First query
    cy.request({
      method: "POST",
      url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
      headers: {
        Authorization: `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      },
      body: {
        query: {
          sql: "select * from \"e2e_automate\"  WHERE match_all('logger')",
          start_time: 1709725454701000,
          end_time: 1710071054701000,
          from: 0,
          size: 0,
          quick_mode: true,
          track_total_hits: true,
        },
        aggs: {
          histogram:
            "select histogram(_timestamp, '30 minute') AS zo_sql_key, count(*) AS zo_sql_num from query GROUP BY zo_sql_key ORDER BY zo_sql_key",
        },
      },
    }).then((response1) => {
      const totalLogs1 = response1.body.total;

      // Second query
      cy.request({
        method: "POST",
        url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
        headers: {
          Authorization: `Basic ${basicAuthCredentials}`,
          "Content-Type": "application/json",
        },

        body: {
          query: {
            sql: "select * from \"e2e_automate\"  WHERE match_all_indexed('logger')",
            start_time: 1709725511382000,
            end_time: 1710071111382000,
            from: 0,
            size: 0,
            quick_mode: true,
            track_total_hits: true,
          },
          aggs: {
            histogram:
              "select histogram(_timestamp, '30 minute') AS zo_sql_key, count(*) AS zo_sql_num from query GROUP BY zo_sql_key ORDER BY zo_sql_key",
          },
        },
      }).then((response2) => {
        const totalLogs2 = response2.body.total;

        // Assertion
        expect(totalLogs1).to.equal(totalLogs2);
      });
    });
  });

  it("should match total - histogram mode ignore case for normal and index search test", () => {
    const orgId = Cypress.env("ORGNAME");
    const streamName = "e2e_automate";
    const basicAuthCredentials = btoa(
      `${Cypress.env("EMAIL")}:${Cypress.env("PASSWORD")}`
    );
    // First query
    cy.request({
      method: "POST",
      url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
      headers: {
        Authorization: `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      },
      body: {
        query: {
          sql: "select * from \"e2e_automate\"  WHERE match_all_ignore_case('logger')",
          start_time: 1709725454701000,
          end_time: 1710071054701000,
          from: 0,
          size: 0,
          quick_mode: true,
          track_total_hits: true,
        },
        aggs: {
          histogram:
            "select histogram(_timestamp, '30 minute') AS zo_sql_key, count(*) AS zo_sql_num from query GROUP BY zo_sql_key ORDER BY zo_sql_key",
        },
      },
    }).then((response1) => {
      const totalLogs1 = response1.body.total;

      // Second query
      cy.request({
        method: "POST",
        url: `${Cypress.config().ingestionUrl}/api/${orgId}/_search?type=logs`,
        headers: {
          Authorization: `Basic ${basicAuthCredentials}`,
          "Content-Type": "application/json",
        },

        body: {
          query: {
            sql: "select * from \"e2e_automate\"  WHERE match_all_indexed_ignore_case('logger')",
            start_time: 1709725511382000,
            end_time: 1710071111382000,
            from: 0,
            size: 0,
            quick_mode: true,
            track_total_hits: true,
          },
          aggs: {
            histogram:
              "select histogram(_timestamp, '30 minute') AS zo_sql_key, count(*) AS zo_sql_num from query GROUP BY zo_sql_key ORDER BY zo_sql_key",
          },
        },
      }).then((response2) => {
        const totalLogs2 = response2.body.total;

        // Assertion
        expect(totalLogs1).to.equal(totalLogs2);
      });
    });
  });


  it("should add timestamp to editor save this view and switch", () => {
    cy.wait(1000)
    cy.get('[data-test="log-table-column-1-@timestamp"] > .flex > .ellipsis').click();
    cy.get(':nth-child(1) > [data-test="log-details-include-exclude-field-btn"] > .q-btn__content > .q-icon').click();
    cy.get('[data-test="log-details-include-field-btn"]').click();
    cy.get('[data-test="close-dialog"] > .q-btn__content').click();
    cy.get('[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown--current > .q-btn__content > :nth-child(1)').click();
    cy.get('[data-test="add-alert-name-input"]').type("e2etimestamp");
    cy.get('[data-test="saved-view-dialog-save-btn"] > .q-btn__content').click()
    
    cy.get('[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon').click()
    cy.get('.q-item__label').contains('timestamp').click();
    cy.get(".q-notification__message").should(
      "contain",
      "e2etimestamp view applied successfully"
    );
    cy.wait(3000)
    cy.get(
      '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon'
    ).click({force:true});
    cy.get(".saved-view-item")
      .first()
      .within(() => {
        cy.get(
          '[data-test="logs-search-bar-delete-e2etimestamp-saved-view-btn"]'
        ).click({ force: true });
      });

    cy.get('[data-test="confirm-button"] > .q-btn__content').click({
      force: true,
    });
  });
});