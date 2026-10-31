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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { RELATIVE_PERIOD_PATTERN, formatToTimeCompact } from "@/utils/date";
import {
  isPlaceholderScan,
  operatorLabel,
  planAggregate,
  planOperatorSummary,
  planScanInfo,
  scopeNodeKey,
  type ProfileModel,
  type ProfileOperator,
  type StageScope,
  type StageVariant,
} from "@/utils/queryProfile";
import { CATEGORY_STYLE, VARIANT_ROLE_KEY } from "./profileStyles";

const MAX_NAMES = 3;

const PAST_PERIOD_KEY: Record<string, I18nKey> = {
  s: "common.pastSecond",
  m: "common.pastMinute",
  h: "common.pastHour",
  d: "common.pastDay",
  w: "common.pastWeek",
  M: "common.pastMonth",
};

export function nodeName(model: ProfileModel, nodeKey: string): string {
  for (const s of model.stages) {
    const node = s.nodes.find((n) => n.key === nodeKey);
    if (node) return node.name;
  }
  return nodeKey;
}

export function roleLabel(t: TranslateFn, role: string): I18nText | null {
  if (role.includes("querier")) return t("search.queryProfile.roleQuerier");
  if (role.includes("ingester")) return t("search.queryProfile.roleIngester");
  return null;
}

export function variantLabel(t: TranslateFn, variant: StageVariant): I18nText {
  if (variant.role !== "mixed") return t(VARIANT_ROLE_KEY[variant.role]);
  const extra = variant.nodeNames.length - MAX_NAMES;
  const names = variant.nodeNames.slice(0, MAX_NAMES).join(", ");
  return raw(extra > 0 ? `${names} +${extra}` : names);
}

/** Short marker of the active stage scope: sum, max, or the chosen node's name. */
export function scopeTag(t: TranslateFn, model: ProfileModel, scope: StageScope): I18nText {
  if (scope === "sum") return t("search.queryProfile.scopeSumShort");
  if (scope === "max") return t("search.queryProfile.scopeMaxShort");
  return raw(nodeName(model, scopeNodeKey(scope) ?? ""));
}

export function categoryLabel(t: TranslateFn, op: Pick<ProfileOperator, "category">): I18nText {
  return t(CATEGORY_STYLE[op.category].labelKey);
}

export function operatorWhere(t: TranslateFn, model: ProfileModel, op: ProfileOperator): I18nText {
  if (op.remoteStageId) {
    const stage = model.stageById[op.remoteStageId];
    return t("search.queryProfile.exchangeStage", { index: stage.index });
  }
  if (model.planOnly) {
    return op.stageId
      ? t("search.queryProfile.inStagePlan", {
          category: categoryLabel(t, op),
          index: model.stageById[op.stageId].index,
        })
      : t("search.queryProfile.onLeaderPlan", { category: categoryLabel(t, op) });
  }
  if (op.stageId && op.variantId) {
    return t("search.queryProfile.inStage", {
      category: categoryLabel(t, op),
      index: model.stageById[op.stageId].index,
      variant: variantLabel(t, model.variantById[op.variantId]),
    });
  }
  return t("search.queryProfile.onLeader", {
    category: categoryLabel(t, op),
    node: model.profile.node_name || model.profile.node_address,
  });
}

/** The logs page time range in words: "Past 1 Day" for a relative period, else start → end. */
export function timeRangeLabel(
  t: TranslateFn,
  dt: { type?: string; relativeTimePeriod?: string; startTime?: number; endTime?: number } | null,
): I18nText | null {
  if (!dt) return null;
  const rel = dt.type === "relative" ? dt.relativeTimePeriod?.match(RELATIVE_PERIOD_PATTERN) : null;
  if (rel && PAST_PERIOD_KEY[rel[2]]) {
    const count = Number(rel[1]);
    return t(PAST_PERIOD_KEY[rel[2]], { count }, count);
  }
  if (!dt.startTime || !dt.endTime) return null;
  return raw(`${formatToTimeCompact(dt.startTime)} → ${formatToTimeCompact(dt.endTime)}`);
}

/** Card and panel title; the placeholder scan that every node replaces at run time is named by its stream. */
export function operatorTitle(t: TranslateFn, op: ProfileOperator): I18nText {
  const stream = isPlaceholderScan(op) ? planScanInfo(op).stream : "";
  return stream ? t("search.queryProfile.scanTitle", { stream }) : raw(operatorLabel(op));
}

/** The second line of a plan card, which has no runtime numbers to show. */
export function planCardDetail(t: TranslateFn, model: ProfileModel, op: ProfileOperator): I18nText {
  if (op.remoteStageId) {
    return t("search.queryProfile.sendsStage", { index: model.stageById[op.remoteStageId].index });
  }
  if (op.category === "scan") return scanDetail(t, op);
  if (op.category === "agg") {
    const { groupBy, aggr } = planAggregate(op.detail);
    return groupBy.length
      ? t("search.queryProfile.groupBy", { columns: groupBy.join(", ") })
      : raw(aggr.join(", "));
  }
  return raw(planOperatorSummary(op));
}

function scanDetail(t: TranslateFn, op: ProfileOperator): I18nText {
  const { stream, columns } = planScanInfo(op);
  const count = columns.length;
  if (!count) return raw(stream || planOperatorSummary(op));
  return stream
    ? t("search.queryProfile.scanColumns", { stream, count }, count)
    : t("search.queryProfile.columnsCount", { count }, count);
}
