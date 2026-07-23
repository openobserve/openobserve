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

// Linux host agent setup card. The environment choice (generic host vs AWS EC2)
// was previously two hand-built clickable <div> cards plus a conditional amber
// callout; it is now a variant toggle, with the EC2 IAM prerequisite riding on
// the EC2 variant's note where it is actually relevant.

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
  `curl -O ${AGENTS_REPO}/linux${env}/install.sh \\
  && chmod +x install.sh \\
  && sudo ./install.sh {url}/api/{org}/ {token}`;

export default function linuxCard(subs: CardSubstitutions): RichCardContent {
  const icon = envIcons();
  return {
    provider: {
      name: "Linux",
      tagline:
        "Install the OpenObserve agent on any Linux host — system and journald logs plus CPU, memory, disk and network metrics.",
      logo: getImageURL("images/common/linux.svg"),
      tone: "#f5b53d",
      runtime: "Host",
      setupTime: "~1 min",
      metaBadges: ["Logs", "Metrics"],
    },
    steps: [
      {
        id: "install",
        title: "Install the Agent",
        description:
          "Run this on the host as **root** (or with `sudo`). Pick **AWS EC2** to additionally pick up instance metadata and use the instance's Name tag as the host identifier.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        variants: [
          {
            id: "generic",
            label: "Generic Linux",
            icon: icon.linux,
            code: agentCode(install(""), subs, "bash"),
            note: "Any Linux server or VM.",
          },
          {
            id: "ec2",
            label: "AWS EC2",
            icon: icon.ec2,
            code: agentCode(install("/ec2"), subs, "bash"),
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
          "System Logs",
          "journald",
          "CPU",
          "Memory",
          "Disk",
          "Network",
        ],
      },
    ],
    detect: hostMetricsDetect,
    extras: {
      fixTitle: "Check The Agent Service",
      fixBody:
        "The installer starts the agent as a systemd service. If nothing arrives, confirm it is running and read its logs for an auth or connectivity error:",
      fixLang: "bash",
      fixSnippet: `sudo systemctl status openobserve-agent
sudo journalctl -u openobserve-agent -n 50 --no-pager`,
      troubleshooting: sharedAgentTroubleshooting(
        "`sudo systemctl status openobserve-agent`",
      ),
      uninstall: agentUninstall("linux"),
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
