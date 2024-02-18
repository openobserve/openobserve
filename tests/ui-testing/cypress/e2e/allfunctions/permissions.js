function generateRandomRoleName(length) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  }
export function performRolePermissionsSetup() {
    const role = generateRandomRoleName(8)
  cy.wait(4000);
  
  cy.get(
    ".q-mx-sm > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native > span"
  ).click({ force: true });
  cy.wait(2000);
  cy.contains("team1").click({ force: true });
  cy.wait(2000);
  cy.get('[data-test="menu-link-/iam-item"]').click({ force: true })
  cy.get('[data-test="iam-roles-tab"]').click({ force: true });
  cy.get('[data-test="alert-list-add-alert-btn"]').click({ force: true });
  cy.wait(2000);
  
  cy.get(".q-mt-md>>>> .q-field__control-container").type(role);
  cy.get('[data-test="add-alert-submit-btn"]').click({ force: true });
  cy.get(".text-center > div > .q-mr-md").click({ force: true });
  cy.wait("@allroles");
  cy.get('[data-test="edit-role-permissions-show-all-btn"]').click();
  cy.get('[data-test="tab-users"]').click();
  cy.get('[data-test="iam-users-selection-show-all-btn"]').click()
  cy.wait(2000);
  cy.get('[data-test="iam-users-selection-table-body-row-ankur@o2.ai-checkbox"] > .q-checkbox__inner > .q-checkbox__bg').click()
  cy.get('[data-test="edit-role-save-btn"]').click();
  cy.get('[data-test="tab-permissions"]').click()
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
export function setupRolesAndPermissions(role, entityPermissions) {
  // login with admin and perform setup
  performRolePermissionsSetup();

  // now give the permissions as needed to the given role
  entityPermissions.forEach(entity => {
    // assign all permission to the entity

    // TODO: search entity
    entity.permissions.forEach(permission => {
      assignPermission(entity.item, permission)
    })
    // TODO: clear the search
  });
}

function assignPermission(entity, permission) {
  cy.get(`[data-test="edit-role-permissions-table-body-row-${entity}-col-${permission}-checkbox"] > .q-checkbox__inner > .q-checkbox__bg > .q-checkbox__svg`).click();
}

export function deleteRole(role) {
    cy.get(
        ".q-mx-sm > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native > span"
      ).click({ force: true });
    cy.wait(2000);
      cy.contains("team1").click({ force: true });
      cy.wait(2000);

  cy.get('[data-test="menu-link-/iam-item"]').click({force:true})  
  cy.get('[data-test="iam-roles-tab"]').click({force:true})    
 
  cy.get('.q-virtual-scroll__content') // Select the tbody element
  .find('.material-icons[title="Delete"]') // Find the delete icons within the tbody
  .each(($icon) => { // Iterate over each delete icon
      cy.wrap($icon).click(); // Click on each delete icon
      cy.get('[data-test="confirm-button"]').click({force:true})
  });  
}