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
// scaffolding (environment toggle, EC2 IAM prerequisite, host-metrics detection)
// comes from ./osAgent; this file holds the PowerShell command and the
// Windows-specific collection list.

import { gt, raw } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import {
  AGENTS_REPO,
  EC2_IAM_NOTE,
  agentCode,
  agentUninstall,
  envIcons,
  hostMetricsDetect,
  sharedAgentTroubleshooting,
} from "./osAgent";

const install = (env: "" | "/ec2") =>
  `Invoke-WebRequest -Uri ${AGENTS_REPO}/windows${env}/install.ps1 -OutFile install.ps1
.\\install.ps1 -URL {url}/api/{org}/ -AUTH_KEY {token}`;

export default function windowsCard(subs: CardSubstitutions): RichCardContent {
  const icon = envIcons();
  return {
    provider: {
      name: "Windows",
      tagline: gt("ingestion.setupCard.taglineWindows"),
      logo: getImageURL("images/common/windows.svg"),
      tone: "#0078d4",
      runtime: "Host",
      setupTime: "~1 min",
      metaBadges: [gt("common.logs"), gt("common.metrics")],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.installAgentTitle",
        descriptionKey: "ingestion.setupCard.installAgentWindowsDesc",
        chip: { kind: "terminal", label: raw("PowerShell") },
        required: true,
        completeOn: "copy",
        variants: [
          {
            id: "generic",
            labelKey: "ingestion.setupCard.genericWindowsVariant",
            icon: icon.windows,
            code: agentCode(install(""), subs, "powershell"),
            note: "Any Windows server or VM.",
          },
          {
            id: "ec2",
            label: raw("AWS EC2"),
            icon: icon.ec2,
            code: agentCode(install("/ec2"), subs, "powershell"),
            note: EC2_IAM_NOTE,
          },
        ],
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
          gt("ingestion.setupCard.pillApplication"),
          gt("ingestion.setupCard.pillSecurity"),
          gt("ingestion.setupCard.pillSetup"),
          gt("ingestion.setupCard.pillSystem"),
          gt("ingestion.setupCard.pillPerformanceCounters"),
          gt("ingestion.setupCard.pillHostMetrics"),
        ],
      },
    ],
    detect: hostMetricsDetect,
    extras: {
      fixTitle: "Check The Agent Service",
      fixBody:
        "The installer registers the agent as a Windows service. If nothing arrives, confirm it is running and read the most recent entries from its log:",
      fixLang: "powershell",
      fixSnippet: `Get-Service -Name openobserve-agent
Get-Content -Tail 50 "$env:ProgramData\\openobserve-agent\\agent.log"`,
      troubleshooting: [
        {
          q: "The script fails to run at all",
          a: "PowerShell blocks unsigned scripts by default. Run the console **as Administrator** and, if needed, allow the script for that session with `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.",
        },
        ...sharedAgentTroubleshooting("`Get-Service -Name openobserve-agent`"),
      ],
      uninstall: agentUninstall("windows"),
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
