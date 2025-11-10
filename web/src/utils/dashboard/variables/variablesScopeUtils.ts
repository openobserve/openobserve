/**
 * Utility functions for determining variable scope types
 */

/**
 * Determines the scope type of a variable based on its configuration
 * @param variable - Variable object with optional panels and tabs arrays
 * @returns "panels" | "tabs" | "global"
 */
export const getScopeType = (variable: any): "panels" | "tabs" | "global" => {
  if (variable.panels && variable.panels.length > 0) {
    return "panels";
  } else if (variable.tabs && variable.tabs.length > 0) {
    return "tabs";
  } else {
    return "global";
  }
};
