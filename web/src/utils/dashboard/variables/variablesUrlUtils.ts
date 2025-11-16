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

/**
 * Gets the effective value for a variable in a given context
 * Applies precedence: panel > tab > global
 *
 * @param variableName - Name of the variable
 * @param allVariables - All variables data
 * @param context - Current context (tabId, panelId)
 * @returns The effective value for the variable in the given context
 */
export const getEffectiveVariableValue = (
  variableName: string,
  allVariables: VariableValue[],
  context: { tabId?: string; panelId?: string }
): any => {
  const variable = allVariables.find((v) => v.name === variableName);

  if (!variable) {
    return null;
  }

  // Global scope - return direct value
  if (variable.scope === 'global') {
    return variable.value;
  }

  // Tab scope - find value for current tab
  if (variable.scope === 'tabs' && context.tabId && Array.isArray(variable.value)) {
    const tabValue = variable.value.find((tv: any) => tv.tabId === context.tabId);
    return tabValue ? tabValue.value : null;
  }

  // Panel scope - find value for current panel
  if (variable.scope === 'panels' && context.panelId && Array.isArray(variable.value)) {
    const panelValue = variable.value.find((pv: any) => pv.panelId === context.panelId);
    return panelValue ? panelValue.value : null;
  }

  // Fallback for tab/panel scoped variables without context
  if (variable.scope === 'tabs' || variable.scope === 'panels') {
    if (Array.isArray(variable.value) && variable.value.length > 0) {
      return variable.value[0].value;
    }
  }

  return variable.value;
};

/**
 * Resolves all variables for a given context with proper precedence
 * Panel-level > Tab-level > Global-level
 *
 * @param allVariables - All variables data
 * @param context - Current context (tabId, panelId)
 * @returns Map of variable names to their effective values
 */
export const resolveVariablesForContext = (
  allVariables: VariableValue[],
  context: { tabId?: string; panelId?: string }
): Record<string, any> => {
  const resolved: Record<string, any> = {};

  // Group variables by name (may have multiple scopes)
  const variablesByName: Record<string, VariableValue[]> = {};

  allVariables.forEach((variable) => {
    if (!variablesByName[variable.name]) {
      variablesByName[variable.name] = [];
    }
    variablesByName[variable.name].push(variable);
  });

  // Resolve each variable with precedence
  Object.keys(variablesByName).forEach((name) => {
    const variables = variablesByName[name];

    // Priority: panel > tab > global
    let effectiveValue = null;
    let found = false;

    // 1. Check panel-level first
    if (context.panelId) {
      const panelVar = variables.find((v) => v.scope === 'panels');
      if (panelVar && Array.isArray(panelVar.value)) {
        const panelValue = panelVar.value.find((pv: any) => pv.panelId === context.panelId);
        if (panelValue && panelValue.value !== null && panelValue.value !== undefined) {
          effectiveValue = panelValue.value;
          found = true;
        }
      }
    }

    // 2. Check tab-level next
    if (!found && context.tabId) {
      const tabVar = variables.find((v) => v.scope === 'tabs');
      if (tabVar && Array.isArray(tabVar.value)) {
        const tabValue = tabVar.value.find((tv: any) => tv.tabId === context.tabId);
        if (tabValue && tabValue.value !== null && tabValue.value !== undefined) {
          effectiveValue = tabValue.value;
          found = true;
        }
      }
    }

    // 3. Fall back to global
    if (!found) {
      const globalVar = variables.find((v) => v.scope === 'global');
      if (globalVar && globalVar.value !== null && globalVar.value !== undefined) {
        effectiveValue = globalVar.value;
        found = true;
      }
    }

    resolved[name] = effectiveValue;
  });

  return resolved;
};
