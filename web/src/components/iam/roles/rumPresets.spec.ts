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

import { describe, expect, it } from "vitest";
import {
  RUM_ANALYTICS_RESOURCE,
  RUM_ANALYTICS_WRITE_PERMS,
  RUM_PRESETS,
  RUM_SOURCEMAPS_PERMS,
  RUM_SOURCEMAPS_RESOURCE,
  RUM_STREAMS,
  RUM_STREAM_ROW_PERMS,
  RUM_TYPE_NODE_PERMS,
} from "./rumPresets";

describe("RUM role presets", () => {
  it("read the two RUM streams the browser SDK ingests into", () => {
    expect(RUM_STREAMS).toEqual(["_rumdata", "_sessionreplay"]);
    expect(RUM_STREAM_ROW_PERMS).toEqual(["AllowGet"]);
  });

  // ALLOW_GET on `logs:_all_<org>` would read every log stream in the org, not just the RUM ones.
  it("grant the logs type node LIST and never GET", () => {
    expect(RUM_TYPE_NODE_PERMS).toEqual(["AllowList"]);
  });

  it("list source maps so stack traces resolve", () => {
    expect(RUM_SOURCEMAPS_RESOURCE).toBe("sourcemaps");
    expect(RUM_SOURCEMAPS_PERMS).toEqual(["AllowList"]);
  });

  it("only the editor writes the rum_analytics module", () => {
    expect(RUM_ANALYTICS_RESOURCE).toBe("rum_analytics");
    expect(RUM_ANALYTICS_WRITE_PERMS).toEqual(["AllowPost", "AllowPut", "AllowDelete"]);
    expect(RUM_PRESETS).toEqual({
      rum_viewer: { withWrite: false },
      rum_editor: { withWrite: true },
    });
  });
});
