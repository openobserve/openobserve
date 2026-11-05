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

import type { RunRow } from "@/composables/assistant";
import {
  approvalName,
  approvalNoun,
  approvalVerb,
  approvalVerbText,
} from "@/composables/assistant/pure";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

export function runTitle(row: RunRow, t: TranslateFn): I18nText {
  if (row.title) return row.title;
  return row.otherOrg
    ? t("assistant.runs.chatInOrg", { org: raw(row.org) })
    : t("assistant.thread.newChatTitle");
}

/** The request in the card's own words, "Delete rule nginx_5xx"; `null` when this tab holds no card. */
export function runRequest(row: RunRow, t: TranslateFn): I18nText | null {
  const { card } = row;
  if (!card) return null;
  const verb =
    approvalVerb(card) === "delete"
      ? t("assistant.notice.delete", { entity: t(`assistant.entity.${approvalNoun(card)}`, 1) })
      : approvalVerbText(t, card);
  const name = approvalName(card);
  return name ? t("assistant.approval.named", { verb, name: raw(name) }) : verb;
}
