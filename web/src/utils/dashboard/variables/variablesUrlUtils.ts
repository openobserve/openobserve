/**
 * Utility functions for URL syncing of dashboard variables with scope support
 *
 * URL Pattern: var-{variableName}[.{scopePrefix}.{scopeId}]={value}
 *
 * Examples:
 * - Global:  var-namespace=dev-api
 * - Tab:     var-region.t.tab1=us-east
 * - Panel:   var-metric.p.panel123=cpu
 */

export interface VariableValue {
  name: string;
  scope: 'global' | 'tabs' | 'panels';
  value: any;
  _isCurrentLevel?: boolean;
}

/**
 * Encodes a variable value to URL query parameter format
 * @param variable - Variable object with name, scope, and value
 * @param currentTabId - Current active tab ID (needed for tab-scoped variables)
 * @param currentPanelId - Current panel ID (needed for panel-scoped variables)
 * @returns Object with query parameter key-value pairs
 */
export const encodeVariableToUrl = (
  variable: VariableValue,
  currentTabId?: string,
  currentPanelId?: string
): Record<string, any> => {
  const result: Record<string, any> = {};

  // Handle different scopes
  switch (variable.scope) {
    case 'global':
      // Global: var-{name}={value}
      result[`var-${variable.name}`] = variable.value;
      break;

    case 'tabs':
      // Tab: var-{name}.t.{tabId}={value}
      if (Array.isArray(variable.value)) {
        // Multi-tab variable - encode each tab's value
        variable.value.forEach((tabValue: { tabId: string; value: any }) => {
          if (tabValue.tabId && tabValue.value !== null && tabValue.value !== undefined) {
            result[`var-${variable.name}.t.${tabValue.tabId}`] = tabValue.value;
          }
        });
      } else if (currentTabId) {
        // Single value for current tab
        result[`var-${variable.name}.t.${currentTabId}`] = variable.value;
      }
      break;

    case 'panels':
      // Panel: var-{name}.p.{panelId}={value}
      if (Array.isArray(variable.value)) {
        // Multi-panel variable - encode each panel's value
        variable.value.forEach((panelValue: { panelId: string; value: any }) => {
          if (panelValue.panelId && panelValue.value !== null && panelValue.value !== undefined) {
            result[`var-${variable.name}.p.${panelValue.panelId}`] = panelValue.value;
          }
        });
      } else if (currentPanelId) {
        // Single value for current panel
        result[`var-${variable.name}.p.${currentPanelId}`] = variable.value;
      }
      break;
  }

  return result;
};

/**
 * Encodes all variables to URL query parameters
 * @param variables - Array of variable objects
 * @param currentTabId - Current active tab ID
 * @returns Object with all query parameter key-value pairs
 */
export const encodeVariablesToUrl = (
  variables: VariableValue[],
  currentTabId?: string
): Record<string, any> => {
  const result: Record<string, any> = {};

  variables.forEach((variable) => {
    const encoded = encodeVariableToUrl(variable, currentTabId);
    Object.assign(result, encoded);
  });

  return result;
};

interface ParsedVariable {
  name: string;
  scope: 'global' | 'tabs' | 'panels';
  scopeId?: string;
  value: any;
}

/**
 * Parses a variable URL key to extract name, scope, and scope ID
 * @param key - URL query parameter key (e.g., "var-namespace", "var-region.t.tab1")
 * @returns Parsed variable information
 */
export const parseVariableUrlKey = (key: string): ParsedVariable | null => {
  // Remove "var-" prefix
  if (!key.startsWith('var-')) {
    return null;
  }

  const withoutPrefix = key.slice(4); // Remove "var-"

  // Check for scope pattern: {name}.{scopePrefix}.{scopeId}
  const scopeMatch = withoutPrefix.match(/^([^.]+)\.(t|p)\.(.+)$/);

  if (scopeMatch) {
    const [, name, scopePrefix, scopeId] = scopeMatch;
    const scope = scopePrefix === 't' ? 'tabs' : 'panels';
    return { name, scope, scopeId, value: null };
  }

  // Global variable (no scope pattern)
  return { name: withoutPrefix, scope: 'global', value: null };
};

/**
 * Decodes URL query parameters to variable values
 * @param queryParams - URL query parameters object
 * @returns Object mapping variable names to their values (organized by scope)
 */
export const decodeVariablesFromUrl = (queryParams: Record<string, any>): Record<string, any> => {
  const result: Record<string, any> = {};

  Object.keys(queryParams).forEach((key) => {
    if (!key.startsWith('var-')) {
      return;
    }

    const parsed = parseVariableUrlKey(key);
    if (!parsed) {
      return;
    }

    const { name, scope, scopeId } = parsed;
    const value = queryParams[key];

    // Initialize variable entry if doesn't exist
    if (!result[name]) {
      result[name] = {
        name,
        scope,
        value: scope === 'global' ? value : [],
      };
    }

    // Handle scoped variables
    if (scope === 'tabs' && scopeId) {
      if (!Array.isArray(result[name].value)) {
        result[name].value = [];
      }
      result[name].value.push({ tabId: scopeId, value });
    } else if (scope === 'panels' && scopeId) {
      if (!Array.isArray(result[name].value)) {
        result[name].value = [];
      }
      result[name].value.push({ panelId: scopeId, value });
    } else if (scope === 'global') {
      result[name].value = value;
    }
  });

  return result;
};

