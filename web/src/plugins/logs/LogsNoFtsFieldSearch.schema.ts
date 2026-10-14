// Copyright 2026 OpenObserve Inc.

import { z } from "zod";
import type { SchemaField, PlanNode } from "@/utils/query/freeTextFilter";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import type { TranslateFn } from "@/types/i18n";

export interface NoFtsRecoveryStream {
  name: string;
  schema: SchemaField[];
  recoveryRoot?: PlanNode;
}

export type NoFtsFieldValues = {
  stream: string;
  field: string;
  match: "contains" | "equals";
  value: string;
};

export interface NoFtsFieldSubmission extends NoFtsFieldValues {
  predicate: string;
}

export function scalarFieldKind(
  field: SchemaField,
): "string" | "integer" | "number" | "boolean" | null {
  const type = field.type ?? "";
  if (["Utf8", "Utf8View", "LargeUtf8"].includes(type)) return "string";
  if (/^(U?Int)(8|16|32|64)$/.test(type)) return "integer";
  if (/^Float(16|32|64)$/.test(type)) return "number";
  if (type === "Boolean") return "boolean";
  return null;
}

export function searchableFields(stream: NoFtsRecoveryStream | undefined): SchemaField[] {
  return (stream?.schema ?? []).filter(
    (field) => field.name && field.name !== "column_all" && scalarFieldKind(field) !== null,
  );
}

function scalarPredicate(values: NoFtsFieldValues, streams: NoFtsRecoveryStream[]): string | null {
  const stream = streams.find((candidate) => candidate.name === values.stream);
  const field = searchableFields(stream).find((candidate) => candidate.name === values.field);
  if (!field || !values.value.trim()) return null;
  const kind = scalarFieldKind(field);
  const identifier = quoteSqlIdentifierIfNeeded(field.name);
  if (values.match === "contains") {
    return kind === "string"
      ? `(${identifier} IS NOT NULL AND str_match_ignore_case(${identifier}, '${escapeSingleQuotes(values.value.toLowerCase())}'))`
      : null;
  }
  if (values.match !== "equals") return null;
  if (kind === "string") return `${identifier} = '${escapeSingleQuotes(values.value)}'`;
  const value = values.value.trim();
  if (kind === "boolean")
    return /^(true|false)$/i.test(value) ? `${identifier} = ${value.toLowerCase()}` : null;
  if (kind === "integer") {
    if (!/^[+-]?\d+$/.test(value)) return null;
    const bits = Number(field.type?.match(/\d+$/)?.[0] ?? 64);
    const unsigned = field.type?.startsWith("UInt");
    const parsed = BigInt(value);
    const min = unsigned ? 0n : -(1n << BigInt(bits - 1));
    const max = (1n << BigInt(unsigned ? bits : bits - 1)) - 1n;
    return parsed >= min && parsed <= max ? `${identifier} = ${parsed}` : null;
  }
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value))
    ? `${identifier} = ${value}`
    : null;
}

export function fieldSearchPredicate(
  values: NoFtsFieldValues,
  streams: NoFtsRecoveryStream[],
): string | null {
  const root = streams.find((stream) => stream.name === values.stream)?.recoveryRoot;
  if (!root) return scalarPredicate(values, streams);
  let usedPositive = false;
  function render(node: PlanNode, excluded = false): string | null {
    if (node.k === "sql") return null;
    if (node.k === "text") {
      const firstPositive = !excluded && !usedPositive;
      if (!excluded) usedPositive = true;
      return scalarPredicate(
        {
          ...values,
          match: firstPositive ? values.match : "contains",
          value: firstPositive ? values.value : node.value,
        },
        streams,
      );
    }
    if (node.k === "not") {
      const child = render(node.child, !excluded);
      return child ? `NOT ${child}` : null;
    }
    if (node.k === "group") {
      const child = render(node.child, excluded);
      return child ? `(${child})` : null;
    }
    const children = node.children.map((child) => render(child, excluded));
    return children.every((child) => child !== null)
      ? `(${children.join(node.k === "and" ? " AND " : " OR ")})`
      : null;
  }
  return render(root);
}

export function fieldSearchDefaults(
  streams: NoFtsRecoveryStream[],
  term: string,
): NoFtsFieldValues {
  const stream = streams[0];
  const fields = searchableFields(stream);
  const field = fields.find((candidate) => scalarFieldKind(candidate) === "string") ?? fields[0];
  return {
    stream: stream?.name ?? "",
    field: field?.name ?? "",
    match: field && scalarFieldKind(field) === "string" ? "contains" : "equals",
    value: term,
  };
}

export function makeNoFtsFieldSchema(t: TranslateFn, streams: () => NoFtsRecoveryStream[]) {
  return z
    .object({
      stream: z.string(),
      field: z.string().min(1, t("search.noFtsRecovery.fieldRequired")),
      match: z.enum(["contains", "equals"]),
      value: z.string(),
    })
    .superRefine((values, context) => {
      const stream = streams().find((candidate) => candidate.name === values.stream);
      if (!values.value.trim() && !fieldSearchPredicate(values, streams())) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: t("search.noFtsRecovery.valueRequired"),
        });
      }
      if (!searchableFields(stream).some((field) => field.name === values.field)) {
        context.addIssue({
          code: "custom",
          path: ["field"],
          message: t("search.noFtsRecovery.fieldRequired"),
        });
      } else if (values.value.trim() && !fieldSearchPredicate(values, streams())) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: t("search.noFtsRecovery.invalidValue"),
        });
      }
    });
}
