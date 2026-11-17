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

import { describe, it, expect } from "vitest";
import { reactive } from "vue";
import {
  createTracesFailedRefreshHold,
  reportTracesChartRefreshFailed,
  startTracesChartLoad,
  tracesChartSource,
  type TracesRunState,
} from "./tracesFailedRefreshHold";

const makeSearchObj = () =>
  reactive<TracesRunState>({
    meta: {
      searchMode: "spans",
      refreshFailedAt: null,
      lastRunAt: 1_000,
      chartRefreshFailed: false,
    },
    data: { editorValue: "", stream: { selectedStream: { value: "default" } } },
  });

// Generates one RED panel from the search state as it is now, as loadDashboard does.
const generate = (
  host: ReturnType<typeof createTracesFailedRefreshHold>,
  searchObj: TracesRunState,
) => {
  const panel = { id: "rate" };
  host.generated([panel], tracesChartSource(searchObj));
  return panel;
};

describe("createTracesFailedRefreshHold", () => {
  it("names a chart's source by the stream, mode and query on screen", () => {
    const searchObj = makeSearchObj();
    const spans = tracesChartSource(searchObj);

    searchObj.meta.searchMode = "traces";
    expect(tracesChartSource(searchObj)).not.toBe(spans);
    searchObj.meta.searchMode = "spans";
    searchObj.data.editorValue = "  ";
    expect(tracesChartSource(searchObj)).toBe(spans);
  });

  it("names a panel by the run it was generated in, not by a query staged after it", () => {
    const searchObj = makeSearchObj();
    const host = createTracesFailedRefreshHold(searchObj);
    const panel = generate(host, searchObj);
    const builtFrom = tracesChartSource(searchObj);

    searchObj.data.editorValue = "service_name = 'api'";

    expect(host.source(panel)).toBe(builtFrom);
    expect(host.source(reactive(panel))).toBe(builtFrom);
    expect(host.source({ id: "rate" })).toBe("");
  });

  it("keeps a chart of the last generated run and marks the page's refresh failed", () => {
    const searchObj = makeSearchObj();
    const host = createTracesFailedRefreshHold(searchObj);
    startTracesChartLoad(searchObj);
    const panel = generate(host, searchObj);

    expect(host.hold("rate", host.source(panel))).toBe(true);
    expect(searchObj.meta.refreshFailedAt).toEqual(expect.any(Number));
    expect(searchObj.meta.chartRefreshFailed).toBe(true);
  });

  it("keeps no chart of another stream or mode and leaves the page alone", () => {
    const searchObj = makeSearchObj();
    const host = createTracesFailedRefreshHold(searchObj);
    searchObj.data.stream.selectedStream.value = "other";
    const otherStream = host.source(generate(host, searchObj));
    searchObj.data.stream.selectedStream.value = "default";
    searchObj.meta.searchMode = "traces";
    const otherMode = host.source(generate(host, searchObj));
    searchObj.meta.searchMode = "spans";
    startTracesChartLoad(searchObj);
    generate(host, searchObj);

    expect(host.hold("rate", otherStream)).toBe(false);
    expect(host.hold("rate", otherMode)).toBe(false);
    expect(searchObj.meta.refreshFailedAt).toBeNull();
    expect(searchObj.meta.chartRefreshFailed).toBe(false);
  });

  it("keeps no chart of a panel it never generated", () => {
    const searchObj = makeSearchObj();
    const host = createTracesFailedRefreshHold(searchObj);

    expect(host.hold("rate", host.source({ id: "rate" }))).toBe(false);
    expect(searchObj.meta.refreshFailedAt).toBeNull();
  });
});

describe("a chart's failed refresh after a query change on the same stream", () => {
  it("keeps no chart of the previous query and leaves the page alone", () => {
    const searchObj = makeSearchObj();
    const host = createTracesFailedRefreshHold(searchObj);
    const drawnFrom = host.source(generate(host, searchObj));

    searchObj.data.editorValue = "service_name = 'api'";
    startTracesChartLoad(searchObj);
    const next = generate(host, searchObj);

    expect(host.hold("rate", drawnFrom)).toBe(false);
    expect(searchObj.meta.refreshFailedAt).toBeNull();
    expect(host.hold("rate", host.source(next))).toBe(true);
  });

  it("keeps the chart of the run on screen while the next query is only staged", () => {
    const searchObj = makeSearchObj();
    const host = createTracesFailedRefreshHold(searchObj);
    const panel = generate(host, searchObj);

    searchObj.data.editorValue = "service_name = 'api'";

    expect(host.hold("rate", host.source(panel))).toBe(true);
  });
});

describe("a chart's failed refresh on the Traces page", () => {
  it("keeps the data age at the charts' run when it fails after the rows landed", () => {
    const searchObj = makeSearchObj();
    startTracesChartLoad(searchObj);
    searchObj.meta.lastRunAt = 2_000;

    reportTracesChartRefreshFailed(searchObj);

    expect(searchObj.meta.refreshFailedAt).toEqual(expect.any(Number));
    expect(searchObj.meta.lastRunAt).toBe(1_000);
  });

  it("starts each chart load with no failure of its own", () => {
    const searchObj = makeSearchObj();
    startTracesChartLoad(searchObj);
    reportTracesChartRefreshFailed(searchObj);
    searchObj.meta.lastRunAt = 3_000;

    startTracesChartLoad(searchObj);

    expect(searchObj.meta.chartRefreshFailed).toBe(false);
    expect(searchObj.meta.chartsDataFrom).toBe(3_000);
  });
});
