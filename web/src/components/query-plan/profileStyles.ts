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

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import type { I18nKey, I18nText } from "@/types/i18n";
import type { OperatorCategory, PhaseId, VariantRole } from "@/utils/queryProfile";

export interface StackSegment {
  id: string;
  value: number;
  swatch: string;
  label: I18nText;
  display: string;
}

export interface NodeBar {
  key: string;
  ratio: number;
  tone: "default" | "hot" | "off";
  title: string;
}

export interface NodeNameRow {
  id: string;
  name: string;
  role: string;
  straggler: boolean;
  active: boolean;
  error: string;
  skipped: boolean;
}

export interface CategoryStyle {
  icon: IconName;
  labelKey: I18nKey;
  border: string;
  chip: string;
  swatch: string;
  fill: string;
  text: string;
}

/** Literal class strings per operator family; Tailwind only emits classes it can read here. */
export const CATEGORY_STYLE: Record<OperatorCategory, CategoryStyle> = {
  scan: {
    icon: "storage",
    labelKey: "search.queryProfile.categoryScan",
    border: "border-s-badge-teal-solid-bg",
    chip: "bg-badge-teal-soft-bg text-badge-teal-soft-text",
    swatch: "bg-badge-teal-solid-bg",
    fill: "var(--color-badge-teal-solid-bg)",
    text: "text-badge-teal-soft-text",
  },
  filter: {
    icon: "filter-alt",
    labelKey: "search.queryProfile.categoryFilter",
    border: "border-s-badge-error-solid-bg",
    chip: "bg-badge-error-soft-bg text-badge-error-soft-text",
    swatch: "bg-badge-error-solid-bg",
    fill: "var(--color-badge-error-solid-bg)",
    text: "text-badge-error-soft-text",
  },
  join: {
    icon: "merge",
    labelKey: "search.queryProfile.categoryJoin",
    border: "border-s-badge-indigo-solid-bg",
    chip: "bg-badge-indigo-soft-bg text-badge-indigo-soft-text",
    swatch: "bg-badge-indigo-solid-bg",
    fill: "var(--color-badge-indigo-solid-bg)",
    text: "text-badge-indigo-soft-text",
  },
  agg: {
    icon: "functions",
    labelKey: "search.queryProfile.categoryAgg",
    border: "border-s-badge-orange-solid-bg",
    chip: "bg-badge-orange-soft-bg text-badge-orange-soft-text",
    swatch: "bg-badge-orange-solid-bg",
    fill: "var(--color-badge-orange-solid-bg)",
    text: "text-badge-orange-soft-text",
  },
  sort: {
    icon: "swap-vert",
    labelKey: "search.queryProfile.categorySort",
    border: "border-s-badge-blue-solid-bg",
    chip: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
    swatch: "bg-badge-blue-solid-bg",
    fill: "var(--color-badge-blue-solid-bg)",
    text: "text-badge-blue-soft-text",
  },
  exchange: {
    icon: "swap-horiz",
    labelKey: "search.queryProfile.categoryExchange",
    border: "border-s-badge-default-soft-text",
    chip: "bg-badge-default-soft-bg text-badge-default-soft-text",
    swatch: "bg-badge-default-soft-text",
    fill: "var(--color-badge-default-soft-text)",
    text: "text-badge-default-soft-text",
  },
  projection: {
    icon: "table-view",
    labelKey: "search.queryProfile.categoryProjection",
    border: "border-s-badge-lime-solid-bg",
    chip: "bg-badge-lime-soft-bg text-badge-lime-soft-text",
    swatch: "bg-badge-lime-solid-bg",
    fill: "var(--color-badge-lime-solid-bg)",
    text: "text-badge-lime-soft-text",
  },
  remote: {
    icon: "hub",
    labelKey: "search.queryProfile.categoryRemote",
    border: "border-s-badge-purple-solid-bg",
    chip: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
    swatch: "bg-badge-purple-solid-bg",
    fill: "var(--color-badge-purple-solid-bg)",
    text: "text-badge-purple-soft-text",
  },
  other: {
    icon: "account-tree",
    labelKey: "search.queryProfile.categoryOther",
    border: "border-s-border-strong",
    chip: "bg-surface-subtle text-text-secondary",
    swatch: "bg-border-strong",
    fill: "var(--color-border-strong)",
    text: "text-text-heading",
  },
};

export const SHARE_BADGE: Record<"none" | "low" | "mid" | "high", BadgeVariant> = {
  none: "default-soft",
  low: "success-soft",
  mid: "warning-soft",
  high: "error-soft",
};

export const SHARE_BAR: Record<"none" | "low" | "mid" | "high", ProgressBarVariant> = {
  none: "neutral",
  low: "success",
  mid: "warning",
  high: "danger",
};

export const PHASE_STYLE: Record<PhaseId, { labelKey: I18nKey; swatch: string }> = {
  queue: { labelKey: "search.queryProfile.phaseQueue", swatch: "bg-badge-amber-solid-bg" },
  fileList: { labelKey: "search.queryProfile.phaseFileList", swatch: "bg-badge-indigo-solid-bg" },
  index: { labelKey: "search.queryProfile.phaseIndex", swatch: "bg-badge-blue-solid-bg" },
  execution: { labelKey: "search.queryProfile.phaseExecution", swatch: "bg-badge-teal-solid-bg" },
  other: { labelKey: "search.queryProfile.phaseOther", swatch: "bg-badge-default-soft-text" },
};

const STAGE_SWATCHES = [
  "bg-badge-teal-solid-bg",
  "bg-badge-blue-solid-bg",
  "bg-badge-indigo-solid-bg",
  "bg-badge-orange-solid-bg",
  "bg-badge-lime-solid-bg",
];

export const STRAGGLER_SWATCH = "bg-status-negative";

export function stageSwatch(stageIndex: number): string {
  return STAGE_SWATCHES[(stageIndex - 1) % STAGE_SWATCHES.length];
}

export const VARIANT_ROLE_KEY: Record<Exclude<VariantRole, "mixed">, I18nKey> = {
  querier: "search.queryProfile.queriers",
  ingester: "search.queryProfile.ingesters",
};
