// Copyright 2026 OpenObserve Inc.
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

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { ref } from "vue";

import { gt } from "@/types/i18n";
import echartsUrl from "echarts/dist/echarts.min.js?url";
import dompurifyUrl from "dompurify/dist/purify.min.js?url";

export const panelIdToBeRefreshed = ref<string | null>(null);

// import.meta.url is this chunk's URL, so relative ?url paths resolve to the correct assets directory.
const sandboxEchartsUrl = new URL(echartsUrl, import.meta.url).href;
const sandboxDompurifyUrl = new URL(dompurifyUrl, import.meta.url).href;

// Exact first-party chart code allowed to run its callbacks in the app origin; stored dashboard code never is.
const trustedCustomChartCode = new Set<string>();

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */

export const runJavaScriptCode = (panelSchema: any, searchQueryData: any) => {
  return new Promise((resolve, reject) => {
    // Skip if this panel is not the one to be refreshed
    if (panelIdToBeRefreshed.value && panelIdToBeRefreshed.value !== panelSchema.id) {
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(iframe);

    let userCode = panelSchema.customChartContent;

    // **Validation before execution**
    const validationError = validateUserCode(userCode);
    if (validationError) {
      reject(new Error(gt("dashboard.utils.unsafeCodeDetected", { error: validationError })));
      document.body.removeChild(iframe);
      return;
    }

    // Generate a nonce
    const nonce = Math.random().toString(36).substring(2);
    const fnTag = `__o2_fn_${randomHex()}`;
    const trusted = trustedCustomChartCode.has(userCode);

    // The sandbox iframe has no access to the app's i18n instance, so the messages it
    // posts back are translated here and injected as a frozen JSON literal.
    const sandboxMessages = JSON.stringify({
      cspViolationPrefix: gt("dashboard.utils.cspViolationPrefix"),
      executionTimeout: gt("dashboard.utils.executionTimeout"),
      executionErrorPrefix: gt("dashboard.utils.executionErrorPrefix"),
      cspViolationBlocked: gt("dashboard.utils.cspViolationBlocked"),
    });

    const scriptContent = `
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'self' 'nonce-${nonce}';
    style-src 'none';
    frame-src 'none';
    connect-src 'none';
  ">

  <script src="${sandboxEchartsUrl}" nonce="${nonce}"></script>
  <script src="${sandboxDompurifyUrl}" nonce="${nonce}"></script>
  <script nonce="${nonce}">
    const i18nMessages = ${sandboxMessages};
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
        message: i18nMessages.cspViolationPrefix + event.violatedDirective + ' blocked ' + event.blockedURI
      }, '*');
    });

    // Handle script execution with a timeout
    let executed = false;
    window.addEventListener('message', (event) => {
      // A sibling custom-chart frame can post here too; only the parent may hand over code.
      if (event.source !== parent || executed) return;
      if (event.data.type === 'execute') {
        executed = true;
        try {
          const data = JSON.parse(event.data.data);
          const userCode = event.data.code.trim();
          const fnTag = event.data.fnTag;

          const convertFunctionsToString = (obj) => {
            if (typeof obj === 'function') {
              try {
                return { [fnTag]: DOMPurify.sanitize(obj.toString()) };
              } catch (e) {
                return undefined;
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
            parent.postMessage({ type: 'error', message: i18nMessages.executionTimeout }, '*');
          }, 2000);

          (function(data, echarts) {
            try {
              ${userCode};
            } catch (err) {
              parent.postMessage({ type: 'error', message: i18nMessages.executionErrorPrefix + err.message }, '*');
              return;
            }

            clearTimeout(timeout); // Clear timeout if execution completes
            
            // Ensure CSP violations are detected before responding
            setTimeout(() => {
              
              if (securityPolicyError || cspViolationDetected) {
                parent.postMessage({ type: 'error', message: i18nMessages.cspViolationBlocked }, '*');
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
        try {
          resolve(rehydrateFunctions(JSON.parse(event.data.result), fnTag, trusted));
        } catch (error) {
          reject(error);
        }
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
      iframe?.contentWindow?.postMessage(
        {
          type: "execute",
          code: userCode,
          fnTag,
          data: JSON.stringify(searchQueryData),
        },
        "*",
      );
    };
  });
};

export const validateUserCode = (code: string): string | null => {
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
        if (node.callee.type === "Identifier" && forbiddenFunctions.includes(node.callee.name)) {
          errorMessage = gt("dashboard.utils.forbiddenFunctionCall", { name: node.callee.name });
        }

        // **Detect setTimeout() misuse**
        if (node.callee.type === "Identifier" && node.callee.name === "setTimeout") {
          if (
            node.arguments.length > 1 &&
            node.arguments[1].type === "Literal" &&
            typeof node.arguments[1].value === "number"
          ) {
            const delay = node.arguments[1].value;
            if (delay < 100) {
              errorMessage = gt("dashboard.utils.unsafeSetTimeoutDelay");
            }
          } else {
            errorMessage = gt("dashboard.utils.invalidSetTimeoutUsage");
          }

          // Block setTimeout(() => eval(...))
          if (
            node.arguments.length > 0 &&
            node.arguments[0].type === "CallExpression" &&
            node.arguments[0].callee.type === "Identifier" &&
            (node.arguments[0].callee.name === "eval" ||
              node.arguments[0].callee.name === "Function")
          ) {
            errorMessage = gt("dashboard.utils.forbiddenInsideSetTimeout", {
              name: node.arguments[0].callee.name,
            });
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
          errorMessage = gt("dashboard.utils.obfuscatedFunctionCall");
        }
      },

      MemberExpression(node: acorn.Node & { object: any; property: any }) {
        // **Detect direct access to forbidden objects (e.g., document.cookie, localStorage.setItem)**
        if (node.object.type === "Identifier" && forbiddenIdentifiers.includes(node.object.name)) {
          errorMessage = gt("dashboard.utils.forbiddenIdentifierAccess", {
            name: node.object.name,
          });
        }

        // **Detect obfuscated method calls like this[x] where x is created using .join("")**
        if (
          node.property.type === "CallExpression" &&
          node.property.callee.type === "MemberExpression" &&
          node.property.callee.property.name === "join"
        ) {
          errorMessage = gt("dashboard.utils.obfuscatedAccessDetected");
        }
      },

      WhileStatement(node: acorn.Node & { test: any }) {
        // **Detect `while (true)`**
        if (node.test.type === "Literal" && node.test.value === true) {
          errorMessage = gt("dashboard.utils.infiniteWhileLoop");
        }
      },

      ForStatement(node: acorn.Node & acorn.ForStatement) {
        // **Detect `for(;;)` which means infinite loop**
        if (!node.test) {
          errorMessage = gt("dashboard.utils.infiniteForLoop");
        }
      },
      NewExpression(node: acorn.Node & { callee: any }) {
        if (node.callee.type === "Identifier" && node.callee.name === "Function") {
          errorMessage = gt("dashboard.utils.newFunctionNotAllowed");
        }
      },
    });

    return errorMessage;
  } catch (error) {
    return gt("dashboard.utils.invalidJavaScriptSyntax");
  }
};

/** Marks first-party chart code (curated packs) whose function callbacks may run in the app. */
export const trustCustomChartCode = (code: string): string => {
  trustedCustomChartCode.add(code);
  return code;
};

/** Turns sandbox-tagged functions back into callables for trusted code; drops them otherwise. */
export const rehydrateFunctions = (value: unknown, fnTag: string, trusted: boolean): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => rehydrateFunctions(item, fnTag, trusted));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Object.prototype.hasOwnProperty.call(value, fnTag)) {
    const source = (value as Record<string, unknown>)[fnTag];
    if (!trusted || typeof source !== "string") return undefined;
    return new Function(`return ${source}`)();
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, rehydrateFunctions(child, fnTag, trusted)]),
  );
};

// crypto.randomUUID needs a secure context; plain-http deployments still need an unguessable tag.
const randomHex = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
