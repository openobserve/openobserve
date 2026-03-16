export type SectionId =
  | "general"
  | "geographic"
  | "legend"
  | "data"
  | "axis"
  | "labels"
  | "lineStyle"
  | "table"
  | "valueTransformations"
  | "fieldOverrides"
  | "map"
  | "gauge"
  | "layout"
  | "colors"
  | "drilldown"
  | "comparison"
  | "markLines"
  | "background";

export const ORDERED_SECTION_IDS: SectionId[] = [
  "general",
  "geographic",
  "legend",
  "data",
  "axis",
  "labels",
  "lineStyle",
  "table",
  "valueTransformations",
  "fieldOverrides",
  "map",
  "gauge",
  "layout",
  "colors",
  "drilldown",
  "comparison",
  "markLines",
  "background",
];

export const DEFAULT_EXPANDED_SECTIONS: Record<SectionId, boolean> = {
  general: true,
  geographic: true,
  legend: true,
  data: true,
  axis: true,
  labels: true,
  lineStyle: true,
  table: true,
  valueTransformations: true,
  fieldOverrides: true,
  map: true,
  gauge: true,
  layout: true,
  colors: true,
  drilldown: true,
  comparison: true,
  markLines: true,
  background: true,
};
