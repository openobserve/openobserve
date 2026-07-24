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

export default function macosCard(subs: CardSubstitutions): RichCardContent {
  return {
    provider: {
      name: "macOS",
      tagline:
        "Install the OpenObserve agent on any Mac — the unified log and standard log files plus CPU, memory, disk and network metrics.",
      logo: getImageURL("images/common/macos.png"),
      tone: "#86868b",
      runtime: "Host",
      setupTime: "~1 min",
      metaBadges: ["Logs", "Metrics"],
    },
    steps: [
      {
        id: "install",
        title: "Install the Agent",
        description:
          "Run this on the Mac with `sudo`. It installs the agent as a launchd daemon, plus a second daemon that bridges the macOS unified log into it.",
        chip: { kind: "terminal", label: "Terminal" },
        required: true,
        completeOn: "copy",
        code: agentCode(install, subs, "bash"),
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Both daemons start on install. Give it a few seconds, then hit Test — host metrics arrive as `system_*` streams and the unified log lands in the `macos_unified` stream.",
        chip: { kind: "traces", label: "Metrics" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Unified Log", "System Logs", "CPU", "Memory", "Disk", "Network"],
      },
    ],
    detect: hostMetricsDetect,
    extras: {
      fixTitle: "Check The Agent Services",
      fixBody:
        "The installer registers two launchd daemons: the agent itself and the unified log bridge. If nothing arrives, confirm both are loaded and read the agent's log for an auth or connectivity error:",
      fixLang: "bash",
      fixSnippet: `sudo launchctl print system/ai.openobserve.otelcol-contrib | head -20
sudo launchctl print system/ai.openobserve.macos-unified-log | head -20
sudo tail -50 /Library/Logs/openobserve-collector/collector.err`,
      troubleshooting: [
        {
          q: "Host metrics arrive but there are no unified log entries",
          a: "That is the bridge daemon, not the agent. Check `sudo launchctl print system/ai.openobserve.macos-unified-log`, and that the agent is listening for it with `sudo lsof -nP -iTCP:54525 -sTCP:LISTEN`.",
        },
        {
          q: "The unified log is sending far more than expected",
          a: "It is high volume by default — hundreds of events per second on an idle Mac. Narrow it with the `LEVEL` and `PREDICATE` knobs at the top of `/opt/openobserve-collector/macos-unified-log.sh`, then apply with `sudo launchctl kickstart -k system/ai.openobserve.macos-unified-log`.",
        },
        {
          q: "The agent's own log file is empty",
          a: "That is expected. The agent logs at `warn` and above so a healthy install writes almost nothing. To debug, raise it temporarily: `sudo sed -i '' 's/level: warn/level: info/' /etc/otel-config.yaml` then kickstart the service.",
        },
        ...sharedAgentTroubleshooting(
          "`sudo launchctl print system/ai.openobserve.otelcol-contrib`",
          { includeEc2: false },
        ),
      ],
      uninstall: agentUninstall("mac"),
    },
    docUrl: "https://github.com/openobserve/agents",
  };
}
