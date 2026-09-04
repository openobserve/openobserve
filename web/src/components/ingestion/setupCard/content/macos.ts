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

// macOS host agent setup card — the third host agent alongside ./linux.ts and
// ./windows.ts, sharing ./osAgent scaffolding (install code block, host-metrics
// detection, troubleshooting rows).
//
// Two things differ from the Linux/Windows cards:
//   - No environment toggle. The agents repo ships no mac/ec2 variant, so this is
//     a single command rather than a generic/EC2 pair, and the EC2 troubleshooting
//     row is dropped.
//   - The macOS unified log is not a file any collector can tail, so the installer
//     also registers a second launchd daemon that streams `log stream --style
//     ndjson` into the agent's TCP receiver. That daemon is the thing to check
//     when host metrics arrive but unified log entries do not.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import {
  AGENTS_REPO,
  agentCode,
  agentUninstall,
  hostMetricsDetect,
  sharedAgentTroubleshooting,
} from "./osAgent";

// macOS ships curl but not wget, so the one-liner is curl-based.
const install = `curl -O ${AGENTS_REPO}/mac/install.sh \\
  && chmod +x install.sh \\
  && sudo ./install.sh {url}/api/{org}/ {token}`;

export default function macosCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      name: raw("macOS"),
      tagline: t("ingestion.setupCard.taglineMacos"),
      logo: getImageURL("images/common/macos.png"),
      tone: "#86868b",
      runtime: t("ingestion.setupCard.runtimeHost"),
      setupTime: t("ingestion.setupCard.setupTime1Min"),
      metaBadges: [t("common.logs"), t("common.metrics")],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.installAgentTitle",
        descriptionKey: "ingestion.setupCard.installAgentMacosDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        code: agentCode(install, subs, "bash"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyMacosAgentDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("ingestion.setupCard.pillUnifiedLog"),
          t("ingestion.setupCard.pillSystemLogs"),
          // Universal acronym — identical in every locale.
          raw("CPU"),
          t("ingestion.setupCard.pillMemory"),
          t("ingestion.setupCard.pillDisk"),
          t("common.network"),
        ],
      },
    ],
    detect: hostMetricsDetect,
    extras: {
      fixTitle: t("ingestion.setupCard.macosAgentServicesFixTitle"),
      fixBody: t("ingestion.setupCard.macosAgentFixBody"),
      fixLang: "bash",
      fixSnippet: `sudo launchctl print system/ai.openobserve.otelcol-contrib | head -20
sudo launchctl print system/ai.openobserve.macos-unified-log | head -20
sudo tail -50 /Library/Logs/openobserve-collector/collector.err`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.macosTroubleUnifiedLogQ"),
          a: t("ingestion.setupCard.macosTroubleUnifiedLogA"),
        },
        {
          q: t("ingestion.setupCard.macosTroubleVolumeQ"),
          a: t("ingestion.setupCard.macosTroubleVolumeA"),
        },
        {
          q: t("ingestion.setupCard.macosTroubleEmptyLogQ"),
          a: t("ingestion.setupCard.macosTroubleEmptyLogA"),
        },
        ...sharedAgentTroubleshooting(
          t,
          "`sudo launchctl print system/ai.openobserve.otelcol-contrib`",
          { includeEc2: false },
        ),
      ],
      uninstall: agentUninstall("mac"),
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
