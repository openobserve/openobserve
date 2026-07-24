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

/** The kind of alert chosen at creation time (the entry type-picker). */
export type AlertKind = "simple" | "composite" | "anomaly";

export interface AlertTypeCard {
  /** Stable identifier emitted on select. */
  type: AlertKind;
  /** O2 icon name shown on the card. */
  icon: IconName;
  /** i18n key for the card title. */
  labelKey: string;
  /** i18n key for the card description. */
  descKey: string;
}

/**
 * The alert kinds offered by the "Add alert" entry picker (mirrors the
 * Synthetics CHECK_TYPE_CARDS pattern). Anomaly/composite availability is gated
 * by the caller via the picker's `disabledTypes` / `comingSoonTypes` props — the
 * card list itself stays declarative.
 */
export const ALERT_TYPE_CARDS: AlertTypeCard[] = [
  {
    type: "simple",
    icon: "notifications",
    labelKey: "alerts.newAlert.simple",
    descKey: "alerts.newAlert.simpleDesc",
  },
  {
    type: "composite",
    icon: "layers",
    labelKey: "alerts.newAlert.composite",
    descKey: "alerts.newAlert.compositeDesc",
  },
  {
    type: "anomaly",
    icon: "trending-up",
    labelKey: "alerts.newAlert.anomaly",
    descKey: "alerts.newAlert.anomalyDesc",
  },
];
