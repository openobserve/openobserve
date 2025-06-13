import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { UserPage } from "../pages/userPage.js";
import { CreateOrgPage } from "../pages/createOrgPage.js";



test.describe("Users and Organizations", () => {
    let loginPage, userPage, createOrgPage;

   
    const timestamp = Date.now(); 
    const randomSuffix = Math.floor(Math.random() * 1000); 
    const emailName = `email${timestamp}${randomSuffix}@gmail.com`;
    const orgName = `Organ${timestamp}${randomSuffix}`;
   

    test.beforeEach(async ({ page }) => {

        
        loginPage = new LoginPage(page);
        userPage = new UserPage(page);
        createOrgPage = new CreateOrgPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();

        
    

    });


    test("Error Message displayed if Email Blank", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser("");   
        await userPage.userCreate(); 
        await userPage.verifySuccessMessage('Please enter a valid email address');

    });

    test("Error Message displayed if Add user with missing role", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.userCreate();
        await userPage.verifySuccessMessage('Field is required');

    });

    test("User created with password and first name and last name", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.userCreate();

        await userPage.page.waitForTimeout(1000);   
        await userPage.verifySuccessMessage('User added successfully.');

    });

    test("User not created if Email already exists", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.page.waitForTimeout(1000);
        await userPage.userCreate();
        await userPage.verifySuccessMessage('User added successfully.');
        await userPage.page.waitForTimeout(5000);   
        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.userCreate();   
        await userPage.verifySuccessMessage('User is already part of the organization');

    });
    
    test("User not created if Cancel clicked on first Add User Page", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000); 
        await page.locator('[data-test="cancel-user-button"]').click();
        await userPage.page.waitForTimeout(1000);   
        await userPage.gotoIamPage();
        await userPage.searchUser(emailName);
        await userPage.verifyUserNotExists();

    });

    test("User not created if Cancel clicked on second Add User Page", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.page.waitForTimeout(1000);
        await page.locator('[data-test="cancel-user-button"]').click();
        await userPage.page.waitForTimeout(1000);   
        await userPage.gotoIamPage();
        await userPage.searchUser(emailName);
        await userPage.verifyUserNotExists();
    });
    
    

    test("User Created and deleted", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.userCreate();

        await userPage.page.waitForTimeout(1000);   
        await userPage.verifySuccessMessage('User added successfully.');
        await userPage.page.waitForTimeout(1000);   
        await userPage.gotoIamPage();
        await userPage.deleteUser(emailName);
        await userPage.verifySuccessMessage('User deleted successfully.');


    });

    test("User Created and not deleted if cancel clicked", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.userCreate();

        await userPage.page.waitForTimeout(1000);   
        await userPage.verifySuccessMessage('User added successfully.');
        await userPage.page.waitForTimeout(1000);   
        await userPage.gotoIamPage();
        await userPage.deleteUserCancel(emailName);
        await userPage.gotoIamPage();
        await userPage.searchUser(emailName);
        await userPage.verifyUserExists(emailName);

        

    });

   
    test("User Created and updated First Name and Last Name", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.userCreate();

        await userPage.page.waitForTimeout(1000);   
        await userPage.verifySuccessMessage('User added successfully.');
        await userPage.page.waitForTimeout(1000);   
        await userPage.gotoIamPage();
        await userPage.editUser(emailName);
        await userPage.addUserFirstLast('c', 'd');
        await userPage.userCreate();
        await userPage.verifySuccessMessage('User updated successfully.');
       
    });

    test("User Created and updated Password", async ({ page }) => {

        await userPage.gotoIamPage();
        await userPage.addUser(emailName);
        await userPage.selectUserRole('Admin');
        await userPage.page.waitForTimeout(1000);   
        await userPage.userCreate();
        await userPage.page.waitForTimeout(1000);   
        await userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await userPage.addUserFirstLast('a', 'b');
        await userPage.userCreate();

        await userPage.page.waitForTimeout(1000);   
        await userPage.verifySuccessMessage('User added successfully.');
        await userPage.page.waitForTimeout(1000);   
        await userPage.gotoIamPage();
        await userPage.editUser(emailName);
        await userPage.addNewPassword('1234567890');
        await userPage.userCreate();
        await userPage.verifySuccessMessage('User updated successfully.');
        
    });

    test.skip('Add Organization Successfully', async ({ page }) => {
        
        await createOrgPage.navigateToOrg();
        await createOrgPage.clickAddOrg();
        await createOrgPage.fillOrgName(orgName);
        await createOrgPage.clickSaveOrg();
        await userPage.verifySuccessMessage('Organization added successfully.');
        
     
      });

      test.skip('Save button disabled if Add Organization with Empty Name', async ({ page }) => {
        
        await createOrgPage.navigateToOrg();
        await createOrgPage.clickAddOrg();
        await createOrgPage.fillOrgName('');
        await createOrgPage.checkSaveEnabled();
        
        
     
      });

      test.skip('Organization not added if Cancel clicked', async ({ page }) => {
        
        await createOrgPage.navigateToOrg();
        await createOrgPage.clickAddOrg();
        await createOrgPage.fillOrgName(orgName);
        await createOrgPage.clickCancelButton();
        await createOrgPage.navigateToOrg();
        await createOrgPage.searchOrg(orgName);
        await createOrgPage.verifyOrgNotExists(expect);
        
     
      });

      test.skip('Error Message displayed if Add Organization is blank', async ({ page }) => {
        
        await createOrgPage.navigateToOrg();
        await createOrgPage.clickAddOrg();
        await createOrgPage.fillOrgName('');
        await page.locator('.q-field__bottom').click();
        await userPage.verifySuccessMessage('Name is required');
        
        
     
      });


});
