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

import config from "@/aws-exports";

const KILL_SWITCH = true;

/** Starter Packs ship in Enterprise and Cloud only; without it the routes are not registered, so the menu hides too. */
export const STARTER_PACKS_ENABLED: boolean =
  KILL_SWITCH && (config.isEnterprise == "true" || config.isCloud == "true");
