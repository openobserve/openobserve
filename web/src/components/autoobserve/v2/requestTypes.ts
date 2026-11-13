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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { Severity } from "../aoTypes";
import type { LookKind } from "./changes";

export type PriorityFilter = "all" | Severity;
export type RequestKind = "retune" | "fixNow" | "fromNowOn";

export interface Msg {
  key: I18nKey;
  params?: Record<string, unknown>;
  plural?: number;
}

// Ready-made card text for a request that has no copy keys of its own, such as an engine finding.
export interface RequestCopy {
  label: I18nText;
  headline: I18nText;
  why: I18nText | null;
  tags: { label: I18nText; variant: BadgeVariant; hint?: I18nText }[];
  look: LookKind;
}

export interface Request {
  id: string;
  problem?: string;
  kind: RequestKind;
  copy?: RequestCopy;
  doneSettled?: Msg;
  body: Msg;
  yes: I18nKey;
  no: I18nKey;
  doneYes: Msg;
  doneNo: Msg;
}

export const PRIORITY_FILTERS: PriorityFilter[] = ["all", "p1", "p2", "p3", "p4"];

const isMsg = (value: unknown): value is Msg =>
  typeof value === "object" && value !== null && "key" in value;

export const say = (t: TranslateFn, m: Msg): I18nText => {
  const params = Object.fromEntries(
    Object.entries(m.params ?? {}).map(([name, value]) => [
      name,
      isMsg(value) ? say(t, value) : value,
    ]),
  );
  return m.plural === undefined ? t(m.key, params) : t(m.key, params, m.plural);
};
