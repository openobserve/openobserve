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

import {
  PromqlBuilderQuery,
  PromqlLabelMatcher,
  PromqlStepSpec,
  PromqlRenderer,
  PromqlStep,
  PromqlStepId,
  PromqlStepGroup,
  normalizeStepId,
} from "../types";
import { buildPromqlStepCatalog } from "./index";

class PromqlRendererImpl implements PromqlRenderer {
  private operations: Map<string, PromqlStepSpec>;

  constructor() {
    this.operations = new Map();
    this.initOperations();
  }

  private initOperations() {
    const ops = buildPromqlStepCatalog();
    ops.forEach((op) => {
      this.operations.set(op.id, op);
    });
  }

  /**
   * Render label filters as PromQL string
   * Example: {label1="value1", label2=~"regex.*"}
   */
  renderLabels(labels: PromqlLabelMatcher[]): string {
    if (labels.length === 0) return "";

    const labelStrings = labels.map((label) => {
      // Properly escape backslashes first, then double quotes
      // This is required for PromQL string literals
      const value = label.value
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"');    // Then escape double quotes
      return `${label.label}${label.op}"${value}"`;
    });

    return `{${labelStrings.join(",")}}`;
  }

  /**
   * Render a single operation
   */
  private renderOperation(
    operation: PromqlStep,
    innerExpr: string
  ): string {
    // A panel may persist an old scalar-math step id, so resolve it before
    // anything looks it up or switches on it.
    const id = normalizeStepId(operation.id);
    const def = this.operations.get(id);
    if (!def) return innerExpr;

    const params = operation.params || def.defaultParams;

    // Handle quantile_over_time first (special case with 2 params)
    if (id === PromqlStepId.QuantileOverTime) {
      const quantile = params[0] || 0.95;
      const range = params[1] || "$__interval";
      return `${id}(${quantile}, ${innerExpr}[${range}])`;
    }

    // Handle range functions (rate, increase, etc.)
    if (def.group === PromqlStepGroup.RateAndRange) {
      const range = params[0] || "$__interval";
      return `${id}(${innerExpr}[${range}])`;
    }

    // Handle aggregations (sum, avg, etc.)
    if (def.group === PromqlStepGroup.Aggregation) {
      const byLabelsParam = params[params.length - 1];
      const otherParams = params.slice(0, -1);

      // Build parameter string for functions like topk(k, ...) or quantile(q, ...)
      let funcParams = "";
      if (otherParams.length > 0) {
        funcParams = otherParams.join(", ");
      }

      // Handle byLabels as either array or string
      let labels: string[] = [];
      if (Array.isArray(byLabelsParam)) {
        labels = byLabelsParam.filter((l) => l && l.trim());
      } else if (typeof byLabelsParam === "string" && byLabelsParam.trim()) {
        labels = byLabelsParam
          .split(",")
          .map((l) => l.trim())
          .filter((l) => l);
      }

      // Use INFIX form: sum by (label) (...)
      if (labels.length > 0) {
        const byClause = ` by (${labels.join(", ")})`;

        if (funcParams) {
          // e.g., topk by (label) (k, expr)
          return `${id}${byClause} (${funcParams}, ${innerExpr})`;
        } else {
          // e.g., sum by (label) (expr)
          return `${id}${byClause} (${innerExpr})`;
        }
      }

      // No by clause
      if (funcParams) {
        // e.g., topk(k, expr)
        return `${id}(${funcParams}, ${innerExpr})`;
      }
      return `${id}(${innerExpr})`;
    }

    // Handle histogram_quantile
    if (id === PromqlStepId.HistogramQuantile) {
      const quantile = params[0] || 0.95;
      return `${id}(${quantile}, ${innerExpr})`;
    }

    // Handle binary operations (arithmetic)
    if (def.group === PromqlStepGroup.ScalarMath) {
      const value = params[0] || 0;
      switch (id) {
        case PromqlStepId.Addition:
          return `${innerExpr} + ${value}`;
        case PromqlStepId.Subtraction:
          return `${innerExpr} - ${value}`;
        case PromqlStepId.MultiplyBy:
          return `${innerExpr} * ${value}`;
        case PromqlStepId.DivideBy:
          return `${innerExpr} / ${value}`;
        case PromqlStepId.Modulo:
          return `${innerExpr} % ${value}`;
        case PromqlStepId.Exponent:
          return `${innerExpr} ^ ${value}`;
        default:
          return innerExpr;
      }
    }

    // Handle functions with no parameters
    if (params.length === 0) {
      return `${id}(${innerExpr})`;
    }

    // Handle functions with parameters

    // Functions like clamp that have params before the expression
    if (
      [
        PromqlStepId.Clamp,
        PromqlStepId.ClampMax,
        PromqlStepId.ClampMin,
        PromqlStepId.Round,
      ].includes(id as PromqlStepId)
    ) {
      if (id === PromqlStepId.Clamp) {
        return `${id}(${innerExpr}, ${params[0]}, ${params[1]})`;
      } else if (
        id === PromqlStepId.Round &&
        params[0] &&
        params[0] !== 1
      ) {
        return `${id}(${innerExpr}, ${params[0]})`;
      }
      return `${id}(${innerExpr})`;
    }

    // Default: function(innerExpr)
    return `${id}(${innerExpr})`;
  }

  /**
   * Render the complete PromQL query
   */
  renderQuery(query: PromqlBuilderQuery): string {
    // Start with metric and labels
    let queryStr = query.metric || "";
    const labelsStr = this.renderLabels(query.labels);
    if (labelsStr) {
      queryStr += labelsStr;
    } else if (queryStr) {
      // Add empty braces if we have a metric but no labels
      queryStr += "{}";
    }

    // Each step wraps the expression built so far, so the FIRST step ends up
    // innermost and the last one outermost.
    // Example: [max, rate, sum] renders as: sum(rate(max(...)))
    let currentExpr = queryStr;
    for (let i = 0; i < query.operations.length; i++) {
      currentExpr = this.renderOperation(query.operations[i], currentExpr);
    }

    return currentExpr;
  }

  /**
   * The catalog entry for a step id, accepting ids as old panels persisted them.
   */
  getStepSpec(id: string): PromqlStepSpec | undefined {
    return this.operations.get(normalizeStepId(id));
  }

  /** Every step in one group of the picker. */
  getStepsForGroup(group: string): PromqlStepSpec[] {
    return Array.from(this.operations.values()).filter(
      (op) => op.group === group
    );
  }

  /** The picker's groups, in declaration order. */
  getGroups(): string[] {
    return Object.values(PromqlStepGroup);
  }

  /**
   * Get all operations
   */
  getAllSteps(): PromqlStepSpec[] {
    return Array.from(this.operations.values());
  }
}

// Export singleton instance
export const promqlRenderer = new PromqlRendererImpl();
