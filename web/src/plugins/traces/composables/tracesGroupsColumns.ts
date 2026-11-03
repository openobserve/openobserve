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

import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { GroupRow } from "@/utils/traces/tracesGroups";

/** The Groups table's columns; ids match the sort keys, so a header click names the ORDER BY column. */
export function buildGroupsColumns(key: string, t: TranslateFn): OTableColumnDef<GroupRow>[] {
  const metric = (
    id: string,
    header: I18nText,
    size: number,
    extra: Partial<OTableColumnDef<GroupRow>> = {},
  ): OTableColumnDef<GroupRow> => ({
    id,
    header,
    size,
    sortable: true,
    meta: { align: "right" },
    ...extra,
  });
  return [
    { id: "value", accessorKey: "value", header: raw(key), size: 260, sortable: true },
    metric("spans", t("traces.groups.spans"), 110, { accessorKey: "spans" }),
    metric("errors", t("traces.groups.errors"), 100, { accessorKey: "errors" }),
    metric("error_pct", t("traces.groups.errorPct"), 100, { accessorKey: "errorPct" }),
    metric("p50", t("traces.groups.p50"), 110, { accessorKey: "p50" }),
    metric("p95", t("traces.groups.p95"), 110, {
      accessorKey: "p95",
      meta: { align: "right", headerTooltip: t("traces.groups.p95Tooltip") },
    }),
    metric("p99", t("traces.groups.p99"), 110, { accessorKey: "p99" }),
    {
      id: "rate",
      header: t("traces.groups.rate"),
      size: 160,
      sortable: false,
      meta: { headerTooltip: t("traces.groups.rateTooltip") },
    },
  ];
}
