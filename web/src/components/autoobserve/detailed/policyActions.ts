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

import type { I18nKey } from "@/types/i18n";

export interface PolicyAction {
  id: string;
  title: I18nKey;
  detail: I18nKey;
}

// The actions AutoObserve proposes today; each waits for a person, since no mode setting exists yet.
export const COVERAGE_ACTIONS: PolicyAction[] = [
  {
    id: "addAlert",
    title: "autoobserve.policyLive.actions.addAlert.title",
    detail: "autoobserve.policyLive.actions.addAlert.detail",
  },
];

export const ALERT_ACTIONS: PolicyAction[] = [
  {
    id: "destinations",
    title: "autoobserve.policyLive.actions.destinations.title",
    detail: "autoobserve.policyLive.actions.destinations.detail",
  },
  {
    id: "pending",
    title: "autoobserve.policyLive.actions.pending.title",
    detail: "autoobserve.policyLive.actions.pending.detail",
  },
  {
    id: "keepFiring",
    title: "autoobserve.policyLive.actions.keepFiring.title",
    detail: "autoobserve.policyLive.actions.keepFiring.detail",
  },
  {
    id: "silence",
    title: "autoobserve.policyLive.actions.silence.title",
    detail: "autoobserve.policyLive.actions.silence.detail",
  },
];
