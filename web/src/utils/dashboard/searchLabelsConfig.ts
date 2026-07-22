/**
 * Single source of truth for config panel sections.
 *
 * To add a new section, add ONE entry here:
 *   { id: "mySectionId", icon: "some-icon" }
 *
 * Fields:
 *   icon             — OIcon registry name shown before the section label
 *   defaultExpanded? — whether the section starts expanded (default: false → closed)
 *
 * Then add the section's options in useConfigPanel.ts and its UI in ConfigPanel.vue.
 */
type SectionDef = { id: string; icon: string; defaultExpanded?: boolean };

const SECTION_DEFS = [
  { id: "general", icon: "settings" },
  { id: "promqlTable", icon: "table-chart" },
  { id: "geographic", icon: "location-on" },
  { id: "legend", icon: "stacked-line-chart" },
  { id: "data", icon: "data-object" },
  { id: "axis", icon: "analytics" },
  { id: "labels", icon: "label" },
  { id: "lineStyle", icon: "show-chart" },
  { id: "table", icon: "table-chart" },
  { id: "pivotTable", icon: "table-view" },
  { id: "valueTransformations", icon: "transform" },
  { id: "fieldOverrides", icon: "tune" },
  { id: "map", icon: "layers" },
  { id: "gauge", icon: "speed" },
  { id: "layout", icon: "dashboard" },
  { id: "colors", icon: "palette" },
  { id: "drilldown", icon: "ads-click" },
  { id: "comparison", icon: "compare-arrows" },
  { id: "markLines", icon: "timeline" },
  { id: "background", icon: "image" },
] as const satisfies ReadonlyArray<SectionDef>;

export type SectionId = (typeof SECTION_DEFS)[number]["id"];

export const ORDERED_SECTION_IDS: SectionId[] = SECTION_DEFS.map(
  (s) => s.id as SectionId,
);

/** Section id → OIcon registry name for the leading icon in each section header. */
export const SECTION_ICONS: Record<SectionId, string> = Object.fromEntries(
  SECTION_DEFS.map((s) => [s.id, s.icon]),
) as Record<SectionId, string>;

export const DEFAULT_EXPANDED_SECTIONS: Record<SectionId, boolean> =
  Object.fromEntries(
    SECTION_DEFS.map((s) => [s.id, (s as SectionDef).defaultExpanded ?? false]),
  ) as Record<SectionId, boolean>;
