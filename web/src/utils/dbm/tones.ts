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

/**
 * The two chip palettes DBM uses, and the rule for which is which.
 *
 * They are NOT interchangeable and were never meant to converge. A SOFT badge
 * is a claim the product made about a row — an insight, a recommendation, a
 * derived property — so it whispers: the row's own content stays the loudest
 * thing in the cell. A SOLID status pill is a state the DATABASE is in right
 * now — this session is the root blocker, these two statements take their locks
 * in opposite orders — and it is meant to be found while scanning past it.
 *
 * Both lived as four separate literal maps across three pages and two
 * components, which is how a fifth caller invents a fifth teal.
 */

import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** Severity shared by insights, recommendations and row chips. */
export type DbmChipTone = "error" | "warning" | "info";

/** Row chips add one tone the strips have no use for. */
export type DbmRowChipTone = DbmChipTone | "new";

/**
 * Soft badge backgrounds — the product's own claims. `new` exists only on row
 * chips: a first-seen query is not a severity, so it borrows the primary accent
 * rather than pretending to be an error.
 */
export const DBM_SOFT_TONES: Record<DbmRowChipTone, string> = {
  error: "bg-badge-error-soft-bg text-badge-error-soft-text",
  warning: "bg-badge-warning-soft-bg text-badge-warning-soft-text",
  info: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
  new: "bg-badge-primary-soft-bg text-badge-primary-soft-text",
};

/**
 * The icon that rides with each soft badge on the strips. Kept beside the
 * colours because a warning chip with an `error` glyph is the bug this pairing
 * exists to prevent.
 */
export const DBM_TONE_ICONS: Record<DbmChipTone, IconName> = {
  error: "error",
  warning: "trending-up",
  info: "insights",
};

/**
 * Solid status pills — a state the database is in. `neutral` is the third rung
 * deliberately: a session that is merely waiting is not a warning, and toning
 * it as one would make every lock wait look like an incident.
 */
export const DBM_STATUS_TONES = {
  error: "bg-status-error-bg text-status-error-text",
  warning: "bg-status-warning-bg text-status-warning-text",
  neutral: "bg-surface-subtle text-text-secondary",
} as const;

export type DbmStatusTone = keyof typeof DBM_STATUS_TONES;
