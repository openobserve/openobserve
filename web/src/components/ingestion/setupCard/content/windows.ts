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

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardContent } from "../types";
import {
  AGENTS_REPO,
  EC2_IAM_NOTE,
  agentCode,
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
      tagline:
        "Install the OpenObserve agent on any Windows host — Event Log, performance counters and host metrics.",
      logo: getImageURL("images/common/windows.svg"),
      tone: "#0078d4",
      runtime: "Host",
      setupTime: "~1 min",
      metaBadges: ["Logs", "Metrics"],
    },
    steps: [
      {
        id: "install",
        title: "Install the Agent",
        description:
          "Run this in **PowerShell as Administrator**. Pick **AWS EC2** to additionally pick up instance metadata and use the instance's Name tag as the host identifier.",
        chip: { kind: "terminal", label: "PowerShell" },
        required: true,
        completeOn: "copy",
        variants: [
          {
            id: "generic",
            label: "Generic Windows",
            icon: icon.windows,
            code: agentCode(install(""), subs, "powershell"),
            note: "Any Windows server or VM.",
          },
          {
            id: "ec2",
            label: "AWS EC2",
            icon: icon.ec2,
            code: agentCode(install("/ec2"), subs, "powershell"),
            note: EC2_IAM_NOTE,
          },
        ],
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "The agent starts on install. Give it a few seconds, then hit Test — host metrics arrive as `system_*` streams.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          "Application",
          "Security",
          "Setup",
          "System",
          "Performance Counters",
          "Host Metrics",
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
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
