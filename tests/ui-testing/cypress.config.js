const { defineConfig } = require("cypress");
let cypressjson = {};

try {
  cypressjson = require("./cypress.env.json");
} catch (err) {}

module.exports = defineConfig({
  projectId: 'fmd3am',
//defaultCommandTimeout:4000,
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },

    //"excludeSpecPattern": "**/cypress/e2e/**",
    baseUrl: cypressjson?.BASEURL || "http://localhost:5080",
    "ingestionUrl":cypressjson.INGESTION_URL || "http://localhost:5080",
    "experimentalOriginDependencies":true,
    "testIsolation": true,
    "experimentalRunAllSpecs": true,
    "projectId": 'fmd3am',
    "viewportHeight": 1024,
    "viewportWidth": 1280
  },
  scrollBehavior:false
});
