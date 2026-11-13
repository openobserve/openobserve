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
import type { CustomChartRun } from "./customChartSandbox";

// Single-panel refresh targets, each mapped to whether its load has settled; emptied once all have.
export const panelRefreshTargets = new Map<string, boolean>();

// Bumped when a single-panel refresh ends, so charts that skipped a run meanwhile can replay it.
export const panelRefreshEpoch = ref(0);

/** Read-only dashboard state handed to custom chart code as `context`. */
export interface CustomChartContext {
  variables: Record<string, unknown>;
  timeRange: { start: number; end: number };
  timezone: string;
  theme: "light" | "dark";
}

/** Rejects a run skipped because another panel is being refreshed; the caller keeps its current chart. */
export class CustomChartSkippedError extends Error {}

/** True while a single-panel refresh is in flight that did not target this panel. */
export const isSkippedByPanelRefresh = (panelId: string | undefined) =>
  panelRefreshTargets.size > 0 && !(panelId && panelRefreshTargets.has(panelId));

/** Marks a target's load as settled; the refresh ends once every target has settled. */
export const settlePanelRefresh = (panelId: string | undefined) => {
  if (!panelId || !panelRefreshTargets.has(panelId)) return;
  panelRefreshTargets.set(panelId, true);
  if ([...panelRefreshTargets.values()].every(Boolean)) {
    panelRefreshTargets.clear();
    panelRefreshEpoch.value++;
  }
};

/** Builds a panel run for the sandbox renderer; throws CustomChartSkippedError while another panel refreshes. */
export const prepareCustomChartRun = (
  panelSchema: { id?: string; customChartContent?: string },
  searchQueryData: unknown,
  context?: CustomChartContext,
): CustomChartRun => {
  if (isSkippedByPanelRefresh(panelSchema.id)) throw new CustomChartSkippedError();
  return {
    code: panelSchema.customChartContent ?? "",
    data: searchQueryData,
    context,
    panelId: panelSchema.id,
  };
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
