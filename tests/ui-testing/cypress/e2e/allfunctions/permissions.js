

const randomFolderName = `folder_${Math.floor(Math.random() * 100000)}`;
export function switchOrg(){
    cy.get(
        ".q-mx-sm > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native > span"
      ).click({ force: true });
    cy.wait(2000);
      cy.contains("test").click({ force: true });
      cy.wait(2000);
}
export function generateRandomRoleName(length) {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}
export function performRolePermissionsSetup(role=null) {
  if (!role) {
    role = generateRandomRoleName(8);
    cy.wait(4000);
  }

  switchOrg()

    // cy.get(
    //   ".q-mx-sm > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native > span"
    // ).click({ force: true });
    // cy.wait(2000);
    // cy.contains("test").click({ force: true });
  cy.wait(2000);
  cy.get('[data-test="menu-link-/iam-item"]').click({ force: true });
  cy.wait(100);
  cy.get('[data-test="iam-roles-tab"]').click({ force: true });
  cy.get('[data-test="iam-roles-edit-team3-role-icon"]').click({ force: true });
//   cy.get('[data-test="alert-list-add-alert-btn"]').click({ force: true });
//   cy.wait(2000);

//   cy.get('[data-test="add-role-rolename-input-btn"]').type(role);
//   cy.get('[data-test="add-alert-submit-btn"]').click({ force: true });
//   cy.get(`[data-test="iam-roles-edit-${role}-role-icon"]`).click({
//     force: true,
//   });
  cy.get(
    '[data-test="edit-role-permissions-show-all-btn"] > .q-btn__content'
  ).click();
  cy.wait("@allroles");
  cy.get('[data-test="edit-role-permissions-show-all-btn"]').click();
  cy.get('[data-test="tab-users"]').click();
  cy.get('[data-test="iam-users-selection-show-all-btn"]').click();
  cy.wait(3000);
//   cy.get(
//     '[data-test="iam-users-selection-table-body-row-neha@o2.ai-checkbox"] > .q-checkbox__inner > .q-checkbox__bg'
//   ).click();
  cy.get('[data-test="edit-role-save-btn"]').click();
  cy.get('[data-test="tab-permissions"]').click();
}

export const Permission = {
  ALL: "AllowAll",
  LIST: "AllowList",
  GET: "AllowGet",
  DELETE: "AllowDelete",
  CREATE: "AllowPost",
  UPDATE: "AllowPut",
};

export const Entity = {
  ALERTS: "alert",
  DASHBOARD_FOLDERS: "dfolder",
  DESTINATIONS: "destination",
  ENRICHMENT_TABLES: "enrichment_table",
  FUNCTIONS: "function",
  GROUPS: "group",
  KEY_VALUES: "kv",
  ORGANIZATIONS: "org",
  PASSCODE: "passcode",
  ROLES: "role",
  RUM_TOKENS: "rumtoken",
  SAVED_VIEWS: "savedviews",
  SETTINGS: "settings",
  STREAMS: "stream",
  SUMMARY: "summary",
  SYSLOG_ROUTES: "syslog-route",
  TEMPLATES: "template",
  USERS: "user",
};

/**
 * Example entityPermissions object
 * [
 *   {
 *      item: Entity.FUNCTIONS,
 *      permissions: [Permission.LIST, Permission.GET]
 *   },
 *   {
 *      item: Entity.STREAMS,
 *      permissions: [Permission.CREATE, Permission.UPDATE]
 *   },
 * ]
 *
 */
export function setupRolesAndPermissions(role,entityPermissions) {
  // login with admin and perform setup
  performRolePermissionsSetup(role);

  // now give the permissions as needed to the given role
  entityPermissions.forEach((entity) => {
    // assign all permission to the entity

    // TODO: search entity
    entity.permissions.forEach((permission) => {
      assignPermission(entity.item, permission);
    });
    // TODO: clear the search
  });
}

function assignPermission(entity, permission) {
  cy.wait(1000);
  cy.get(
    `[data-test="edit-role-permissions-table-body-row-${entity}-col-${permission}-checkbox"] > .q-checkbox__inner > .q-checkbox__bg > .q-checkbox__svg`
  ).click();
}

export function deleteRole(role) {
    switchOrg()
//   cy.wait(2000);
//     cy.get(
//         ".q-mx-sm > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native > span"
//     ).click({ force: true });
//     cy.wait(2000);
//     cy.contains("test").click({ force: true });
    cy.wait(2000);

  cy.get('[data-test="menu-link-/iam-item"]').click({ force: true });
  cy.wait(1000);
  cy.get('[data-test="iam-roles-tab"]').click({ force: true });
  cy.get(`[data-test="iam-roles-delete-${role}-role-icon"]`).click({
    force: true,
  });
  cy.get('[data-test="confirm-button"]').click({ force: true });

  //   cy.get('.q-virtual-scroll__content') // Select the tbody element
  //   .find('.material-icons[title="Delete"]') // Find the delete icons within the tbody
  //   .each(($icon) => { // Iterate over each delete icon
  //       cy.wrap($icon).click(); // Click on each delete icon
  //       cy.get('[data-test="confirm-button"]').click({force:true})
  //   });
}

export function templateCreation() {
  cy.get('[data-test="menu-link-/alerts-item"]').click({ force: true });
  cy.wait(3000);
  cy.get('[data-test="alert-templates-tab"]').click({ force: true });
  cy.wait(2000);
  cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
    force: true,
  });
  cy.wait(100);
  cy.get('[data-test="add-template-name-input"]').type("automationalert");
  const jsonString = '{"text": "{alert_name} is active"}';
  cy.get(".view-line").type(jsonString, { parseSpecialCharSequences: false });
  cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
}

export function createAlert() {
  cy.get('[data-test="alert-templates-tab"]').click({ force: true });
  cy.wait(2000);
  cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
    force: true,
  });
  cy.wait(100);
  cy.get('[data-test="add-template-name-input"]').type("automationalert");
  const jsonString = '{"text": "{alert_name} is active"}';
  cy.get(".view-line").type(jsonString, { parseSpecialCharSequences: false });
  cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
  cy.get(".q-notification__message")
    .contains("Template Saved Successfully")
    .should("be.visible");
  cy.wait(2000);
  cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
  cy.wait(3000);
  cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
    force: true,
  });

  cy.wait(5000);
  cy.get('[data-test="add-destination-name-input"]').type("cy-destination");
  cy.get('[data-test="add-destination-template-select"]').click({
    force: true,
  });
  cy.contains(".q-item__label span", "automationalert").click();
  cy.get('[data-test="add-destination-url-input"]').type(
    "https://slack.com/api"
  );
  cy.get('[data-test="add-destination-method-select"]').click({
    force: true,
  });
  cy.get(".q-menu").should("be.visible");
  cy.contains(".q-item__label span", "get").click();
  cy.get(".q-toggle__inner").click({ force: true });
  cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
  cy.get(".q-notification__message")
    .contains("Destination saved successfully")
    .should("be.visible");
  cy.wait(2000);
  cy.get('[data-test="alert-alerts-tab"]').click({ force: true });
  cy.get('[data-test="alert-list-add-alert-btn"]').click({ force: true });
  cy.get('[data-test="add-alert-name-input"]').type("cy-alert");
  cy.get(
    '[data-test="add-alert-stream-type-select"] > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon'
  ).click({ force: true });
  // Find and click on the item with text 'logs'
  cy.contains(".q-item__label", "logs").click({ force: true });
  cy.get(
    '[data-test="add-alert-stream-select"] > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon'
  ).click({ force: true });
  cy.contains(".q-item__label", "default").click();
  cy.get('[data-test="add-alert-scheduled-alert-radio"]').click({
    force: true,
  });
  cy.get(
    '[data-test="alert-conditions-select-column"] > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon'
  ).click({ force: true });
  cy.contains(".q-item__label", "_timestamp").click();
  cy.get(
    '[data-test="alert-conditions-operator-select"] > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon'
  ).click({ force: true });
  cy.contains(".q-item__label", "=").click();
  cy.get(".justify-start > .flex > .q-field").type("200");
  cy.get(
    '[data-test="add-alert-destination-select"] > .q-field > .q-field__inner > .q-field__control > .q-field__append > .q-icon'
  ).click({ force: true });
  cy.contains(".q-item__label", "cy-destination").click();
  cy.get('[data-test="add-alert-submit-btn"]').click({ force: true });
  cy.get('[data-test$="-delete-alert"]').first().scrollIntoView();
  cy.get('[data-test$="-delete-alert"]').first().click();
  cy.get('[data-test="cancel-button"] ').click({ force: true });
  cy.get('[data-test$="-delete-alert"]').each(($button) => {
    cy.wrap($button).click();
    cy.get('[data-test="confirm-button"]').click({ force: true });
  });
  cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
  cy.get(
    '[data-test="alert-destination-list-cy-destination-delete-destination"] > .q-btn__content > .q-icon > svg'
  ).click();
  cy.get('[data-test="confirm-button"]').click({ force: true });
  // cy.get("tbody tr").each(($row) => {
  //     // Click delete button
  //     cy.wrap($row).find('[data-test*="-delete-destination"]').click({ force: true });

  //     // Confirm deletion asynchronously
  //     cy.get('[data-test="confirm-button"]').then(($confirmButton) => {
  //         if ($confirmButton.is(':visible')) {
  //             cy.wrap($confirmButton).click({ force: true });
  //         }
  //     });
  // });

  cy.get('[data-test="alert-templates-tab"]').click({ force: true });
  cy.get('tbody [data-test$="-delete-template"]').each(($button) => {
    cy.wrap($button).click();
    cy.get('[data-test="confirm-button"]').click({ force: true });
  });
}


export function createDestination (){
    cy.get('[data-test="alert-templates-tab"]').click({ force: true });
  cy.wait(2000);
  cy.get('[data-test="alert-template-list-add-alert-btn"]').click({
    force: true,
  });
  cy.wait(100);
  cy.get('[data-test="add-template-name-input"]').type("automationalert");
  const jsonString = '{"text": "{alert_name} is active"}';
  cy.get(".view-line").type(jsonString, { parseSpecialCharSequences: false });
  cy.get('[data-test="add-template-submit-btn"]').click({ force: true });
  cy.get(".q-notification__message")
    .contains("Template Saved Successfully")
    .should("be.visible");
  cy.wait(2000);
  cy.get('[data-test="alert-destinations-tab"]').click({ force: true });
  cy.wait(3000);
  cy.get('[data-test="alert-destination-list-add-alert-btn"]').click({
    force: true,
  });

  cy.wait(5000);
  cy.get('[data-test="add-destination-name-input"]').type("cy-destination");
  cy.get('[data-test="add-destination-template-select"]').click({
    force: true,
  });
  cy.contains(".q-item__label span", "automationalert").click();
  cy.get('[data-test="add-destination-url-input"]').type(
    "https://slack.com/api"
  );
  cy.get('[data-test="add-destination-method-select"]').click({
    force: true,
  });
  cy.get(".q-menu").should("be.visible");
  cy.contains(".q-item__label span", "get").click();
  cy.get(".q-toggle__inner").click({ force: true });
  cy.get('[data-test="add-destination-submit-btn"]').click({ force: true });
//   cy.get(".q-notification__message")
//     .contains("Destination saved successfully")
//     .should("be.visible");
}

export function createFolder (){
    cy.wait(1000);
    cy.get('[data-test="dashboard-new-folder-btn"]').click({ force: true });
    cy.wait(100);
    cy.get('[data-test="dashboard-folder-add-name"]')
      .click({ force: true })
      .type(randomFolderName);
    cy.get('[data-test="dashboard-folder-add-save"]').click({ force: true });
    // cy.wait("@folders");
    // cy.get('[data-test="dashboard-delete-folder-icon"]').each(($deleteIcon) => {
    //     // Get the parent div and click the delete icon
    //     cy.wrap($deleteIcon).parents('.q-tab').find('[data-test="dashboard-delete-folder-icon"]').click({ force: true });
    //     cy.get('[data-test="confirm-button"]').click({ force: true });
    // });
  
}