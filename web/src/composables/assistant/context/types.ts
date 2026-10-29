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

import type { I18nText } from "@/types/i18n";

import type { RouteTarget } from "../actions/types";
import type { Container, EntryKind, EntryVerb, ObjectKind } from "../assistantStore.types";

/** `report` is the RCA report, the on-call verdict or the AutoObserve ask (`60` §5). */
export type ChipKind =
  | "time"
  | "stream"
  | "query"
  | "panel"
  | "alert"
  | "pipeline_node"
  | "incident"
  | "log_row"
  | "cell"
  | "field"
  | "span"
  | "query_error"
  | "image"
  | "report";

export interface ContextChip {
  id: string;
  kind: ChipKind;
  label: I18nText;
  /** The name alone, shown below md where the icon says the kind; always a part of `label` (CT-01 AC 9). */
  short?: I18nText;
  secondary?: I18nText;
  ref?: {
    type: string;
    id?: string;
    org: string;
    stream?: string;
    streamType?: string;
    from?: number;
    to?: number;
    route?: RouteTarget;
  };
  /** Row, value, span or error; capped at 20 rows / 32 KB per message. */
  data?: unknown;
  sizeBytes: number;
  provenance: "page" | "door" | "mention" | "picker" | "attach";
  /** Multi-select rows stay one `log_row` chip (`40` §4). */
  count?: number;
  /** What the agent receives today (constraint 40). */
  sent: "whitelist" | "serialized" | "not_read";
  /** Fields cut to fit the 32 KB cap, longest values first (CT-02 AC 8). */
  truncated?: string[];
  /** "Hide internal fields" turned off: `_o2_id` and `_original` are sent too (CT-03 AC 2). */
  includeInternal?: boolean;
}

/** The provider contract (`00` §6.1); one type for the providers, the tray and the wire. */
export type { PageContext, PageTimeRange } from "@/composables/contextProviders/types";

/** B-13 envelope sent as `context.client`. */
export interface ClientContext {
  container: Container;
  entry_kind: EntryKind;
  entry_verb: EntryVerb;
  object_kind: ObjectKind;
  ui_version: string;
}
