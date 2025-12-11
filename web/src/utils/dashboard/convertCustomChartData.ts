// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import router from "src/router";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { ref } from 'vue';
import { formatDate, isTimeSeries, isTimeStamp } from "./convertDataIntoUnitValue";
import { toZonedTime } from "date-fns-tz";

// Add at the top of the file
export const panelIdToBeRefreshed = ref<string | null>(null);

/**
 * Formats timestamp fields in the data array for custom charts.
 * Converts 16-digit microsecond timestamps to formatted date strings using timezone.
 * 
 * @param {any[]} data - The data array from query results
 * @param {string} timezone - The timezone to use for conversion
 * @returns {any[]} - Data array with formatted timestamps
 */
const formatCustomChartTimestamps = (data: any[], timezone: string = 'UTC'): any[] => {
  if (!Array.isArray(data) || data.length === 0) {
    return data;
  }

  // Handle nested array structure [[...data...]]
  const dataArray = Array.isArray(data[0]) ? data[0] : data;
  
  if (dataArray.length === 0 || typeof dataArray[0] !== 'object') {
    return data;
  }

  // Get all keys from first object
  const sampleKeys = Object.keys(dataArray[0]);
  
  // Check each key to see if it contains timestamp data
  const timestampKeys: string[] = [];
  const timeSeriesKeys: string[] = [];
  
  for (const key of sampleKeys) {
    // Get sample values for this key (filter out null/undefined)
    const sampleValues = dataArray
      .slice(0, Math.min(10, dataArray.length))
      .map((item: any) => item[key])
      .filter((val: any) => val != null);
    
    if (sampleValues.length === 0) continue;
    
    // Check if this key contains timestamps (16-digit microseconds)
    if (isTimeStamp(sampleValues, null)) {
      timestampKeys.push(key);
    }
    // Check if this key contains ISO time series
    else if (isTimeSeries(sampleValues)) {
      timeSeriesKeys.push(key);
    }
  }

  // If no timestamp keys found, return original data
  if (timestampKeys.length === 0 && timeSeriesKeys.length === 0) {
    return data;
  }

  // Format timestamps in the data
  const formattedData = dataArray.map((item: any) => {
    const formatted = { ...item };
    
    // Convert 16-digit timestamps to formatted dates with timezone
    timestampKeys.forEach((key) => {
      const value = item[key];
      if (value != null) {
        try {
          // Convert microseconds to milliseconds, apply timezone, then format
          const timestamp = parseInt(value.toString());
          const dateInTimezone = toZonedTime(
            new Date(timestamp / 1000),
            timezone
          );
          formatted[key] = formatDate(dateInTimezone);
        } catch (e) {
          formatted[key] = value;
        }
      }
    });
    
    // Convert ISO time series to formatted dates with timezone
    timeSeriesKeys.forEach((key) => {
      const value = item[key];
      if (value != null && typeof value === 'string') {
        try {
          // Parse ISO string, add Z for UTC, apply timezone, then format
          const dateInTimezone = toZonedTime(
            new Date(value + 'Z'),
            timezone
          );
          formatted[key] = formatDate(dateInTimezone);
        } catch (e) {
          formatted[key] = value;
        }
      }
    });
    
    return formatted;
  });

  // Return in same structure as input
  return Array.isArray(data[0]) ? [formattedData] : formattedData;
};

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */


export const runJavaScriptCode = (panelSchema: any, searchQueryData: any, timezone: string = 'UTC') => {
  return new Promise((resolve, reject) => {
    // Skip if this panel is not the one to be refreshed
    if (panelIdToBeRefreshed.value && panelIdToBeRefreshed.value !== panelSchema.id) {
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(iframe);

    let staticEchartsRef = "/web/src/assets/dashboard/echarts.min.js";
    let staticPurifierRef = "/web/src/assets/dashboard/purify.min.js";

    if (!window.location.pathname.includes("web")) {
      staticEchartsRef = "/src/assets/dashboard/echarts.min.js";
      staticPurifierRef = "/src/assets/dashboard/purify.min.js";
    }
    let userCode = panelSchema.customChartContent;

    // **Validation before execution**
    const validationError = validateUserCode(userCode);
    if (validationError) {
      reject(new Error(`Unsafe code detected: ${validationError}`));
      document.body.removeChild(iframe);
      return;
    }

    // Generate a nonce
    const nonce = Math.random().toString(36).substring(2);

    const scriptContent = `
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'self' 'nonce-${nonce}';
    style-src 'none';
    frame-src 'none';
    connect-src 'none';
  ">

  <script src="${staticEchartsRef}" nonce="${nonce}"></script>
  <script src="${staticPurifierRef}" nonce="${nonce}"></script>
  <script nonce="${nonce}">
    let securityPolicyError = false;
    let cspViolationDetected = false;

    window.onerror = function(message, source, lineno, colno, error) {
      parent.postMessage({ type: 'error', message: message.toString() }, '*');
    };

    // Detect CSP Violations
    document.addEventListener("securitypolicyviolation", (event) => {
      securityPolicyError = true;
      cspViolationDetected = true;
      parent.postMessage({ 
        type: 'error', 
        message: 'CSP Violation: ' + event.violatedDirective + ' blocked ' + event.blockedURI 
      }, '*');
    });

    // Handle script execution with a timeout
    window.addEventListener('message', (event) => {
      if (event.data.type === 'execute') {
        try {
          const data = JSON.parse(event.data.data);
          const userCode = event.data.code.trim();

          const convertFunctionsToString = (obj) => {
            if (typeof obj === 'function') {
              try {
                const functionString = obj.toString();
                return DOMPurify.sanitize(functionString); // Sanitize function string
              } catch (e) {
                return 'Error sanitizing function';
              }
            }
            if (Array.isArray(obj)) return obj.map(convertFunctionsToString);
            if (typeof obj === 'object' && obj !== null) {
              return Object.fromEntries(
                Object.entries(obj).map(([key, value]) => [key, convertFunctionsToString(value)])
              );
            }
            return obj;
          };


          // Execution timeout to prevent infinite loops
          const timeout = setTimeout(() => {
            parent.postMessage({ type: 'error', message: 'Execution Timeout: Script took too long to run' }, '*');
          }, 2000);

          (function(data, echarts) {
            try {
              // Make queryResult available globally for template compatibility
              window.queryResult = data;
              ${userCode};
            } catch (err) {
              parent.postMessage({ type: 'error', message: 'Execution Error: ' + err.message }, '*');
              return;
            }

            clearTimeout(timeout); // Clear timeout if execution completes
            
            // Ensure CSP violations are detected before responding
            setTimeout(() => {
              
              if (securityPolicyError || cspViolationDetected) {
                parent.postMessage({ type: 'error', message: 'CSP Violation Detected. Execution blocked.' }, '*');
              } else {
                parent.postMessage({ type: 'success', result: JSON.stringify(convertFunctionsToString(option)) }, '*');
              }
            }, 0); // Delay to ensure CSP events have time to process

          })(data, window.echarts);

        } catch (error) {
          parent.postMessage({ type: 'error', message: error.message }, '*');
        }
      }
    });
  </script>
    `;



    iframe.srcdoc = scriptContent;

    window.addEventListener("message", function handler(event) {
      if (event.source !== iframe.contentWindow) return;

      // Double check if this is still the panel to be refreshed
      if (panelIdToBeRefreshed.value && panelIdToBeRefreshed.value !== panelSchema.id) {
        window.removeEventListener("message", handler);
        document.body.removeChild(iframe);
        return;
      }

      window.removeEventListener("message", handler);
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);

      if (event.data.type === "success") {
        resolve(JSON.parse(event.data.result));
        // Clear the panelIdToBeRefreshed after success
        if (panelIdToBeRefreshed.value === panelSchema.id) {
          panelIdToBeRefreshed.value = null;
        }
      } else if (event.data.type === "error") {
        console.error("Error executing code", event.data.message);
        reject(new Error(event.data.message));
      }
    });

    iframe.onload = () => {
      // Format timestamps in the data before passing to custom chart
      const formattedData = formatCustomChartTimestamps(searchQueryData, timezone);
      
      iframe?.contentWindow?.postMessage(
        {
          type: "execute",
          code: userCode, 
          data: JSON.stringify(formattedData),
        },
        "*"
      );
    };
  });
};



const validateUserCode = (code: string): string | null => {
  try {
    // Parse the code using Acorn
    const ast = acorn.parse(code, { ecmaVersion: 2020 }) as acorn.Node;

    let errorMessage: string | null = null;

    const forbiddenIdentifiers: string[] = [
      "window",
      "document",
      "localStorage",
      "sessionStorage",
      "navigator",
      "fetch",
      "XMLHttpRequest",
    ];

    const forbiddenFunctions: string[] = [
      "eval",
      "setInterval", // Completely blocked
      "Function",
      "require",
      "alert",
      "fetch",
      "XMLHttpRequest",
    ];

    // Walk through the AST and analyze the code
    walk.simple(ast, {
      CallExpression(node: acorn.Node & { callee: any; arguments: any[] }) {
        // **Direct function call check (eval(), fetch(), etc.)**
        if (
          node.callee.type === "Identifier" &&
          forbiddenFunctions.includes(node.callee.name)
        ) {
          errorMessage = `Use of '${node.callee.name}()' is not allowed.`;
        }

        // **Detect setTimeout() misuse**
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "setTimeout"
        ) {
          if (
            node.arguments.length > 1 &&
            node.arguments[1].type === "Literal" &&
            typeof node.arguments[1].value === "number"
          ) {
            const delay = node.arguments[1].value;
            if (delay < 100) {
              errorMessage = "Use of 'setTimeout()' with delay < 100ms is not allowed.";
            }
          } else {
            errorMessage = "Invalid usage of 'setTimeout()'.";
          }

          // Block setTimeout(() => eval(...))
          if (
            node.arguments.length > 0 &&
            node.arguments[0].type === "CallExpression" &&
            node.arguments[0].callee.type === "Identifier" &&
           ( node.arguments[0].callee.name === "eval" || node.arguments[0].callee.name === "Function")
          ) {
            errorMessage = `Use of ${node.arguments[0].callee.name} inside 'setTimeout()' is not allowed.`;
          }
        }

        // **Detect obfuscation like ['f','e','t','c','h'].join('')**
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "join" &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal" &&
          node.arguments[0].value === ""
        ) {
          errorMessage = "Obfuscated function call detected.";
        }
      },

      MemberExpression(node: acorn.Node & { object: any; property: any }) {
        // **Detect direct access to forbidden objects (e.g., document.cookie, localStorage.setItem)**
        if (
          node.object.type === "Identifier" &&
          forbiddenIdentifiers.includes(node.object.name)
        ) {
          errorMessage = `Access to '${node.object.name}' is not allowed.`;
        }

        // **Detect obfuscated method calls like this[x] where x is created using .join("")**
        if (
          node.property.type === "CallExpression" &&
          node.property.callee.type === "MemberExpression" &&
          node.property.callee.property.name === "join"
        ) {
          errorMessage = "Obfuscated method/property access detected.";
        }
      },

      WhileStatement(node: acorn.Node & { test: any }) {
        // **Detect `while (true)`**
        if (node.test.type === "Literal" && node.test.value === true) {
          errorMessage = "Infinite loop using 'while(true)' is not allowed.";
        }
      },

      ForStatement(node: acorn.Node & acorn.ForStatement) {
        // **Detect `for(;;)` which means infinite loop**
        if (!node.test) {
          errorMessage = "Infinite loop using 'for(;;)' is not allowed.";
        }
      },
      NewExpression(node: acorn.Node & { callee: any }) {
        if (node.callee.type === "Identifier" && node.callee.name === "Function") {
          errorMessage = "Use of 'new Function()' is not allowed.";
        }
      },
    });

    return errorMessage;
  } catch (error) {
    return "Invalid JavaScript syntax.";
  }
};









