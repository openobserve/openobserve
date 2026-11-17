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

import type { TranslateFn } from "@/types/i18n";
import type { AiChatHandoff } from "@/plugins/traces/utils/traceAiPayload";
import type { OverviewFiringAlert } from "@/ts/interfaces/overview";

export type OverviewAskAiTopic =
  "firing" | "failing" | "incidents" | "pipelines" | "delivery" | "quiet" | "critical" | "warning";

export interface OverviewAskAiIncident {
  id: string;
  title?: string;
  severity?: string;
  alert_count?: number;
  group_values?: Record<string, string>;
  first_alert_at?: number;
}

export type OverviewAskAiTarget =
  | { kind: "count"; topic: OverviewAskAiTopic; count: number; level?: "critical" | "warning" }
  | { kind: "alert"; alert: OverviewFiringAlert }
  | { kind: "incident"; incident: OverviewAskAiIncident };

export interface OverviewAskAiBase {
  orgId: string;
  startTime: number;
  endTime: number;
  rangeLabel: string;
  generatedAt: number | undefined;
}

const PAGE: Record<OverviewAskAiTopic, string> = {
  firing: "Alerts",
  failing: "Alerts",
  delivery: "Alerts",
  critical: "Alerts",
  warning: "Alerts",
  incidents: "incidents",
  pipelines: "Pipelines",
  quiet: "Streams",
};

const plural = (one: boolean, singular: string, pluralForm: string) =>
  one ? singular : pluralForm;

// Questions are model input, not screen copy, so they stay English.
const countQuestion = (topic: OverviewAskAiTopic, n: number): string => {
  const one = n === 1;
  switch (topic) {
    case "failing":
      return `Why did ${n} ${plural(one, "alert rule fail its", "alert rules fail their")} last evaluation?`;
    case "incidents":
      return `Help me triage ${n} open ${plural(one, "incident", "incidents")}.`;
    case "pipelines":
      return `${n} ${plural(one, "pipeline is", "pipelines are")} errored. How do I find which and why?`;
    case "quiet":
      return `${n} ${plural(one, "stream stopped", "streams stopped")} receiving data. How do I find ${plural(one, "it", "them")} and the cause?`;
    case "delivery":
      return `${n} ${plural(one, "alert fired", "alerts fired")} but could not notify. How do I find the cause?`;
    case "critical":
    case "warning":
      return `Why ${plural(one, "is", "are")} ${n} ${topic} ${plural(one, "alert", "alerts")} firing and what should I check first?`;
    default:
      return `Why ${plural(one, "is", "are")} ${n} ${plural(one, "alert", "alerts")} firing and what should I check first?`;
  }
};

const targetPayload = (target: OverviewAskAiTarget, t: TranslateFn) => {
  if (target.kind === "count") {
    const { topic, count, level } = target;
    return {
      query: countQuestion(topic, count),
      chipName: t(`overview.askAi.chip.${topic}`),
      context: { currentPage: PAGE[topic], kind: topic, count, ...(level && { level }) },
    };
  }
  if (target.kind === "alert") {
    const { name, stream, level, since } = target.alert;
    return {
      query: `Why is the alert "${name}" firing on ${stream} and what should I check first?`,
      chipName: t("overview.askAi.chip.alert", { name }),
      context: {
        currentPage: "Alerts",
        alert_name: name,
        stream,
        level,
        firing_since_us: since,
      },
    };
  }
  const inc = target.incident;
  const label = inc.title || inc.id;
  return {
    query: `Help me triage the incident "${label}".`,
    chipName: t("overview.askAi.chip.incident", { name: label }),
    context: {
      currentPage: "incidents",
      incident_id: inc.id,
      title: inc.title,
      severity: inc.severity,
      alert_count: inc.alert_count,
      group_values: inc.group_values,
      first_alert_at: inc.first_alert_at,
    },
  };
};

export const buildOverviewAskAi = (
  target: OverviewAskAiTarget,
  base: OverviewAskAiBase,
  t: TranslateFn,
): AiChatHandoff => {
  const { query, chipName, context } = targetPayload(target, t);
  return {
    query,
    chipName,
    newChat: true,
    autoSend: false,
    context: {
      ...context,
      org_id: base.orgId,
      start_time: base.startTime,
      end_time: base.endTime,
      range_label: base.rangeLabel,
      generated_at: base.generatedAt,
    },
  };
};
