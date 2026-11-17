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

import type { I18nKey, I18nText } from "@/types/i18n";

export type UnfoldKind =
  "metric" | "log" | "trace" | "change" | "unwatched" | "forecast" | "outcome" | "alert" | "fold";
export type UnfoldOutcome =
  | "paged"
  | "asked"
  | "notified"
  | "held"
  | "fixFailed"
  | "fixed"
  | "resolved"
  | "open"
  | "acknowledged";
// "team" marks your team's lane, apart from every alert tone.
export type UnfoldTone = "danger" | "warning" | "info" | "success" | "neutral" | "team";

export interface UnfoldFact {
  key: string;
  label: I18nText;
  value: I18nText;
}

export interface UnfoldHistogram {
  points: number[];
  caption: I18nText;
  ticks: I18nText[];
}

export interface UnfoldFoldedCard {
  id: string;
  title: I18nText;
  at: string;
  count: number;
}

// lane is a service name, or null for the team's lane; minute orders the chain and is null for anything without a clock time.
export interface UnfoldCard {
  id: string;
  kind: UnfoldKind;
  outcome?: UnfoldOutcome;
  lane: string | null;
  at: string;
  /** Where a range of firings ends, read after `at`. */
  until?: string;
  minute: number | null;
  title: I18nText;
  detail?: I18nText;
  tag?: I18nKey;
  tone: UnfoldTone;
  times?: string[];
  count?: number;
  peak?: I18nText;
  threshold?: I18nText;
  points?: number[];
  projected?: number;
  after?: string;
  via?: I18nText;
  /** The link into this card is a service dependency rather than "fired after". */
  dependency?: boolean;
  /** Firings per bucket on a range every card of the graph shares. */
  strip?: number[];
  /** Replaces the detail card's computed facts. */
  facts?: UnfoldFact[];
  /** The card's alert now, in words, with its dot tone and the rule behind it. */
  live?: { firing: boolean; label: I18nText; tone?: UnfoldTone; tooltip?: I18nText };
  /** The cards a fold card stands for. */
  folded?: UnfoldFoldedCard[];
  /** What expanding a fold card emits; its lane when unset. */
  expandKey?: string;
  /** The fold card's expand button; "Show every alert in this lane" when unset. */
  expandLabel?: I18nText;
}

/** A legend entry: a tone bar or a link line. */
export interface UnfoldLegendItem {
  key: string;
  label: I18nText;
  tone?: UnfoldTone;
  line?: "solid" | "dashed";
  /** What the entry means, when its label alone could mislead. */
  tooltip?: I18nText;
}
