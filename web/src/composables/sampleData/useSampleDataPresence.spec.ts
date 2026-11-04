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

import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { fetchHasUserStreams } from "./useSampleDataPresence";

const STREAMS_URL = `${store.state.API_ENDPOINT}/api/:org/streams`;

function mockLogs(names: string[]) {
  global.server.use(
    http.get(STREAMS_URL, ({ request }) => {
      const type = new URL(request.url).searchParams.get("type");
      const list = type === "logs" ? names.map((name) => ({ name, stream_type: "logs" })) : [];
      return HttpResponse.json({ list });
    }),
  );
}

describe("fetchHasUserStreams", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("is false when the org only has streams O2 writes itself", async () => {
    mockLogs(["triggers", "_o2_alert_calibration_digests"]);
    expect(await fetchHasUserStreams("default")).toBe(false);
  });

  it("is true when the org has a user logs stream", async () => {
    mockLogs(["triggers", "app_logs"]);
    expect(await fetchHasUserStreams("default")).toBe(true);
  });

  it("counts a sample stream as data", async () => {
    mockLogs(["o2_demo_app_logs"]);
    expect(await fetchHasUserStreams("default")).toBe(true);
  });
});
