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

// Shared pieces for the host-agent cards (Linux, Windows). Both install the same
// OpenObserve agent from the openobserve/agents repo and differ only by shell,
// script path and what the agent collects — so the install code block, the
// detection config and the troubleshooting rows live here rather than being
// duplicated in both cards.

import { type I18nKey, type TranslateFn } from "@/types/i18n";

import type { CardSubstitutions, RichCardDetect, RichCardExtras, RichCardStep } from "../types";
import { applySubs, applySubsMasked } from "../subs";

/** Slugs whose detection triggers the Host Metrics dashboard auto-import. */
export const HOST_AGENT_SLUGS = new Set(["linux", "windows", "macos"]);

/** Base of the agent install scripts, e.g. `${AGENTS_REPO}/linux/install.sh`. */
export const AGENTS_REPO = "https://raw.githubusercontent.com/openobserve/agents/main";

/** Build a code block whose `[BASIC_PASSCODE]`-equivalent token is masked. */
export function agentCode(template: string, subs: CardSubstitutions, lang: string) {
  return {
    lang,
    raw: applySubs(template, subs),
    masked: applySubsMasked(template, subs),
  };
}

// OTLP ingest names streams format_stream_name(metric.name), so hostmetrics' system.* metrics land as system_* streams (otlp.rs:193, schema.rs:283-284)
export const hostMetricsDetect: RichCardDetect = {
  streamType: "metrics",
  match: "keyword",
  streamName: "system_",
  filter: "",
};

/** Step 3 of the host-agent cards: ticks on detect, its button opens the auto-imported dashboard. */
export function dashboardReadyStep(t: TranslateFn): RichCardStep {
  return {
    id: "dashboard",
    titleKey: "ingestion.setupCard.dashboardReadyTitle",
    descriptionKey: "ingestion.setupCard.dashboardReadyDesc",
    chip: { kind: "run", labelKey: "ingestion.setupCard.chipDashboard" },
    completeOn: "detect",
    action: {
      id: "view-host-dashboard",
      label: t("ingestion.setupCard.viewHostDashboard"),
      icon: "dashboard",
      showOnDetect: true,
    },
  };
}

const unixUninstall = (dir: "linux" | "mac") =>
  `curl -O ${AGENTS_REPO}/${dir}/uninstall.sh \\
  && chmod +x uninstall.sh \\
  && sudo ./uninstall.sh`;

const winUninstall = `Invoke-WebRequest -Uri ${AGENTS_REPO}/windows/uninstall.ps1 -OutFile uninstall.ps1
.\\uninstall.ps1`;

/** What each OS's uninstall script actually removes, so the copy matches reality. */
const UNINSTALL_DESC_KEY: Record<AgentOs, I18nKey> = {
  linux: "ingestion.setupCard.uninstallAgentDescLinux",
  mac: "ingestion.setupCard.uninstallAgentDescMac",
  windows: "ingestion.setupCard.uninstallAgentDescWindows",
};

/** Host OS an agent card targets — picks the uninstall script and shell. */
export type AgentOs = "linux" | "mac" | "windows";

/**
 * The "Uninstall the Agent" accordion, shared by the three host agent cards.
 *
 * The command takes no arguments, so unlike the install step there is no token to
 * substitute or mask.
 */
export function agentUninstall(os: AgentOs): NonNullable<RichCardExtras["uninstall"]> {
  return {
    labelKey: "ingestion.setupCard.uninstallAgentLabel",
    descriptionKey: UNINSTALL_DESC_KEY[os],
    code: {
      lang: os === "windows" ? "powershell" : "bash",
      raw: os === "windows" ? winUninstall : unixUninstall(os),
    },
  };
}

/**
 * Troubleshooting rows common to the host agents.
 *
 * `includeEc2` drops the instance-id row for agents with no EC2 support
 * (macOS), where an EC2-only symptom would just be noise.
 */
export function sharedAgentTroubleshooting(
  t: TranslateFn,
  serviceHint: string,
  { includeEc2 = true }: { includeEc2?: boolean } = {},
): NonNullable<RichCardExtras["troubleshooting"]> {
  return [
    {
      q: t("ingestion.setupCard.agentTroubleNoDataQ"),
      a: t("ingestion.setupCard.agentTroubleNoDataA", { hint: serviceHint }),
    },
    ...(includeEc2
      ? [
          {
            q: t("ingestion.setupCard.agentTroubleInstanceIdQ"),
            a: t("ingestion.setupCard.agentTroubleInstanceIdA", {
              iamNote: t("ingestion.setupCard.ec2IamNote"),
            }),
          },
        ]
      : []),
    {
      q: t("ingestion.setupCard.agentTroubleUnreachableQ"),
      a: t("ingestion.setupCard.agentTroubleUnreachableA"),
    },
  ];
}
