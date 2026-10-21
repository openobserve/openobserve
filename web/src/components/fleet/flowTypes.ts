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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";
import type { PathSeverity } from "./flowIssues";

export type Telemetry = "logs" | "metrics" | "traces";

export type FlowSignal = Telemetry | "all";

export type FlowWindow = "5m" | "1h" | "24h";

export interface FleetFlowNodeData {
  label: I18nText;
  icon: IconName;
  sublabel?: I18nText;
  badge?: I18nText;
  count?: number;
  selected?: boolean;
  compact?: boolean;
  add?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  /** Worst issue on the node, shown as a corner dot. */
  issueSeverity?: PathSeverity;
  issueCount?: number;
  /** A failing component, shown as a ring around the node. */
  ring?: PathSeverity;
}

export interface FleetFlowEdgeData {
  signal: Telemetry;
  /** Stroke width in canvas units, scaled from the rate. */
  width: number;
  /** A failure branch: dashed, danger-coloured, labelled at its end. */
  branch?: boolean;
  label?: I18nText;
  noData?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  summary?: I18nText;
}
