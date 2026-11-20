// Copyright 2026 OpenObserve Inc.
// A real <dl> of one entity's properties; comparing rows is a table's job, not this one's.

import type { ComputedRef, InjectionKey } from "vue";
import type { I18nText } from "@/types/i18n";

/** `text` for entity properties, `mono` for field keys and machine values (T4). */
export type DescriptionLabels = "text" | "mono";

/** `auto` puts labels beside values and stacks them when the list is under 30rem wide. */
export type DescriptionLayout = "columns" | "stacked" | "auto";

export type DescriptionValue = string | number | null | undefined;

export interface DescriptionListItem {
  label: I18nText;
  value?: DescriptionValue;
  /** A machine value inside a `text` list. */
  mono?: boolean;
  /** Offers copy on hover. */
  copy?: boolean;
}

export interface DescriptionListProps {
  /** Rendered as items; children `ODescriptionItem`s work instead. */
  items?: DescriptionListItem[];
  labels?: DescriptionLabels;
  layout?: DescriptionLayout;
  /** Shown for a missing value; "—" in tertiary text by default (C4, D4). */
  emptyLabel?: I18nText;
}

export interface DescriptionContext {
  labels: DescriptionLabels;
  emptyLabel: I18nText;
}

export const DESCRIPTION_CONTEXT: InjectionKey<ComputedRef<DescriptionContext>> =
  Symbol("descriptionContext");

export interface DescriptionItemProps {
  label: I18nText;
  /** The value as data; the default slot replaces it with rich content. */
  value?: DescriptionValue;
  /** Overrides the list's empty label for this row. */
  emptyLabel?: I18nText;
  mono?: boolean;
  copy?: boolean;
}

export interface DescriptionListSlots {
  default?: () => unknown;
}

export interface DescriptionItemSlots {
  default?: () => unknown;
  /** Replaces the label, e.g. a label plus a help tooltip. */
  label?: () => unknown;
}
