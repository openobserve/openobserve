import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { ManagementPage } from "../pages/managementPage.js";
import { AlertTemplate } from "../pages/alertTemplate.js";  



test.describe("Import for Template, Destination, Alert", () => {
    let loginPage, managementPage, alertTemplate;
    const emailName = `email${Date.now()}@gmail.com`;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        managementPage = new ManagementPage(page);
        alertTemplate = new AlertTemplate(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();
        
    });


    test("Import Template", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.addAlertTemplate("test");
        await alertTemplate.importTemplate("test");
        await alertTemplate.checkForTextInTable("test");
        await alertTemplate.checkForTextInTable("test");

    });

    

        

    

    
    



});
