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

import { isEqual } from "lodash-es";
import metricsService from "@/services/metrics";
import { gt, type I18nKey } from "@/types/i18n";
import { promqlRenderer } from "./operations/queryModeller";
import {
  PromqlStepGroup,
  PromqlStepId,
  type PromqlBuilderQuery,
  type PromqlLabelMatcher,
  type PromqlStep,
} from "./types";

export type PromqlTree = { type: string; [key: string]: any };

export type BuilderMapping =
  { ok: true; query: PromqlBuilderQuery } | { ok: false; reason: string };

type Layer =
  | { step: PromqlStep; inner: PromqlTree }
  | { step?: PromqlStep; selector: { name: string | null; matchers: PromqlLabelMatcher[] } }
  | { reason: string };

const SCALAR_STEPS: Record<string, PromqlStepId> = {
  "+": PromqlStepId.Addition,
  "-": PromqlStepId.Subtraction,
  "*": PromqlStepId.MultiplyBy,
  "/": PromqlStepId.DivideBy,
  "%": PromqlStepId.Modulo,
  "^": PromqlStepId.Exponent,
};

const cannotShow = (construct: string) =>
  gt("metrics.builderSwitch.unsupported", { construct }) as string;

const KIND_PHRASES: Record<string, I18nKey> = {
  without: "metrics.builderSwitch.constructs.without",
  offset: "metrics.builderSwitch.constructs.offset",
  "@": "metrics.builderSwitch.constructs.at",
  "or matchers": "metrics.builderSwitch.constructs.orMatchers",
  subquery: "metrics.builderSwitch.constructs.subquery",
  "vector matching": "metrics.builderSwitch.constructs.vectorMatching",
  bool: "metrics.builderSwitch.constructs.bool",
  "unary minus": "metrics.builderSwitch.constructs.unaryMinus",
  string: "metrics.builderSwitch.constructs.string",
  "non-finite number": "metrics.builderSwitch.constructs.nonFinite",
  "range vector": "metrics.builderSwitch.constructs.rangeVector",
};

const SET_OPERATORS = new Set(["and", "or", "unless"]);

/** The refusal for a backend `unsupported` kind; a kind with no words gets the generic one. */
const cannotShowKind = (kind: string): string => {
  if (SET_OPERATORS.has(kind)) {
    return cannotShow(gt("metrics.builderSwitch.constructs.setOperator", { op: kind }) as string);
  }
  if (!KIND_PHRASES[kind]) return gt("metrics.builderSwitch.mismatch") as string;
  return cannotShow(gt(KIND_PHRASES[kind]) as string);
};

const functionPhrase = (name: string) =>
  gt("metrics.builderSwitch.constructs.function", { name }) as string;

const isNumber = (node: PromqlTree | undefined): boolean => node?.type === "number";

const hasMetric = (node: PromqlTree | undefined): boolean => {
  if (!node || typeof node !== "object") return false;
  if (node.type === "selector" || node.type === "matrix") return true;
  return Object.values(node).some((value) =>
    Array.isArray(value) ? value.some(hasMetric) : hasMetric(value),
  );
};

const isTree = (value: unknown): value is PromqlTree =>
  !!value && typeof value === "object" && "type" in value && typeof value.type === "string";

const stripValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripValue);
  if (isTree(value)) return stripParens(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, stripValue(inner)]));
};

export const stripParens = (tree: PromqlTree): PromqlTree => {
  if (tree.type === "paren") return stripParens(tree.expr);
  const out: PromqlTree = { type: tree.type };
  for (const [key, value] of Object.entries(tree)) {
    if (key !== "type") out[key] = stripValue(value);
  }
  return out;
};

/** A range function reads the matrix directly, so it is always the innermost step. */
const rangeLayer = (func: string, args: PromqlTree[]): Layer => {
  const withQuantile = func === PromqlStepId.QuantileOverTime;
  const [quantile, matrix] = withQuantile ? args : [undefined, args[0]];
  if (args.length !== (withQuantile ? 2 : 1)) return { reason: cannotShow(functionPhrase(func)) };
  if (matrix?.type === "unsupported") return { reason: cannotShowKind(matrix.kind) };
  if (matrix?.type !== "matrix" || (withQuantile && !isNumber(quantile))) {
    return { reason: cannotShow(functionPhrase(func)) };
  }
  const params = withQuantile ? [quantile!.value, matrix.range] : [matrix.range];
  return { step: { id: func, params }, selector: matrix.selector };
};

/** `[leading numbers…, expr, trailing numbers…]` as each catalog function takes them. */
const functionLayer = (func: string, args: PromqlTree[]): Layer => {
  const fail = { reason: cannotShow(functionPhrase(func)) };
  const numbers = (nodes: PromqlTree[]) =>
    nodes.every(isNumber) ? nodes.map((node) => node.value) : null;
  let inner: PromqlTree | undefined;
  let params: number[] | null;
  switch (func) {
    case PromqlStepId.HistogramQuantile:
      [inner, params] = [args[1], args.length === 2 ? numbers(args.slice(0, 1)) : null];
      break;
    case PromqlStepId.Clamp:
      [inner, params] = [args[0], args.length === 3 ? numbers(args.slice(1)) : null];
      break;
    case PromqlStepId.ClampMax:
    case PromqlStepId.ClampMin:
      [inner, params] = [args[0], args.length === 2 ? numbers(args.slice(1)) : null];
      break;
    case PromqlStepId.Round:
      [inner, params] = [args[0], args.length <= 2 ? numbers(args.slice(1)) : null];
      if (params?.length === 0) params = [1];
      break;
    default:
      [inner, params] = [args[0], args.length === 1 ? [] : null];
  }
  if (!inner || !params) return fail;
  return { step: { id: func, params }, inner };
};

const callLayer = (node: PromqlTree): Layer => {
  const spec = promqlRenderer.getStepSpec(node.func);
  if (!spec || spec.retired) return { reason: cannotShow(functionPhrase(node.func)) };
  return spec.group === PromqlStepGroup.RateAndRange
    ? rangeLayer(node.func, node.args)
    : functionLayer(node.func, node.args);
};

const aggregateLayer = (node: PromqlTree): Layer => {
  const spec = promqlRenderer.getStepSpec(node.op);
  if (spec?.group !== PromqlStepGroup.Aggregation || spec.retired) {
    return {
      reason: cannotShow(
        gt("metrics.builderSwitch.constructs.aggregation", { name: node.op }) as string,
      ),
    };
  }
  const takesParam = spec.params.length === 2;
  if (takesParam !== !!node.param || (node.param && !isNumber(node.param))) {
    return {
      reason: cannotShow(
        gt("metrics.builderSwitch.constructs.aggregation", { name: node.op }) as string,
      ),
    };
  }
  const params = takesParam ? [node.param.value, node.by] : [node.by];
  return { step: { id: node.op, params }, inner: node.expr };
};

const binaryLayer = (node: PromqlTree): Layer => {
  // A side the backend could not express hides its metric, so name what it is instead.
  const opaque = [node.lhs, node.rhs].find((side) => side?.type === "unsupported");
  if (opaque) return { reason: cannotShowKind(opaque.kind) };
  const stepId = SCALAR_STEPS[node.op];
  if (stepId && isNumber(node.rhs)) {
    return { step: { id: stepId, params: [node.rhs.value] }, inner: node.lhs };
  }
  if (hasMetric(node.lhs) && hasMetric(node.rhs)) {
    return { reason: gt("metrics.builderSwitch.twoMetrics") as string };
  }
  if (stepId && isNumber(node.lhs))
    return {
      reason: cannotShow(
        gt("metrics.builderSwitch.constructs.numberFirst", { op: node.op }) as string,
      ),
    };
  return {
    reason: cannotShow(gt("metrics.builderSwitch.constructs.operator", { op: node.op }) as string),
  };
};

const layerOf = (node: PromqlTree): Layer => {
  switch (node.type) {
    case "selector":
      return { selector: node as any };
    case "call":
      return callLayer(node);
    case "aggregate":
      return aggregateLayer(node);
    case "binary":
      return binaryLayer(node);
    case "unsupported":
      return { reason: cannotShowKind(node.kind) };
    case "matrix":
      return { reason: cannotShowKind("range vector") };
    default:
      return { reason: gt("metrics.builderSwitch.noMetric") as string };
  }
};

export const treeToBuilder = (tree: PromqlTree): BuilderMapping => {
  const steps: PromqlStep[] = [];
  let node = stripParens(tree);
  for (;;) {
    const layer = layerOf(node);
    if ("reason" in layer) return { ok: false, reason: layer.reason };
    if (layer.step) steps.push(layer.step);
    if ("selector" in layer) {
      if (!layer.selector.name) {
        return { ok: false, reason: gt("metrics.builderSwitch.noMetric") as string };
      }
      return {
        ok: true,
        query: {
          metric: layer.selector.name,
          labels: layer.selector.matchers,
          operations: steps.reverse(),
        },
      };
    }
    node = layer.inner;
  }
};

const parse = async (org: string, query: string): Promise<PromqlTree> =>
  (await metricsService.parsePromqlQuery({ org_identifier: org, query })).data.data;

const parseError = (error: any): string =>
  error?.response?.data?.error ?? error?.message ?? String(error);

/** Maps `text` onto the builder only if the builder renders it back to the same tree. */
export const promqlToBuilder = async (org: string, text: string): Promise<BuilderMapping> => {
  let tree: PromqlTree;
  try {
    tree = await parse(org, text);
  } catch (error) {
    return { ok: false, reason: parseError(error) };
  }
  const mapped = treeToBuilder(tree);
  if (!mapped.ok) return mapped;
  const mismatch = { ok: false as const, reason: gt("metrics.builderSwitch.mismatch") as string };
  try {
    const again = await parse(org, promqlRenderer.renderQuery(mapped.query));
    return isEqual(stripParens(tree), stripParens(again)) ? mapped : mismatch;
  } catch {
    return mismatch;
  }
};
