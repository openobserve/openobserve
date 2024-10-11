// Implementation test.spec.js
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { TracesPage } from '../pages/tracesPage.js';
import { ReportsPage } from '../pages/reportsPage.js';
import { DashboardPage } from '../pages/dashboardPage.js';
import { AlertPage } from '../pages/alertsPage.js';

import{ startTimeValue, endTimeValue, startDateTimeValue, endDateTimeValue } from '../pages/CommonLocator.js';

//import {CommomnLocator} from '../pages/CommonLocator'

console.log ('Login Started')

test('Relative Seconds on Logs page', async ({ page }) => {
  // Create page object instances
  const loginPage = new LoginPage(page);
  const logsPage = new LogsPage(page);

  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  console.log ('URL Opened')

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 

  await logsPage.navigateToLogs();

  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);  // Wait for logs page to load 
  await logsPage.selectIndexAndStream();

  // Step 4: Set the time to past 30 seconds and verify
  await logsPage.setTimeToPast30Seconds();
  await logsPage.verifyTimeSetTo30Seconds();

  await logsPage.signOut();

});


test('Absolute Seconds on Logs page', async ({ page }) => {
  // Create page object instances
  const loginPage = new LoginPage(page);
  const logsPage = new LogsPage(page);

  // Step 1: Navigate to the application and login
  //await page.goto('https://alpha1.dev.zinclabs.dev/web/');
  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  //await loginPage.login('testing@alpha1.com', 'SecTest@500');

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 

  await logsPage.selectOrganization();

  // Navigate to Logs page

  await logsPage.navigateToLogs();

  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);  // Wait for logs page to load
  await logsPage.selectIndexAndStream();

  // Step 4: Set the time to past 30 seconds and verify
  //await logsPage.adjustFilterParameters();
  await logsPage.enableSQLMode();

  // Set the Date and Time Range
  await logsPage.setDateTime();
  await logsPage.fillTimeRange(startTimeValue, endTimeValue);

  // Verify the time range is displayed correctly
  await logsPage.verifyDateTime(startDateTimeValue, endDateTimeValue);

  await logsPage.signOut();


});


test('Relative second on traces', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const tracesPage = new TracesPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process

  // Step 2: Navigate to the traces page and perform actions

  await tracesPage.navigateToTraces();

  // Step 4: Set the time to past 30 seconds and verify

  await tracesPage.setTimeToPast30Seconds();
  await tracesPage.verifyTimeSetTo30Seconds();

  await tracesPage.signOut();

});

test('Absolute second on traces', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const tracesPage = new TracesPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process 

  // Step 2: Navigate to the traces page and perform actions

  await tracesPage.navigateToTraces();

  // Step 4: // Set the Date and Time Range

  await tracesPage.setDateTime();
  await tracesPage.fillTimeRange(["startTimeValue"], ["endTimeValue"]);

  // Verify the time range is displayed correctly

  await tracesPage.verifyDateTime(["startDateTimeValue"], ["endDateTimeValue"]);

  await tracesPage.signOut();

});


test('Relative second on reports', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const reportsPage = new ReportsPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process 

  // Step 2: Navigate to the Reports page and click add report

  await reportsPage.navigateToReports();

  await reportsPage.addNewReport();

  // Step 4: Set the time to past 30 seconds and verify

  await reportsPage.setTimeToPast30Seconds();
  await reportsPage.verifyTimeSetTo30Seconds();

  await reportsPage.signOut();
});

test('Absolute second on report', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const reportsPage = new ReportsPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process 

  // Step 2: Navigate to the Reports page and click add report

  await reportsPage.navigateToReports();

  await reportsPage.addNewReport();

  // Step 4: // Set the Date and Time Range

  await reportsPage.setDateTime();
  await reportsPage.fillTimeRange(["startTimeValue"], ["endTimeValue"]);

  // Verify the time range is displayed correctly
  await reportsPage.verifyDateTime(["startDateTimeValue"], ["endDateTimeValue"]);

  await reportsPage.signOut();

});


test('Relative second on dashboard', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process 

  // Step 2: Navigate to the dashboard page and add a new dashboard
  await dashboardPage.navigateToDashboards();
  await dashboardPage.addDashboard('Relative D');

  // Step 4: Set the time to past 30 seconds and verify

  await dashboardPage.setTimeToPast30Seconds();
  await dashboardPage.verifyTimeSetTo30Seconds();

  await dashboardPage.signOut();
});

test('Absolute second on dashboard', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process

  // Step 2: Navigate to the dashboard page and add a new dashboard
  await dashboardPage.navigateToDashboards();
  await dashboardPage.addDashboard('Absolute DB');

  // Step 3: // Set the Date and Time Range

  await dashboardPage.setDateTime();
  await dashboardPage.fillTimeRange(["startTimeValue"], ["endTimeValue"]);

  // Verify the time range is displayed correctly
  await dashboardPage.verifyDateTime(["startDateTimeValue"], ["endDateTimeValue"]);

  await dashboardPage.signOut();

});

test('Relative second on alert', async ({ page }) => {
  
  // Create page object instances
  const loginPage = new LoginPage(page);
  const alertPage = new AlertPage(page);
  
  // Step 1: Navigate to the application and login

  await page.goto(process.env["ZO_BASE_URL"]);

  await loginPage.gotoLoginPage();

  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);

  await page.waitForTimeout(4000);  // Wait for login process 

  // Navigate to Alerts and Create Alert
  await alertPage.navigateToAlerts();
  await alertPage.createAlert();


  // Set the time to past 30 seconds and verify

  await alertPage.setTimeToPast30Seconds();
  await alertPage.verifyTimeSetTo30Seconds();

  await alertPage.signOut();
});

