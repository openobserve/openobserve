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

import { openobserveRum } from "@openobserve/browser-rum";

export default {
  track(event: string, properties?: object) {
    // RUM already records every click wherever it runs, so a named action adds no new data; telemetry_enabled only gates third-party analytics.
    if (!openobserveRum.getInitConfiguration()) return;
    openobserveRum.addAction(event, properties);
  },
};
