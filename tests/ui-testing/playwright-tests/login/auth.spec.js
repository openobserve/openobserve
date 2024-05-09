// // tests/auth.setup.js
// import   { test, expect } from '@playwright/test';
// import fs from 'fs/promises';

// // The login function

// test('Login', async ({ page }) => {
//     // Navigate to the base URL
//     await page.goto(process.env["ZO_BASE_URL"]);
//     await page.waitForTimeout(1000); // Wait for 1 second

//     // Fill in the user ID and password fields with values from environment variables
//     await page
//       .locator('[data-cy="login-user-id"]')
//       .fill(process.env["ZO_ROOT_USER_EMAIL"]);
//     await page
//       .locator('[data-cy="login-password"]')
//       .fill(process.env["ZO_ROOT_USER_PASSWORD"]);

//     // Click the login button
//     await page.locator('[data-cy="login-sign-in"]').click();
//     await page.waitForTimeout(4000); // Wait for 4 seconds

//     // Optionally, assert that the login was successful by checking the presence of an element visible only when logged in
//     // Example: await expect(page.locator('text=Logged in')).toBeVisible();

//     // Navigate back to the base URL
//     await page.goto(process.env["ZO_BASE_URL"]);
//     // await page.context().storageState({ path: './playwright-tests/login/LoginAuth.json' });
//     const storageState = await page.context().storageState();
//     await fs.writeFile('./playwright-tests/login/LoginAuth.json', JSON.stringify(storageState));
//   });


import { test, expect } from '@playwright/test';
import fs from 'fs/promises';

// The login function
test('Login', async ({ page }) => {
    // Navigate to the base URL
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForTimeout(1000); // Wait for 1 second

    // Fill in the user ID and password fields with values from environment variables
    await page.locator('[data-cy="login-user-id"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await page.locator('[data-cy="login-password"]').fill(process.env["ZO_ROOT_USER_PASSWORD"]);

    // Click the login button
    await page.locator('[data-cy="login-sign-in"]').click();
    await page.waitForTimeout(4000); // Wait for 4 seconds

    // Optionally, assert that the login was successful by checking the presence of an element visible only when logged in
    // Example: await expect(page.locator('text=Logged in')).toBeVisible();

    // Save storage state to file
    const storageState = await page.context().storageState();
    await fs.writeFile('./playwright-tests/login/LoginAuth.json', JSON.stringify(storageState));
});