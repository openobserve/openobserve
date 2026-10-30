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

import analytics from "@/services/product_analytics";
import type { EditorSuggestMode } from "@/composables/useEditorSuggestMode";
import type { SuggestLane } from "@/utils/query/editorKeyContract";

export const SUGGEST_SUMMARY_EVENT = "editor_suggest_summary";

const LANES: SuggestLane[] = ["operator", "value", "field", "clause"];

/** An Enter accept undone within this long counts as an Enter trap. */
const UNDO_WINDOW_MS = 2000;

/** A Tab or Enter this recent is what accepted the item; anything older means a click. */
const ACCEPT_KEY_WINDOW_MS = 500;

/** A Ctrl+Space this recent made the request an Invoke menu rather than a quick suggestion. */
const INVOKE_KEY_WINDOW_MS = 500;

type MenuKind = "chain" | "auto" | "invoke";

interface Counts {
  chain_shown: number;
  chain_accepted_tab: number;
  chain_accepted_enter: number;
  chain_accepted_click: number;
  chain_dismissed_esc: number;
  chain_typed_through: number;
  auto_shown: number;
  auto_accepted: number;
  invoke_shown: number;
  invoke_accepted: number;
  enter_with_menu_open: number;
  enter_accept_undone: number;
  value_budget_hits: number;
  lane_offered: Record<SuggestLane, number>;
  lane_accepted: Record<SuggestLane, number>;
  value_fetch_ms: number[];
}

interface Bucket {
  surface: string;
  language: string;
  mode: EditorSuggestMode;
  counts: Counts;
}

const emptyLanes = (): Record<SuggestLane, number> => ({
  operator: 0,
  value: 0,
  field: 0,
  clause: 0,
});

const emptyCounts = (): Counts => ({
  chain_shown: 0,
  chain_accepted_tab: 0,
  chain_accepted_enter: 0,
  chain_accepted_click: 0,
  chain_dismissed_esc: 0,
  chain_typed_through: 0,
  auto_shown: 0,
  auto_accepted: 0,
  invoke_shown: 0,
  invoke_accepted: 0,
  enter_with_menu_open: 0,
  enter_accept_undone: 0,
  value_budget_hits: 0,
  lane_offered: emptyLanes(),
  lane_accepted: emptyLanes(),
  value_fetch_ms: [],
});

// Shared at module scope: one summary per surface, however many editors it has.
const buckets = new Map<string, Bucket>();

const bucketFor = (surface: string, language: string, mode: EditorSuggestMode): Bucket => {
  const key = `${surface}|${language}|${mode}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { surface, language, mode, counts: emptyCounts() };
    buckets.set(key, bucket);
  }
  return bucket;
};

const isEmpty = (counts: Counts): boolean =>
  Object.entries(counts).every(([, value]) => {
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.values(value).every((n) => n === 0);
    return value === 0;
  });

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value);
};

/** Counts only: no field names, no values and no query text ever leave the browser. */
export const summaryProperties = (bucket: Bucket): Record<string, unknown> => {
  const { lane_offered, lane_accepted, value_fetch_ms, ...scalars } = bucket.counts;
  const properties: Record<string, unknown> = {
    surface: bucket.surface,
    language: bucket.language,
    mode: bucket.mode,
    ...scalars,
    value_fetch_ms_p50: median(value_fetch_ms),
  };
  for (const lane of LANES) {
    properties[`lane_offered_${lane}`] = lane_offered[lane];
    properties[`lane_accepted_${lane}`] = lane_accepted[lane];
  }
  return properties;
};

export const flushEditorSuggestSummary = (surface?: string): void => {
  for (const [key, bucket] of buckets) {
    if (surface !== undefined && bucket.surface !== surface) continue;
    if (!isEmpty(bucket.counts)) analytics.track(SUGGEST_SUMMARY_EVENT, summaryProperties(bucket));
    buckets.delete(key);
  }
};

interface Offer {
  kind: MenuKind;
  open: boolean;
}

export interface OfferInput {
  /** Monaco's CompletionTriggerKind: 0 Invoke, 1 trigger character, 2 re-filter. */
  triggerKind: number;
  chained: boolean;
  lanes: SuggestLane[];
  rows: number;
}

export interface KeyInput {
  key: string;
  ctrlOrMeta: boolean;
}

/** Per-editor tracker; Monaco has no public shown or dismissed event, so this is approximate. */
export const createSuggestTracker = (
  surface: string,
  language: () => string,
  mode: () => EditorSuggestMode,
) => {
  let offer: Offer | null = null;
  let lastKey: { key: string; ctrlOrMeta: boolean; at: number } | null = null;
  let enterAcceptAt = 0;
  let pendingEnter: ReturnType<typeof setTimeout> | null = null;
  const counts = () => bucketFor(surface, language(), mode()).counts;
  const recentKey = (keys: string[], windowMs: number, ctrlOrMeta = false) =>
    !!lastKey &&
    keys.includes(lastKey.key) &&
    lastKey.ctrlOrMeta === ctrlOrMeta &&
    Date.now() - lastKey.at <= windowMs;

  /** Only a new menu counts as shown; a re-filter of the same menu does not. */
  const offered = ({ triggerKind, chained, lanes, rows }: OfferInput): void => {
    if (!rows) {
      offer = null;
      return;
    }
    if (triggerKind === 2 && offer) return;
    const kind: MenuKind = chained
      ? "chain"
      : triggerKind === 0 && recentKey([" "], INVOKE_KEY_WINDOW_MS, true)
        ? "invoke"
        : "auto";
    offer = { kind, open: true };
    const c = counts();
    if (kind === "chain") c.chain_shown += 1;
    else if (kind === "invoke") c.invoke_shown += 1;
    else c.auto_shown += 1;
    for (const lane of new Set(lanes)) c.lane_offered[lane] += 1;
  };

  const accepted = (lane: SuggestLane | ""): void => {
    const c = counts();
    const method = recentKey(["Tab"], ACCEPT_KEY_WINDOW_MS)
      ? "chain_accepted_tab"
      : recentKey(["Enter"], ACCEPT_KEY_WINDOW_MS)
        ? "chain_accepted_enter"
        : "chain_accepted_click";
    const kind = offer?.kind ?? "auto";
    if (kind === "chain") c[method] += 1;
    else if (kind === "invoke") c.invoke_accepted += 1;
    else c.auto_accepted += 1;
    if (lane) c.lane_accepted[lane] += 1;
    if (method === "chain_accepted_enter") enterAcceptAt = Date.now();
    if (pendingEnter) clearTimeout(pendingEnter);
    pendingEnter = null;
    offer = null;
  };

  /** Observes a key and never consumes it, so counting cannot change what a key does. */
  const keyDown = ({ key, ctrlOrMeta }: KeyInput): void => {
    const c = counts();
    const now = Date.now();
    const undo = key === "Backspace" || (ctrlOrMeta && key.toLowerCase() === "z");
    if (undo && enterAcceptAt && now - enterAcceptAt <= UNDO_WINDOW_MS) {
      c.enter_accept_undone += 1;
      enterAcceptAt = 0;
    }
    if (offer?.open) {
      if (key === "Escape") {
        if (offer.kind === "chain") c.chain_dismissed_esc += 1;
        offer.open = false;
      } else if (key === "Enter" && !ctrlOrMeta) {
        // The accept command runs synchronously after this key, so an Enter still pending a tick later did not accept.
        pendingEnter = setTimeout(() => {
          pendingEnter = null;
          c.enter_with_menu_open += 1;
        }, 0);
        offer.open = false;
      } else if (key.length === 1 && !ctrlOrMeta && offer.kind === "chain") {
        c.chain_typed_through += 1;
        offer.open = false;
      }
    }
    lastKey = { key, ctrlOrMeta, at: now };
  };

  const valueFetched = (ms: number): void => {
    counts().value_fetch_ms.push(Math.round(ms));
  };

  const budgetHit = (): void => {
    counts().value_budget_hits += 1;
  };

  /** A blur or a caret move closes the menu without a key this tracker sees. */
  const closed = (): void => {
    offer = null;
  };

  return { offered, accepted, keyDown, valueFetched, budgetHit, closed };
};

export type SuggestTracker = ReturnType<typeof createSuggestTracker>;
