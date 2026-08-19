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
// script path and what the agent collects — so the environment choice
// (generic host vs AWS EC2), the EC2 IAM prerequisite and the detection config
// live here rather than being duplicated in both cards.

import { type I18nKey, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardDetect, RichCardExtras } from "../types";
import { applySubs, applySubsMasked } from "../subs";

/** Base of the agent install scripts, e.g. `${AGENTS_REPO}/linux/install.sh`. */
export const AGENTS_REPO = "https://raw.githubusercontent.com/openobserve/agents/main";

/** Environment the agent is installed onto — drives the script path. */
export type AgentEnv = "generic" | "ec2";

/**
 * The EC2 variants read the instance's Name tag and use it as the host
 * identifier, which needs an instance role — without it the agent installs but
 * every host shows up under its opaque instance id instead.
 */
export const EC2_IAM_NOTE_KEY: I18nKey = "ingestion.setupCard.ec2IamNote";

/** Icon shown on the generic/EC2 toggle. */
export const envIcons = () => ({
  ec2: getImageURL("images/ingestion/aws.svg"),
  linux: getImageURL("images/common/linux.svg"),
  windows: getImageURL("images/common/windows.svg"),
});

/** Build a code block whose `[BASIC_PASSCODE]`-equivalent token is masked. */
export function agentCode(template: string, subs: CardSubstitutions, lang: string) {
  return {
    lang,
    raw: applySubs(template, subs),
    masked: applySubsMasked(template, subs),
  };
}

/**
 * Host metrics land as one stream per metric (`system_cpu_time`, …), so — like
 * the database cards — detection is keyword/existence based rather than a COUNT
 * over one stream.
 *
 * TODO(detect): confirm the agent's emitted metric prefix on the ingest side;
 * this assumes the OTel hostmetrics receiver's `system.*` naming.
 */
export const hostMetricsDetect: RichCardDetect = {
  streamType: "metrics",
  match: "keyword",
  streamName: "system",
  filter: "",
};

// The agents repo ships a single uninstall script per OS — there is no EC2-specific
// one — so an EC2 install is removed by the same command as a generic one.
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
 * `includeEc2` drops the instance-id row for agents that ship no EC2 variant
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
              iamNote: t(EC2_IAM_NOTE_KEY),
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
