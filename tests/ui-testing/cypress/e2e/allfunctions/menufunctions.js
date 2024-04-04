import { getTestId, getRandomText } from "../utils";
import logData from "../../fixtures/log.json";


const showHistogramToggle = getTestId(
    "logs-search-bar-show-histogram-toggle-btn"
  );
 
  const queryEditor = getTestId("query-editor");
  
  const LOGS_SEARCH_EXPAND = `[data-test="log-search-expand-${logData.expandedFieldValue.field}-field-btn]`;
  const MENU = ('q-drawer__content > .q-list')
  
  export function menuDisplayed() {
    cy.get(MENU, { timeout: 2000 }).should('be.visible');
  }
  