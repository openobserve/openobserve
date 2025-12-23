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

import {
  PromVisualQuery,
  QueryBuilderLabelFilter,
  QueryBuilderOperationDef,
  PromQueryModeller,
  QueryBuilderOperation,
  PromOperationId,
  PromVisualQueryOperationCategory,
} from "../types";
import { getOperationDefinitions } from "./index";

class PromQueryModellerClass implements PromQueryModeller {
  private operations: Map<string, QueryBuilderOperationDef>;

  constructor() {
    this.operations = new Map();
    this.initOperations();
  }

  private initOperations() {
    const ops = getOperationDefinitions();
    ops.forEach((op) => {
      this.operations.set(op.id, op);
    });
  }

  /**
   * Render label filters as PromQL string
   * Example: {label1="value1", label2=~"regex.*"}
   */
  renderLabels(labels: QueryBuilderLabelFilter[]): string {
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
    operation: QueryBuilderOperation,
    innerExpr: string
  ): string {
    const def = this.operations.get(operation.id);
    if (!def) return innerExpr;

    const params = operation.params || def.defaultParams;

    // Handle quantile_over_time first (special case with 2 params)
    if (operation.id === PromOperationId.QuantileOverTime) {
      const quantile = params[0] || 0.95;
      const range = params[1] || "$__interval";
      return `${operation.id}(${quantile}, ${innerExpr}[${range}])`;
    }

    // Handle range functions (rate, increase, etc.)
    if (def.category === PromVisualQueryOperationCategory.RangeFunctions) {
      const range = params[0] || "$__interval";
      return `${operation.id}(${innerExpr}[${range}])`;
    }

    // Handle aggregations (sum, avg, etc.)
    if (def.category === PromVisualQueryOperationCategory.Aggregations) {
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
          return `${operation.id}${byClause} (${funcParams}, ${innerExpr})`;
        } else {
          // e.g., sum by (label) (expr)
          return `${operation.id}${byClause} (${innerExpr})`;
        }
      }

      // No by clause
      if (funcParams) {
        // e.g., topk(k, expr)
        return `${operation.id}(${funcParams}, ${innerExpr})`;
      }
      return `${operation.id}(${innerExpr})`;
    }

    // Handle histogram_quantile
    if (operation.id === PromOperationId.HistogramQuantile) {
      const quantile = params[0] || 0.95;
      return `${operation.id}(${quantile}, ${innerExpr})`;
    }

    // Handle binary operations (arithmetic)
    if (def.category === PromVisualQueryOperationCategory.BinaryOps) {
      const value = params[0] || 0;
      switch (operation.id) {
        case PromOperationId.Addition:
          return `${innerExpr} + ${value}`;
        case PromOperationId.Subtraction:
          return `${innerExpr} - ${value}`;
        case PromOperationId.MultiplyBy:
          return `${innerExpr} * ${value}`;
        case PromOperationId.DivideBy:
          return `${innerExpr} / ${value}`;
        case PromOperationId.Modulo:
          return `${innerExpr} % ${value}`;
        case PromOperationId.Exponent:
          return `${innerExpr} ^ ${value}`;
        default:
          return innerExpr;
      }
    }

    // Handle functions with no parameters
    if (params.length === 0) {
      return `${operation.id}(${innerExpr})`;
    }

    // Handle functions with parameters
    const paramStr = params.map((p) => (typeof p === "string" ? p : p)).join(", ");

    // Functions like clamp that have params before the expression
    if (
      [
        PromOperationId.Clamp,
        PromOperationId.ClampMax,
        PromOperationId.ClampMin,
        PromOperationId.Round,
      ].includes(operation.id as PromOperationId)
    ) {
      if (operation.id === PromOperationId.Clamp) {
        return `${operation.id}(${innerExpr}, ${params[0]}, ${params[1]})`;
      } else if (
        operation.id === PromOperationId.Round &&
        params[0] &&
        params[0] !== 1
      ) {
        return `${operation.id}(${innerExpr}, ${params[0]})`;
      }
      return `${operation.id}(${innerExpr})`;
    }

    // Default: function(innerExpr)
    return `${operation.id}(${innerExpr})`;
  }

  /**
   * Render the complete PromQL query
   */
  renderQuery(query: PromVisualQuery): string {
    // Start with metric and labels
    let queryStr = query.metric || "";
    const labelsStr = this.renderLabels(query.labels);
    if (labelsStr) {
      queryStr += labelsStr;
    } else if (queryStr) {
      // Add empty braces if we have a metric but no labels
      queryStr += "{}";
    }

    // Apply operations from LAST to FIRST (right-to-left)
    // This way, the last added operation wraps all previous ones
    // Example: [max, rate, sum] renders as: sum(rate(max(...)))
    let currentExpr = queryStr;
    for (let i = 0; i < query.operations.length; i++) {
      currentExpr = this.renderOperation(query.operations[i], currentExpr);
    }

    return currentExpr;
  }

  /**
   * Get operation definition by ID
   */
  getOperationDef(id: string): QueryBuilderOperationDef | undefined {
    return this.operations.get(id);
  }

  /**
   * Get all operations for a specific category
   */
  getOperationsForCategory(category: string): QueryBuilderOperationDef[] {
    return Array.from(this.operations.values()).filter(
      (op) => op.category === category
    );
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    return Object.values(PromVisualQueryOperationCategory);
  }

  /**
   * Get all operations
   */
  getAllOperations(): QueryBuilderOperationDef[] {
    return Array.from(this.operations.values());
  }
}

// Export singleton instance
export const promQueryModeller = new PromQueryModellerClass();
