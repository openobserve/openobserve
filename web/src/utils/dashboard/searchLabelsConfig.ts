/**
 * Single source of truth for config panel sections.
 *
 * To add a new section, add ONE entry here:
 *   { id: "mySectionId" }
 *
 * Optional fields:
 *   defaultExpanded?: boolean  — whether the section starts expanded (default: true)
 *
 * Then add the section's options in useConfigPanel.ts and its UI in ConfigPanel.vue.
 */
const SECTION_DEFS = [
  { id: "general" },
  { id: "promqlTable" },
  { id: "geographic" },
  { id: "legend" },
  { id: "data" },
  { id: "axis" },
  { id: "labels" },
  { id: "lineStyle" },
  { id: "table" },
  { id: "pivotTable" },
  { id: "valueTransformations" },
  { id: "fieldOverrides" },
  { id: "map" },
  { id: "gauge" },
  { id: "layout" },
  { id: "colors" },
  { id: "drilldown" },
  { id: "comparison" },
  { id: "markLines" },
  { id: "background" },
] as const satisfies ReadonlyArray<{ id: string; defaultExpanded?: boolean }>;

export type SectionId = (typeof SECTION_DEFS)[number]["id"];

export const ORDERED_SECTION_IDS: SectionId[] = SECTION_DEFS.map(
  (s) => s.id as SectionId,
);

export const DEFAULT_EXPANDED_SECTIONS: Record<SectionId, boolean> =
  Object.fromEntries(
    SECTION_DEFS.map((s) => [s.id, (s as { id: string; defaultExpanded?: boolean }).defaultExpanded ?? true]),
  ) as Record<SectionId, boolean>;
