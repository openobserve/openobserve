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

// Windows host agent setup card — the PowerShell twin of ./linux.ts. Shared
// scaffolding (install code block, host-metrics detection, troubleshooting rows)
// comes from ./osAgent; this file holds the PowerShell command and the
// Windows-specific collection list.

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

const install = `Invoke-WebRequest -Uri ${AGENTS_REPO}/windows/install.ps1 -OutFile install.ps1
.\\install.ps1 -URL {url}/api/{org}/ -AUTH_KEY {token}`;

export default function windowsCard(subs: CardSubstitutions, t: TranslateFn): RichCardContent {
  return {
    provider: {
      id: "windows",
      name: raw("Windows"),
      tagline: t("ingestion.setupCard.taglineWindows"),
      logo: getImageURL("images/common/windows.svg"),
      tone: "#0078d4",
      runtime: t("ingestion.setupCard.runtimeHost"),
      setupTime: t("ingestion.setupCard.setupTime1Min"),
      metaBadges: [t("common.logs"), t("common.metrics")],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.installAgentTitle",
        descriptionKey: "ingestion.setupCard.installAgentWindowsDesc",
        chip: { kind: "terminal", label: raw("PowerShell") },
        required: true,
        completeOn: "copy",
        code: agentCode(install, subs, "powershell"),
        note: t("ingestion.setupCard.anyWindowsHostNote"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyWindowsAgentDesc",
        chip: { kind: "traces", labelKey: "ingestion.setupCard.chipMetrics" },
        completeOn: "detect",
        detectionAnchor: true,
        // The four Windows Event Log channels, which the Event Viewer itself
        // localises — so they are translated rather than raw() tokens.
        pills: [
          t("ingestion.setupCard.pillApplication"),
          t("ingestion.setupCard.pillSecurity"),
          t("ingestion.setupCard.pillSetup"),
          t("ingestion.setupCard.pillSystem"),
          t("ingestion.setupCard.pillPerformanceCounters"),
          t("ingestion.setupCard.pillHostMetrics"),
        ],
      },
      dashboardReadyStep(t),
    ],
    detect: hostMetricsDetect,
    extras: {
      fixTitle: t("ingestion.setupCard.agentServiceFixTitle"),
      fixBody: t("ingestion.setupCard.windowsAgentFixBody"),
      fixLang: "powershell",
      fixSnippet: `Get-Service -Name openobserve-agent
Get-Content -Tail 50 "$env:ProgramData\\openobserve-agent\\agent.log"`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.windowsTroubleScriptQ"),
          a: t("ingestion.setupCard.windowsTroubleScriptA"),
        },
        ...sharedAgentTroubleshooting(t, "`Get-Service -Name openobserve-agent`"),
      ],
      uninstall: agentUninstall("windows"),
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
