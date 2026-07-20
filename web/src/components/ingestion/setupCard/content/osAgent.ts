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

import { getImageURL } from "@/utils/zincutils";
import type { CardSubstitutions, RichCardDetect, RichCardExtras } from "../types";
import { applySubs, applySubsMasked } from "../subs";

/** Base of the agent install scripts, e.g. `${AGENTS_REPO}/linux/install.sh`. */
export const AGENTS_REPO =
  "https://raw.githubusercontent.com/openobserve/agents/main";

/** Environment the agent is installed onto — drives the script path. */
export type AgentEnv = "generic" | "ec2";

/**
 * The EC2 variants read the instance's Name tag and use it as the host
 * identifier, which needs an instance role — without it the agent installs but
 * every host shows up under its opaque instance id instead.
 */
export const EC2_IAM_NOTE =
  "Requires an IAM role on the instance with ec2:DescribeTags and ec2:DescribeInstances, so the agent can read the Name tag and use it as the host identifier.";

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

/** Troubleshooting rows common to both host agents. */
export function sharedAgentTroubleshooting(
  serviceHint: string,
): NonNullable<RichCardExtras["troubleshooting"]> {
  return [
    {
      q: "The install script runs but no data arrives",
      a: `Check the agent is running with ${serviceHint}. A 401 in its logs means the ingestion token is stale — re-copy the command from this page, which always carries this organization's current token.`,
    },
    {
      q: "Hosts show up under an instance id instead of a name",
      a: `That is the EC2 variant without its IAM role. ${EC2_IAM_NOTE} Attach the role, then restart the agent.`,
    },
    {
      q: "The endpoint is unreachable from the host",
      a: "The agent needs outbound access to this OpenObserve endpoint. Confirm with `curl -v` from the host itself — a proxy or egress firewall is the usual cause.",
    },
  ];
}
