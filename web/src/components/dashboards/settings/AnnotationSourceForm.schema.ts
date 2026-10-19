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

import { z } from "zod";
import { cloneDeep } from "lodash-es";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type {
  AnnotationConditionGroup,
  AnnotationConditionLeaf,
  AnnotationSource,
} from "@/ts/interfaces/dashboard";
import {
  defaultAnnotationSourceColor,
  pruneBlankAnnotationConditions,
} from "@/utils/dashboard/annotationSources";
import { ensureIds } from "@/utils/alerts/alertDataTransforms";
import { getUUID } from "@/utils/zincutils";

/** A row of the panel picker: a time-series panel, or a tab heading when the dashboard has several. */
export type AnnotationPanelOption = SelectOption & { value: string };

/** An empty root group — a fresh source, or a saved tree the loader couldn't make sense of. */
export const emptyAnnotationFilterGroup = (): AnnotationConditionGroup => ({
  groupId: getUUID(),
  filterType: "group",
  logicalOperator: "AND",
  conditions: [],
});

const annotationConditionLeafSchema: z.ZodType<AnnotationConditionLeaf> = z.object({
  id: z.string().optional(),
  filterType: z.literal("condition"),
  column: z.string(),
  operator: z.string(),
  value: z.string(),
  logicalOperator: z.enum(["AND", "OR"]),
});

/** The alerts condition-tree shape (FilterGroup.vue's v2 format): a group of leaves and/or nested groups. */
const annotationConditionGroupSchema: z.ZodType<AnnotationConditionGroup> = z.lazy(() =>
  z.object({
    groupId: z.string().optional(),
    filterType: z.literal("group"),
    logicalOperator: z.enum(["AND", "OR"]),
    conditions: z.array(z.union([annotationConditionLeafSchema, annotationConditionGroupSchema])),
  }),
);

// Typed `unknown` here (not the real recursive AnnotationConditionGroup) so useOForm's eager DeepKeys walk doesn't hit TS2589.
const annotationFiltersFormSchema = annotationConditionGroupSchema as unknown as z.ZodType<unknown>;

export const makeAnnotationSourceSchema = (
  t: (_key: string) => string,
  siblingNames: string[] = [],
) =>
  z
    .object({
      name: z.string().trim().min(1, t("dashboard.annotationSources.nameRequired")),
      color: z.string(),
      enabled: z.boolean(),
      mode: z.enum(["builder", "sql"]),
      streamType: z.string(),
      stream: z.string(),
      filters: annotationFiltersFormSchema,
      query: z.string(),
      title: z.string().trim().min(1, t("dashboard.annotationSources.titleRequired")),
      description: z.string(),
      endTimeField: z.string(),
      panels: z.array(z.string()),
    })
    .superRefine((value, ctx) => {
      const takenNames = new Set(siblingNames.map((name) => name.trim().toLowerCase()));
      if (value.name.trim() && takenNames.has(value.name.trim().toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: t("dashboard.annotationSources.duplicateName"),
        });
      }
      if (value.mode === "sql") {
        if (!value.query.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["query"],
            message: t("dashboard.annotationSources.queryRequired"),
          });
        }
        return;
      }
      if (!value.streamType) {
        ctx.addIssue({
          code: "custom",
          path: ["streamType"],
          message: t("dashboard.annotationSources.streamTypeRequired"),
        });
      }
      if (!value.stream) {
        ctx.addIssue({
          code: "custom",
          path: ["stream"],
          message: t("dashboard.annotationSources.streamRequired"),
        });
      }
    });

export type AnnotationSourceFormValues = z.infer<ReturnType<typeof makeAnnotationSourceSchema>>;

export const annotationSourceDefaults = (colorIndex = 0): AnnotationSourceFormValues => ({
  name: "",
  color: defaultAnnotationSourceColor(colorIndex),
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "",
  filters: emptyAnnotationFilterGroup(),
  query: "",
  title: "",
  description: "",
  endTimeField: "",
  panels: [],
});

/** A saved tree may be missing client-only ids (groupId/id) or carry the backend's operator casing. */
const loadAnnotationFilters = (filters: AnnotationSource["filters"]): AnnotationConditionGroup =>
  filters && filters.filterType === "group"
    ? (ensureIds(cloneDeep(filters)) as AnnotationConditionGroup)
    : emptyAnnotationFilterGroup();

export const annotationSourceToFormValues = (
  source: AnnotationSource,
): AnnotationSourceFormValues => ({
  name: source.name ?? "",
  color: source.color || defaultAnnotationSourceColor(0),
  enabled: source.enabled !== false,
  mode: source.mode === "sql" ? "sql" : "builder",
  streamType: source.streamType || "logs",
  stream: source.stream ?? "",
  filters: loadAnnotationFilters(source.filters),
  query: source.query ?? "",
  title: source.title ?? "",
  description: source.description ?? "",
  endTimeField: source.endTimeField ?? "",
  panels: source.panels ?? [],
});

/** The saved source: explicit keys, empty optionals dropped, and no panel list meaning every panel. */
export const formValuesToAnnotationSource = (
  id: string,
  value: AnnotationSourceFormValues,
  // True only for an untouched, already-empty panels field; keeps it `[]` instead of reading as "all panels". Not form input, so a param, not a schema field.
  keepEmptyPanelScope = false,
): AnnotationSource => {
  const description = value.description.trim();
  const endTimeField = value.endTimeField.trim();
  const query = value.query.trim();
  return {
    id,
    name: value.name.trim(),
    color: value.color,
    enabled: value.enabled,
    mode: value.mode,
    streamType: value.streamType,
    stream: value.stream,
    filters: pruneBlankAnnotationConditions(value.filters as AnnotationConditionGroup),
    ...(value.mode === "sql" && query ? { query } : {}),
    title: value.title.trim(),
    ...(description ? { description } : {}),
    ...(endTimeField ? { endTimeField } : {}),
    ...(keepEmptyPanelScope || value.panels.length ? { panels: [...value.panels] } : {}),
  };
};
