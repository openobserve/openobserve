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

// Linux host agent setup card. A single install command: the standard install
// script also collects EC2 instance metadata, so there is no separate AWS EC2
// variant.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import {
  AGENTS_REPO,
  agentCode,
  agentUninstall,
  dashboardReadyStep,
  hostMetricsDetect,
  sharedAgentTroubleshooting,
} from "./osAgent";

const install = `curl -O ${AGENTS_REPO}/linux/install.sh \\
  && chmod +x install.sh \\
  && sudo ./install.sh {url}/api/{org}/ {token}`;

export default function linuxCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      id: "linux",
      name: raw("Linux"),
      tagline: t("ingestion.setupCard.taglineLinux"),
      logo: getImageURL("images/common/linux.svg"),
      tone: "#f5b53d",
      runtime: t("ingestion.setupCard.runtimeHost"),
      setupTime: t("ingestion.setupCard.setupTime1Min"),
      metaBadges: [t("common.logs"), t("common.metrics")],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.installAgentTitle",
        descriptionKey: "ingestion.setupCard.installAgentLinuxDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipTerminal" },
        required: true,
        completeOn: "copy",
        code: agentCode(install, subs, "bash"),
        note: t("ingestion.setupCard.anyLinuxHostNote"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyLinuxAgentDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("ingestion.setupCard.pillSystemLogs"),
          // Daemon name and a universal acronym — the same token in every locale.
          raw("journald"),
          raw("CPU"),
          t("ingestion.setupCard.pillMemory"),
          t("ingestion.setupCard.pillDisk"),
          t("common.network"),
        ],
      },
      dashboardReadyStep(t),
    ],
    detect: hostMetricsDetect,
    extras: {
      fixTitle: t("ingestion.setupCard.agentServiceFixTitle"),
      fixBody: t("ingestion.setupCard.linuxAgentFixBody"),
      fixLang: "bash",
      fixSnippet: `sudo systemctl status openobserve-agent
sudo journalctl -u openobserve-agent -n 50 --no-pager`,
      troubleshooting: sharedAgentTroubleshooting(t, "`sudo systemctl status openobserve-agent`"),
      uninstall: agentUninstall("linux"),
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
