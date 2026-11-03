// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/**
 * How complete a section is:
 * - `done` — everything it needs is set (tick)
 * - `saved` — set and unchanged since it was saved (muted tick)
 * - `changed` — edited since it was saved (words from `stateLabel`)
 * - `attention` — a required value is missing (words from `stateLabel`)
 * - `error` — a value is invalid (words from `stateLabel`)
 * - `none` — nothing to report
 */
export type SectionNavState = "done" | "saved" | "changed" | "attention" | "error" | "none";

export interface SectionNavItem {
  /** Section id, matched against `active` and emitted on select. */
  id: string;
  /** Section title. */
  title: I18nText;
  /** One short phrase describing what the section holds now. */
  summary?: I18nText;
  /** Completion state. Default: 'none' */
  state?: SectionNavState;
  /** Words shown for the `changed`, `attention` and `error` states. */
  stateLabel?: I18nText;
}

export interface OSectionNavProps {
  /** Sections in display order. */
  items: SectionNavItem[];
  /** Id of the section in view. */
  active?: string;
  /** Accessible name of the navigation landmark. */
  label: I18nText;
}

export interface OSectionNavEmits {
  /** A section was picked. */
  (e: "select", id: string): void;
}
