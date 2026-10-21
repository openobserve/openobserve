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
import type { FleetFlowIssue, FleetPipeline } from "@/services/fleet";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import { useRolloutText } from "./rolloutText";
import { formatCount } from "./fleetFormat";
import type { Telemetry } from "./flowTypes";
import { useFleetCollectors, useFleetRollouts } from "./useFleetApi";

export type Severity = "error" | "warning" | "progress" | "info";
// "restricted": the caller may not read some metric streams, so a path without issues is unknown, not healthy.
export type PathSeverity = Severity | "healthy" | "restricted";

/** Worst first; this order decides a pipeline's dot. */
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

export const SEVERITY_RING: Record<PathSeverity, string> = {
  error: "border-status-error-text ring-status-error-text/30 ring-2",
  warning: "border-status-warning-text ring-status-warning-text/30 ring-2",
  progress: "border-status-info-text ring-status-info-text/30 ring-2",
  info: "border-status-outdated-text ring-status-outdated-text/30 ring-2",
  healthy: "",
  restricted: "",
};

export const SIGNAL_STROKE: Record<Telemetry, string> = {
  logs: "stroke-signal-logs",
  metrics: "stroke-signal-metrics",
  traces: "stroke-signal-traces",
};

export const SEVERITY_TEXT: Record<PathSeverity, string> = {
  error: "text-status-error-text",
  warning: "text-status-warning-text",
  progress: "text-status-info-text",
  info: "text-status-outdated-text",
  healthy: "text-text-secondary",
  restricted: "text-text-secondary",
};

export const SEVERITY_DOT: Record<PathSeverity, string> = {
  error: "bg-status-error-text",
  warning: "bg-status-warning-text",
  progress: "bg-status-info-text",
  info: "bg-status-outdated-text",
  healthy: "bg-status-success-text",
  restricted: "bg-border-strong",
};

export function worstSeverity(issues: PathIssue[]): PathSeverity {
  return SEVERITY_ORDER.find((s) => issues.some((i) => i.severity === s)) ?? "healthy";
}

export const percent = (share: number) => raw(`${Number((share * 100).toFixed(1))}%`);

const names = (list: { name: string }[]) =>
  raw(
    list
      .slice(0, 3)
      .map((c) => c.name)
      .join(", ") + (list.length > 3 ? ` +${list.length - 3}` : ""),
  );

/** Share of `part` in `part + rest`; failed items never count in an exporter's sent rate. */
export const ratio = (part: number, rest: number | null) =>
  part > 0 ? part / (part + Math.max(rest ?? 0, 0)) : 0;

/** Issues on fleets and pipelines; fleet issues come from the collectors and rollouts, polled while mounted. */
export function useFlowIssues() {
  const { t } = useI18nTyped();
  const { haltClassText, progressText } = useRolloutText();
  const collectors = useFleetCollectors(() => true, FLOW_POLL_MS);
  const rollouts = useFleetRollouts(FLOW_POLL_MS);

  function rolloutIssues(fleetId: string): PathIssue[] {
    const latest = rollouts.rows.value.find((r) => r.fleetId === fleetId);
    if (!latest) return [];
    if (latest.status === "in_progress") {
      return [
        {
          id: `rollout-${latest.id}`,
          severity: "progress",
          title: t("fleet.flowIssues.rollingOut", { to: latest.toVersion }),
          evidence: progressText(latest),
          actionLabel: t("fleet.flowIssues.openRollout"),
          action: { kind: "rollout", rolloutId: latest.id },
        },
      ];
    }
    const autoRolledBack = latest.status === "rolled_back" && latest.autoRollback;
    const failed = latest.status === "halted" || autoRolledBack;
    if (!failed || Date.now() - latest.startedAt > RECENT_MS) return [];
    return [
      {
        id: `rollout-${latest.id}`,
        severity: "error",
        title: autoRolledBack
          ? t("fleet.flowIssues.autoRolledBack", { to: latest.toVersion })
          : t("fleet.flowIssues.rolloutHalted", { to: latest.toVersion }),
        evidence: latest.halt
          ? t("fleet.rollouts.haltLine", {
              class: haltClassText(latest.halt.class),
              reason: raw(latest.halt.reason),
            })
          : t("fleet.flowIssues.noReason"),
        actionLabel: t("fleet.flowIssues.openRollout"),
        action: { kind: "rollout", rolloutId: latest.id },
      },
    ];
  }

  function collectorIssues(fleetId: string): PathIssue[] {
    const own = collectors.rows.value.filter((c) => c.fleetId === fleetId);
    const out: PathIssue[] = [];
    const offline = own.filter((c) => c.status === "offline");
    if (offline.length) {
      out.push({
        id: "offline",
        severity: "warning",
        title: t("fleet.flowIssues.offline", { count: offline.length }),
        evidence: t("fleet.flowIssues.offlineEvidence", { names: names(offline) }),
        actionLabel: t("fleet.flowIssues.viewCollectors"),
        action: { kind: "collectors", query: { fleet: fleetId, status: "offline" } },
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

  function fleetIssues(fleetId: string): PathIssue[] {
    return [...rolloutIssues(fleetId), ...collectorIssues(fleetId)];
  }

  function issueTitle(issue: FleetFlowIssue): I18nText {
    const signal = t(SIGNAL_NAME[issue.signal]);
    switch (issue.kind) {
      case "export_errors":
        return t("fleet.flowIssues.exportErrors", { signal, value: percent(issue.value) });
      case "dropped":
        return t("fleet.flowIssues.dropped", {
          value: t(PER_MINUTE[issue.signal], { value: raw(formatCount(issue.value)) }),
        });
      case "receiver_refused":
        return t("fleet.flowIssues.receiverRefused", { signal, value: percent(issue.value) });
      default:
        return t("fleet.flowIssues.backpressure", { signal, value: percent(issue.value) });
    }
  }

  // The payload names no component per issue, so the evidence points at the worst one of its kind.
  function issueEvidence(
    issue: FleetFlowIssue,
    p: FleetPipeline,
    destinationLabel: (id: string) => I18nText,
  ): I18nText {
    if (issue.kind === "receiver_refused") {
      const worst = [...p.receivers].sort((a, b) => b.refused - a.refused)[0];
      return t("fleet.flowIssues.receiverEvidence", { receiver: raw(worst?.name ?? p.name) });
    }
    const score = (e: FleetPipeline["exporters"][number]) =>
      issue.kind === "export_errors"
        ? ratio(e.failed, e.rate)
        : issue.kind === "dropped"
          ? e.dropped
          : (e.queue ?? 0);
    const worst = [...p.exporters].sort((a, b) => score(b) - score(a))[0];
    return worst
      ? t("fleet.flowIssues.edgeEvidence", { destination: destinationLabel(worst.destination) })
      : t("fleet.flowIssues.noReason");
  }

  function pipelineIssues(
    p: FleetPipeline,
    destinationLabel: (id: string) => I18nText,
  ): PathIssue[] {
    return p.issues.map((issue): PathIssue => ({
      id: `${p.id}-${issue.kind}`,
      severity:
        issue.kind === "backpressure" || issue.kind === "receiver_refused" ? "warning" : "error",
      title: issueTitle(issue),
      evidence: issueEvidence(issue, p, destinationLabel),
      actionLabel: t("fleet.flowIssues.viewCollectors"),
      action: { kind: "collectors", query: { fleet: p.fleet } },
    }));
  }

  function refetch() {
    collectors.refetch();
    rollouts.refetch();
  }

  return {
    fleetIssues,
    pipelineIssues,
    error: computed(() => collectors.error.value ?? rollouts.error.value),
    refetch,
  };
}
