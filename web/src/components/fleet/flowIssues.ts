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

import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { FleetFlowIssue, FleetFlowLink } from "@/services/fleet";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import { useRolloutText } from "./rolloutText";
import { formatCount } from "./fleetFormat";
import type { FlowSignal, Telemetry } from "./flowTypes";
import { useFleetCollectors, useFleetRollouts } from "./useFleetApi";

export type Severity = "error" | "warning" | "progress" | "info";
// "restricted": the caller may not read some metric streams, so a path without issues is unknown, not healthy.
export type PathSeverity = Severity | "healthy" | "restricted";

/** Worst first; this order decides an edge's colour. */
export const SEVERITY_ORDER: Severity[] = ["error", "warning", "progress", "info"];

export type IssueAction =
  | { kind: "rollout"; rolloutId: string }
  | { kind: "collectors"; query: Record<string, string> }
  | { kind: "upgrades" };

export interface PathIssue {
  id: string;
  severity: Severity;
  title: I18nText;
  evidence: I18nText;
  actionLabel: I18nText;
  action: IssueAction;
}

const RECENT_MS = 3 * 24 * 3600_000;

const SIGNAL_NAME: Record<Telemetry, I18nKey> = {
  logs: "fleet.flow.logs",
  metrics: "fleet.flow.metrics",
  traces: "fleet.flow.traces",
};

const PER_MINUTE: Record<Telemetry, I18nKey> = {
  logs: "fleet.flow.perMinute.logs",
  metrics: "fleet.flow.perMinute.metrics",
  traces: "fleet.flow.perMinute.traces",
};

export const SEVERITY_STROKE: Record<PathSeverity, string> = {
  error: "stroke-status-error-text",
  warning: "stroke-status-warning-text",
  progress: "stroke-accent",
  info: "stroke-status-info-text",
  healthy: "stroke-border-strong",
  restricted: "stroke-border-strong",
};

export const SEVERITY_TEXT: Record<PathSeverity, string> = {
  error: "text-status-error-text",
  warning: "text-status-warning-text",
  progress: "text-accent",
  info: "text-status-info-text",
  healthy: "text-text-secondary",
  restricted: "text-text-secondary",
};

export const SEVERITY_DOT: Record<PathSeverity, string> = {
  error: "bg-status-error-text",
  warning: "bg-status-warning-text",
  progress: "bg-accent",
  info: "bg-status-info-text",
  healthy: "bg-border-strong",
  restricted: "bg-border-strong",
};

export function worstSeverity(issues: PathIssue[]): PathSeverity {
  return SEVERITY_ORDER.find((s) => issues.some((i) => i.severity === s)) ?? "healthy";
}

const percent = (ratio: number) => raw(`${Number((ratio * 100).toFixed(1))}%`);

const names = (list: { name: string }[]) =>
  raw(
    list
      .slice(0, 3)
      .map((c) => c.name)
      .join(", ") + (list.length > 3 ? ` +${list.length - 3}` : ""),
  );

/** Issues on configs and paths; config issues come from the collectors and rollouts, polled while mounted. */
export function useFlowIssues() {
  const { t } = useI18nTyped();
  const { failureText } = useRolloutText();
  const collectors = useFleetCollectors(() => true, FLOW_POLL_MS);
  const rollouts = useFleetRollouts(FLOW_POLL_MS);

  function rolloutIssues(configId: string): PathIssue[] {
    const latest = rollouts.rows.value.find((r) => r.kind !== "upgrade" && r.config === configId);
    if (!latest) return [];
    if (latest.status === "in_progress") {
      return [
        {
          id: `rollout-${latest.id}`,
          severity: "progress",
          title: t("fleet.flowIssues.rollingOut", { to: latest.toVersion }),
          evidence: t("fleet.rollouts.counts", {
            attempted: latest.attempted,
            total: latest.total,
            accepted: latest.accepted,
            failed: latest.failed,
          }),
          actionLabel: t("fleet.flowIssues.openRollout"),
          action: { kind: "rollout", rolloutId: latest.id },
        },
      ];
    }
    const autoReverted =
      latest.status === "superseded" && latest.events.some((e) => e.key === "autoReverted");
    const failed = latest.status === "halted" || autoReverted;
    if (!failed || Date.now() - latest.startedAt > RECENT_MS) return [];
    return [
      {
        id: `rollout-${latest.id}`,
        severity: "error",
        title: autoReverted
          ? t("fleet.flowIssues.autoReverted", { to: latest.toVersion })
          : t("fleet.flowIssues.rolloutHalted", { to: latest.toVersion }),
        evidence: latest.failure ? failureText(latest) : t("fleet.flowIssues.noReason"),
        actionLabel: t("fleet.flowIssues.openRollout"),
        action: { kind: "rollout", rolloutId: latest.id },
      },
    ];
  }

  function collectorIssues(configId: string): PathIssue[] {
    const own = collectors.rows.value.filter((c) => c.config === configId);
    const out: PathIssue[] = [];
    const drifted = own.filter((c) => c.drifted === true);
    if (drifted.length) {
      out.push({
        id: "drift",
        severity: "warning",
        title: t("fleet.flowIssues.drift", { count: drifted.length }),
        evidence: t("fleet.flowIssues.driftEvidence", { names: names(drifted) }),
        actionLabel: t("fleet.flowIssues.reviewDrift"),
        action: { kind: "collectors", query: { q: configId } },
      });
    }
    const offline = own.filter((c) => c.status === "offline");
    if (offline.length) {
      out.push({
        id: "offline",
        severity: "warning",
        title: t("fleet.flowIssues.offline", { count: offline.length }),
        evidence: t("fleet.flowIssues.offlineEvidence", { names: names(offline) }),
        actionLabel: t("fleet.flowIssues.viewCollectors"),
        action: { kind: "collectors", query: { q: configId } },
      });
    }
    const behind = own.filter((c) => c.outdated);
    if (behind.length) {
      out.push({
        id: "behind",
        severity: "info",
        title: t("fleet.flowIssues.behindRing", { count: behind.length }),
        evidence: t("fleet.flowIssues.behindEvidence", { names: names(behind) }),
        actionLabel: t("fleet.flowIssues.planUpgrade"),
        action: { kind: "upgrades" },
      });
    }
    return out;
  }

  function configIssues(configId: string): PathIssue[] {
    return [...rolloutIssues(configId), ...collectorIssues(configId)];
  }

  function issueTitle(issue: FleetFlowIssue): I18nText {
    switch (issue.kind) {
      case "export_errors":
        return t("fleet.flowIssues.exportErrors", {
          signal: t(SIGNAL_NAME[issue.signal]),
          value: percent(issue.value),
        });
      case "dropped":
        return t("fleet.flowIssues.dropped", {
          value: t(PER_MINUTE[issue.signal], { value: raw(formatCount(issue.value)) }),
        });
      default:
        return t("fleet.flowIssues.backpressure", {
          signal: t(SIGNAL_NAME[issue.signal]),
          value: percent(issue.value),
        });
    }
  }

  function linkIssues(link: FleetFlowLink, signal: FlowSignal, destination: I18nText): PathIssue[] {
    return link.issues
      .filter((issue) => signal === "all" || issue.signal === signal)
      .map((issue): PathIssue => ({
        id: `edge-${issue.signal}-${issue.kind}`,
        severity: issue.kind === "backpressure" ? "warning" : "error",
        title: issueTitle(issue),
        evidence: t("fleet.flowIssues.edgeEvidence", { destination }),
        actionLabel: t("fleet.flowIssues.viewCollectors"),
        action: { kind: "collectors", query: { q: link.config } },
      }));
  }

  function pathIssues(link: FleetFlowLink, signal: FlowSignal, destination: I18nText): PathIssue[] {
    return [...configIssues(link.config), ...linkIssues(link, signal, destination)];
  }

  function refetch() {
    collectors.refetch();
    rollouts.refetch();
  }

  return {
    configIssues,
    pathIssues,
    error: computed(() => collectors.error.value ?? rollouts.error.value),
    refetch,
  };
}
