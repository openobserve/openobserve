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

import { assistantKeys } from "./assistant.querykeys";
import type { AssistantActivityFilter } from "./assistant_settings";

/** Every read under Settings › Assistant sits below `assistantKeys.settings`, so one scope refetches the page. */
export const assistantSettingsKeys = {
  all: (org: string) => assistantKeys.settings(org),
  org: (org: string) => [...assistantKeys.settings(org), "org"] as const,
  grants: (org: string) => [...assistantKeys.settings(org), "grants"] as const,
  activityAll: (org: string) => [...assistantKeys.settings(org), "activity"] as const,
  activity: (org: string, filter: AssistantActivityFilter) =>
    [...assistantKeys.settings(org), "activity", filter] as const,
};
