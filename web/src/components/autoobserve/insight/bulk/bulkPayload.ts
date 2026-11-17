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

import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import {
  defaultAlertValue,
  prefillSqlHaving,
  seedFormFromPrefill,
} from "@/composables/useAlertForm";
import { getAlertPayload } from "@/utils/alerts/alertPayload";
import { addHavingClauseToQuery } from "@/utils/alerts/alertSqlUtils";
import { raw } from "@/types/i18n";
import { prefillDescription } from "./bulkTargets";

export interface BulkPayloadContext {
  store: any;
  folderId: string;
  destinations: string[];
  /** The org's minimum evaluation frequency in minutes. */
  floorMinutes: number;
}

let parser: any = null;

const sqlOf = async (prefill: AlertPrefill): Promise<string> => {
  const sql = prefill.sql ?? "";
  const having = prefillSqlHaving(prefill);
  if (prefill.queryType === "promql" || !sql || !having) return sql;
  if (!parser) {
    const useSqlParser: any = await import("@/composables/useParser");
    parser = await useSqlParser.default().sqlParser();
  }
  return addHavingClauseToQuery(sql, having.column, having.operator, having.value, parser);
};

/** The create body for one prefill: the alert form's own seed and Save payload, so there is no second alert shape. */
export const alertBodyFromPrefill = async (
  prefill: AlertPrefill,
  ctx: BulkPayloadContext,
): Promise<any> => {
  const data: any = defaultAlertValue();
  const seeded = seedFormFromPrefill(data, prefill, {
    sql: await sqlOf(prefill),
    floorMinutes: ctx.floorMinutes,
  });
  data.description = raw(prefillDescription(prefill));
  data.destinations = [...ctx.destinations];
  data.folder_id = ctx.folderId;
  const payload = getAlertPayload(data, {
    store: ctx.store,
    isAggregationEnabled: { value: seeded.aggregation },
    getSelectedTab: { value: data.query_condition.type },
    beingUpdated: false,
  });
  delete payload.composite_condition;
  delete payload.children;
  // The form wraps the builder conditions the same way on Save.
  payload.query_condition.conditions = { version: 2, conditions: data.query_condition.conditions };
  return payload;
};
