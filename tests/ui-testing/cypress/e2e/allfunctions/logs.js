import { getTestId, getRandomText } from "../utils";
import logData from "../../fixtures/log.json";

function removeUTFCharacters(text) {
  // console.log(text, "tex");
  // Remove UTF characters using regular expression
  return text.replace(/[^\x00-\x7F]/g, " ");
}

const showHistogramToggle = getTestId(
  "logs-search-bar-show-histogram-toggle-btn"
);
const showSQLModeHistogramToggle = getTestId(
  "logs-search-bar-show-histogram-toggle-sqlmode-btn"
);
const logsSearchBarChart = getTestId("logs-search-result-bar-chart");
const vrlFunctionEditor = getTestId("logs-vrl-function-editor");
const searchBarSqlModeButton = getTestId("logs-search-bar-sql-mode-toggle-btn");
const logsSearchQueryToggle = getTestId(
  "logs-search-bar-show-query-toggle-btn"
);
const queryEditor = getTestId("logs-search-bar-query-editor");
const saveFunctionDropdown = getTestId("logs-search-bar-function-dropdown")
const vrlQueryToggle = getTestId("logs-search-bar-show-query-toggle-btn")
const functionNameField = getTestId("saved-function-name-input")
const savedViewDialogButton = getTestId("saved-view-dialog-save-btn")
const functionsViaMenu = getTestId("menu-link-/functions-item")
const function_delete_confirm = getTestId("confirm-button")


const firstVrlEditor = `${vrlFunctionEditor}:first`
const LOGS_SEARCH_EXPAND = `[data-test="log-search-expand-${logData.expandedFieldValue.field}-field-btn]`;
const SAVED_FUNCTION_BUTTON = `${saveFunctionDropdown} > .q-btn-dropdown--current > .q-btn__content > :nth-child(1)`


const NOTIFICATION_MESSAGE = ".q-notification__message"
const DELETE_FUNCTION = '[title="Delete Function"]'


/** Verify if histogram toggle button is clicked */
export function clickHistogramToggle() {
  cy.get(showHistogramToggle, { timeout: 2000 }).click({ force: true });
}

/** Verify if the chart is hidden */
export function confirmLogsSearchHidden() {
  cy.get(logsSearchBarChart, { timeout: 2000 }).should("not.exist",{ timeout: 10000, interval: 1000 });
}

/** Verify if vrl function editor is visible */
export function displayVrlFunctionEditor() {
  cy.get(vrlFunctionEditor, { timeout: 2000 }).should("be.visible");
}

/** Verify if logs search query toggle is clicked*/
export function clickSearchBarSqlMode() {
  cy.get(searchBarSqlModeButton, { timeout: 2000 })
    .eq(0)
    .click({ force: true });
}

/** Verify if logs search query toggle is clicked*/
export function clickLogsSearchQueryToggle() {
  cy.get(logsSearchQueryToggle, { timeout: 2000 }).click({ force: true });
}

/** Verify if the vrl function editor is hidden */
export function vrlFunctionEditorHidden() {
  cy.get(vrlFunctionEditor, { timeout: 2000 }).should("be.hidden");
}

/** Verify if the vrl function editor is hidden */
export function histogramToggleDisabled() {
  cy.get(showSQLModeHistogramToggle, { timeout: 2000 }).should(
    "have.attr",
    "aria-disabled",
    "true"
  );
}

export function histogramToggleEnabled() {
  cy.get(showSQLModeHistogramToggle, { timeout: 2000 }).should(
    "not.have.attr",
    "aria-disabled",
    "true"
  );
}


//** Type the value of a variable into an input field*/
export function enterVrlFunctionvalue() {
  cy.get('[data-test="logs-vrl-function-editor"]:first', { timeout: 2000 })
    .click()
    .type(logData.vrlFunctionValue);
}

//**  Verify that the input field no longer has the attribute "data-test" with the value of the variable */
export function attributeToNotHaveVrlFunctionvalue() {
  cy.get(vrlFunctionEditor, { timeout: 2000 }).should(
    "not.have.attr",
    "data-test",
    logData.vrlFunctionValue
  );
}

//**  Verify that the input field no longer has the attribute "data-test" with the value of the variable */
export function expandLogsSearch() {
  cy.get(
    `[data-test="log-search-expand-${logData.expandedFieldValue.field}-field-btn"]`,
    { timeout: 2000 }
  ).trigger("mouseover", { force: true });
}

//**  Verify that the input field no longer has the attribute "data-test" with the value of the variable */
export function verifyLogsStatusCode() {
  cy.get(
    `[data-test="log-search-expand-${logData.expandedFieldValue.field}-field-btn"]`,
    { timeout: 2000 }
  ).click({ force: true });
}

// get the value of the field name
export function clickValueEditor() {
  cy.get(
    `[data-test="log-search-expand-${logData.addEditorFieldValue.field}-field-btn"]`,
    { timeout: 2000 }
  ).trigger("mouseover", { force: true });
}
// ** click on the + button on expanded view/
export function clickExpandedViewplusButton() {
  cy.get(
    `[data-test="log-search-expand-${logData.addEditorFieldValue.field}-field-btn"] [data-test="log-search-index-list-filter-${logData.addEditorFieldValue.field}-field-btn"]`,
    { timeout: 2000 }
  ).click({ force: true });
}

//**  Verify that a value is added under query editor */
export function addValueInQueryEditor() {
  cy.get(queryEditor, { timeout: 2000 }).type(
    `{backspace}${logData.addEditorFieldValue.value}'`
  );
}

//**  Verify that a value is added under query editor */
export function verifyAddedValue() {
  cy.get(queryEditor).then((editor) => {
    let text = editor.text();
    const expectedString = `${logData.addEditorFieldValue.field}='${logData.addEditorFieldValue.value},'`;
    text = removeUTFCharacters(text);
    expect(text.includes(expectedString)).to.be.false;
  });
}

//**  add second value in query */
export function addMoreValueQueryEditor() {
  cy.get(
    `[data-test="log-search-expand-${logData.addEditorFieldValue.field1}-field-btn"] [data-test="log-search-index-list-filter-${logData.addEditorFieldValue.field1}-field-btn"]`,
    { timeout: 3000 }
  ).click({ force: true });
}

//**  Verify if value is added on the editor when = is clicked*/
export function addSecondValues() {
  cy.get(queryEditor, { timeout: 2000 }).type(
    `{backspace}${logData.addEditorFieldValue.value1}'`
  );
}

//**  Verify if value is added on the editor when = is clicked*/
export function valueAddedInSqlMode() {
  cy.get(queryEditor, { timeout: 2000 }).then((editor) => {
    let text = editor.text();
    const expectedString = `${logData.addEditorFieldValue.field}='${logData.addEditorFieldValue.value}' and ${logData.addEditorFieldValue.field1}='${logData.addEditorFieldValue.value1}'`;
    text = removeUTFCharacters(text);
    expect(text.includes(expectedString)).to.be.true;
  });
}

//**  Verify if add value field is clicked*/
export function addFeildandSubValue() {
  cy.get(
    `[data-test="log-search-expand-${logData.addFieldAndSubFieldValueWithEqual.field}-field-btn"]`
  ).click({ force: true });
}

export function addsubFieldValue() {
  cy.get(
    `[data-test="logs-search-subfield-add-${logData.addFieldAndSubFieldValueWithEqual.field}-${logData.addFieldAndSubFieldValueWithEqual.subFieldValue}"] `
  ).trigger("mouseover", { force: true });
}

export function clickFieldSubvalue() {
  cy.get(
    `[data-test="logs-search-subfield-add-${logData.addFieldAndSubFieldValueWithEqual.field}-${logData.addFieldAndSubFieldValueWithEqual.subFieldValue}"] [data-test="log-search-subfield-list-equal-${logData.addFieldAndSubFieldValueWithEqual.field}-field-btn"]`
  ).click({ force: true });
}



//**  Verify if value is added on the editor when = is clicked*/
export function valueAddedOnPlusClick() {
  cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
    let text = editor.text();
    expect(
      text.includes(
        `${logData.addFieldAndSubFieldValueWithEqual.field}='${logData.addFieldAndSubFieldValueWithEqual.subFieldValue}'`
      )
    ).to.be.true;
  });

}


//**  Verify if value is added on the editor when = is clicked*/
export function clickOnFirstField() {
  cy.get(
    `[data-test="log-search-expand-${logData.addFieldAndSubFieldValueWithEqual.field1}-field-btn"]`
  ).click({ force: true });
  

}


// //**  Verify if value is added on the editor when = is clicked*/
 export function addSecondFieldOnEditor() {
  cy.get(
    `[data-test="logs-search-subfield-add-${logData.addFieldAndSubFieldValueWithEqual.field}-${logData.addFieldAndSubFieldValueWithEqual.subFieldValue}"] `
  ).trigger("mouseover", { force: true });
  

 }


 export function clickOnEqualToButton() {
  cy.get(
    `[data-test="logs-search-subfield-add-${logData.addFieldAndSubFieldValueWithEqual.field}-${logData.addFieldAndSubFieldValueWithEqual.subFieldValue}"] [data-test="log-search-subfield-list-equal-${logData.addFieldAndSubFieldValueWithEqual.field}-field-btn"]`
  ).click({ force: true });
  

 }

//**assertion for added both field value is added on the editor when = is clicked*/
 export function bothFieldAddedOnEqualToClick() {
  cy.get('[data-test="logs-search-bar-query-editor"]').then((editor) => {
    let text = editor.text();
    const expectedString = `${logData.addFieldAndSubFieldValueWithEqual.field}='${logData.addFieldAndSubFieldValueWithEqual.subFieldValue}' and ${logData.addFieldAndSubFieldValueWithEqual.field1}='${logData.addFieldAndSubFieldValueWithEqual.subFieldValue1}'`;
    text = removeUTFCharacters(text);
    expect(text.includes(expectedString)).to.be.false;
  });

 }


 export function clickSaveFunctionButton() {
  cy.get(SAVED_FUNCTION_BUTTON,{timeout:2000}).click({ force: true });
}


export function clickVrlQueryToggle() {
  cy.get(vrlQueryToggle,{timeout:2000}).click({ force: true });
}

export function enterTextVrlQueryEditor(vrlQueryText) {
  cy.get(firstVrlEditor,{timeout:2000}).type(vrlQueryText)
}


export function noFunctionFoundMessage() {
  cy.get(NOTIFICATION_MESSAGE,{timeout:2000})
  .should('be.visible')
  .contains('No function definition found')
}

export function enterFunctionName(functiontext) {
  cy.get(functionNameField,{timeout:2000}).type(functiontext)
}

export function clickSavedOkButton() {
  cy.get(savedViewDialogButton,{timeout:2000}).click({ force: true });
}

export function clickFunctionsViaMenu() {
  cy.get(functionsViaMenu,{timeout:2000}).click({ force: true });
}

export function deleteCreatedFunction() {
  cy.get(DELETE_FUNCTION,{timeout:2000}).click({ multiple: true });
}

export function confirmFunctionDeleteButton() {
  cy.get(function_delete_confirm,{timeout:2000}).click({ force: true });
}