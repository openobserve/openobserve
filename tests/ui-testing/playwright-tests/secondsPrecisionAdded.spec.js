// Implementation test.spec.js
import { test, expect } from "./baseFixtures";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';


import { startTimeValue, endTimeValue } from '../pages/CommonLocator.js';

test('Relative Seconds on Logs page', async ({ page }) => {
  // Create page object instances
  const loginPage = new LoginPage(page);
  const logsPage = new LogsPage(page);
  // Step 1: Navigate to the application and login
  await page.goto(process.env["ZO_BASE_URL"]);
  // console.log ('URL Opened')
  await loginPage.gotoLoginPage();
  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);
  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 
  await logsPage.navigateToLogs();
  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);  // Wait for logs page to load 
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
  await page.goto(process.env["ZO_BASE_URL"]);
  await loginPage.gotoLoginPage();
  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);
  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 
  await logsPage.selectOrganization();
  // Navigate to Logs page
  await logsPage.navigateToLogs();
  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);  // Wait for logs page to load
  // Set the Date and Time Range
  await logsPage.setDateTime();
  const { browser } = test.info();
  await logsPage.fillTimeRange(browser);
  await logsPage.signOut();
});

test(' Time Zone change on Logs page', async ({ page }) => {
  // Create page object instances
  const loginPage = new LoginPage(page);
  const logsPage = new LogsPage(page);
  // Step 1: Navigate to the application and login
  await page.goto(process.env["ZO_BASE_URL"]);
  // console.log ('URL Opened')
  await loginPage.gotoLoginPage();
  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);
  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 
  await logsPage.navigateToLogs();
  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);  // Wait for logs page to load 
  // Step 4: Set the time to past 30 seconds and verify
  await logsPage.setTimeToPast30Seconds();
  await logsPage.changeTimeZone();
  await logsPage.signOut();
});

test(' Copy and share link on Logs page', async ({ page }) => {
  // Create page object instances
  const loginPage = new LoginPage(page);
  const logsPage = new LogsPage(page);
  // Step 1: Navigate to the application and login
  await page.goto(process.env["ZO_BASE_URL"]);
  // console.log ('URL Opened')
  await loginPage.gotoLoginPage();
  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);
  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 
  await logsPage.navigateToLogs();
  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);  // Wait for logs page to load 
  // Step 4: Set the time to past 30 seconds and verify
  //await logsPage.setTimeToPast30Seconds();
  const { browser } = test.info();
  await logsPage.copyShare({ browser });

  await logsPage.signOut();
});

test('Absolute Time on logs page', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  const logsPage = new LogsPage(page);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const month = 'Nov';
  const monthSelected = '11';
  const year = '2024';
  const day = '1';
  const daySelected = '01';
  const startTime = '01:00:00';
  const endTime = '02:00:00';

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = months[currentDate.getMonth()];


  // Step 1: Navigate to the application and login
  //await page.goto(process.env["ZO_BASE_URL"]);
  await loginPage.gotoLoginPage();
  await loginPage.login(process.env["ZO_ROOT_USER_EMAIL"], process.env["ZO_ROOT_USER_PASSWORD"]);
  // Step 2: Navigate to Logs Page
  await page.waitForTimeout(4000);  // Wait for login process 
  await logsPage.navigateToLogs();
  // Step 3: Select Index and Stream
  await page.waitForTimeout(3000);
  await logsPage.setDateTime();
  await logsPage.setAbsoluteDate(year, month, day, currentMonth, currentYear);
  await logsPage.setStartAndEndTime(startTime, endTime);
  await page.waitForTimeout(5000);
  const expectedTime = `${year}/${monthSelected}/${daySelected} ${startTime} - ${year}/${monthSelected}/${daySelected} ${endTime}`;
    const schedule = await logsPage.getScheduleText();
   
    expect(schedule).toEqual(expectedTime);

  
  await logsPage.setTimeZone("Asia/Dubai");
  await logsPage.verifySchedule(expectedTime);
});
