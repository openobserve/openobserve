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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { gt } from "@/types/i18n";
import { nextTick } from "vue";
import { usePanelDrilldown } from "./usePanelDrilldown";

const resultSchemaMock = vi.fn();

vi.mock("@/services/search", () => ({
  default: {
    result_schema: (...args: any[]) => resultSchemaMock(...args),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: (v: string) => `b64(${v})`,
  escapeSingleQuotes: (v: string) => v,
}));

describe("usePanelDrilldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultSchemaMock.mockResolvedValue({
      data: {
        cross_links: {
          stream_links: [
            {
              name: "Stream Link",
              url: "https://example.com?q=${field_name}",
              fields: [{ name: "field_name", alias: "field_alias" }],
            },
          ],
          org_links: [],
        },
      },
    });
  });

  const makeDeps = () => {
    const drilldownPopup = {
      style: { display: "none", top: "", left: "" },
      offsetHeight: 20,
      offsetWidth: 40,
    };
    const annotationPopup = {
      style: { display: "none", top: "", left: "" },
      offsetHeight: 20,
      offsetWidth: 40,
    };

    return {
      panelSchema: {
        value: {
          type: "line",
          queryType: "sql",
          config: {
            drilldown: [{ name: "Logs", type: "byUrl", data: { url: "https://example.com" } }],
          },
          queries: [
            {
              fields: {
                stream: "default",
                stream_type: "logs",
                x: [],
                y: [],
                z: [],
                breakdown: [],
              },
              query: "select * from logs",
            },
          ],
        },
      },
      variablesData: { value: { values: [] } },
      selectedTimeObj: {
        value: {
          start_time: new Date("2026-03-18T00:00:00Z"),
          end_time: new Date("2026-03-18T01:00:00Z"),
        },
      },
      metadata: { value: { queries: [{ query: "select * from logs" }] } },
      data: { value: [] },
      panelData: { value: { options: { xAxis: [{ data: [] }], series: [] } } },
      filteredData: { value: [] },
      resultMetaData: { value: [[{ histogram_interval: 1 }]] },
      store: {
        state: {
          timezone: "UTC",
          selectedOrganization: { identifier: "org-1" },
          zoConfig: {
            enable_cross_linking: true,
            sql_base64_enabled: false,
            quick_mode_enabled: false,
          },
        },
        dispatch: vi.fn(),
      },
      route: { query: {} },
      router: { push: vi.fn() },
      emit: vi.fn(),
      allowAnnotationsAdd: { value: false },
      isAddAnnotationMode: { value: false },
      editAnnotation: vi.fn(),
      handleAddAnnotation: vi.fn(),
      chartPanelRef: {
        value: {
          offsetHeight: 300,
          offsetWidth: 300,
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
      },
      drilldownPopUpRef: { value: drilldownPopup },
      annotationPopupRef: { value: annotationPopup },
      selectedAnnotationData: { value: null },
      isCursorOverPanel: { value: true },
      showErrorNotification: vi.fn(),
      t: gt,
    };
  };

  it("hides popups and resets cursor state", async () => {
    const deps = makeDeps();
    const api = usePanelDrilldown(deps as any);

    deps.drilldownPopUpRef.value.style.display = "block";
    deps.annotationPopupRef.value.style.display = "block";

    api.hidePopupsAndOverlays();

    expect(deps.drilldownPopUpRef.value.style.display).toBe("none");
    expect(deps.annotationPopupRef.value.style.display).toBe("none");
    expect(deps.isCursorOverPanel.value).toBe(false);

    await nextTick();
  });

  it("handles annotation add mode and routes event to edit handler", async () => {
    const deps = makeDeps();
    deps.allowAnnotationsAdd.value = true;
    deps.isAddAnnotationMode.value = true;

    const api = usePanelDrilldown(deps as any);

    await api.onChartClick({
      componentType: "markLine",
      data: { annotationDetails: { id: "anno-1" } },
    });

    expect(deps.editAnnotation).toHaveBeenCalledWith({ id: "anno-1" });
    expect(deps.handleAddAnnotation).not.toHaveBeenCalled();
  });

  it("shows drilldown popup when panel drilldowns exist", async () => {
    const deps = makeDeps();
    const api = usePanelDrilldown(deps as any);

    await api.onChartClick({
      componentType: "series",
      event: { offsetX: 40, offsetY: 50 },
      dataIndex: 0,
      seriesName: "series-a",
      value: ["x", 1],
    });

    expect(api.drilldownArray.value.length).toBeGreaterThan(0);
    expect(deps.drilldownPopUpRef.value.style.display).toBe("block");
    expect(deps.drilldownPopUpRef.value.style.top).toContain("px");
    expect(deps.drilldownPopUpRef.value.style.left).toContain("px");
  });

  it("fetches cross-links lazily on the first drilldown interaction, not on panel render", async () => {
    const deps = makeDeps();
    const api = usePanelDrilldown(deps as any);

    await nextTick();
    // Lazy: a panel render (dashboard refresh) must NOT fire result_schema.
    expect(resultSchemaMock).not.toHaveBeenCalled();

    await api.ensureDrilldownSchema();

    expect(resultSchemaMock).toHaveBeenCalledTimes(1);
    expect(api.crossLinksData.value.stream_links).toHaveLength(1);
  });

  it("resets cross-links when disabled", async () => {
    const deps = makeDeps();
    deps.store.state.zoConfig.enable_cross_linking = false;

    const api = usePanelDrilldown(deps as any);
    await nextTick();
    await api.ensureDrilldownSchema();

    expect(resultSchemaMock).not.toHaveBeenCalled();
    expect(api.crossLinksData.value).toEqual({ stream_links: [], org_links: [] });
  });

  // ── Table cell → Logs drilldown ──────────────────────────────────────────
  // The drillable-columns watcher parses SQL via a dynamically-imported parser.
  // Under parallel test load that import can take longer than a few microtask
  // turns, so poll the result rather than fixing a turn count (avoids flakiness).
  const flush = async (ready?: () => boolean) => {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 2));
      if (ready?.()) return;
    }
  };

  const makeTableDeps = (query: string) => {
    const deps = makeDeps();
    deps.panelSchema.value.type = "table";
    (deps.panelSchema.value.queries[0] as any).query = query;
    (deps.metadata.value.queries[0] as any).query = query;
    return deps;
  };

  it("marks group-by dimension columns drillable and excludes aggregates", async () => {
    const deps = makeTableDeps("select service, count(*) as cnt from logs group by service");
    const api = usePanelDrilldown(deps as any);
    await flush();

    expect(api.drilldownColumnAliases.value).toContain("service");
    expect(api.drilldownColumnAliases.value).not.toContain("cnt");
    expect(api.drilldownAllColumns.value).toBe(false);
  });

  it("treats SELECT * / dynamic-columns tables as all-columns drillable", async () => {
    const deps = makeTableDeps("select * from logs");
    const api = usePanelDrilldown(deps as any);
    await flush();

    expect(api.drilldownAllColumns.value).toBe(true);
  });

  it("resolves each join column to its own stream (join-aware)", async () => {
    const deps = makeTableDeps(
      "select a.svc as svc, b.region as region, count(*) as cnt " +
        "from stream_a a join stream_b b on a.id = b.id group by svc, region",
    );
    const api = usePanelDrilldown(deps as any);
    await flush();

    // Both dimension columns drillable; the aggregate excluded.
    expect(api.drilldownColumnAliases.value).toEqual(expect.arrayContaining(["svc", "region"]));
    expect(api.drilldownColumnAliases.value).not.toContain("cnt");

    // Each column resolves to the stream its alias points at, and is flagged as a join.
    const svc = api.getCellDrilldownField(0, "svc");
    const region = api.getCellDrilldownField(0, "region");
    expect(svc.streamName).toBe("stream_a");
    expect(region.streamName).toBe("stream_b");
    expect(svc.isJoin).toBe(true);
  });

  it("captures the backend per-stream WHERE from result_schema into panelWhereByStream", async () => {
    resultSchemaMock.mockResolvedValue({
      data: {
        where_by_stream: { stream_a: "env = 'prod'", stream_b: "tier = 'gold'" },
        cross_links: { stream_links: [], org_links: [] },
      },
    });
    const deps = makeDeps();
    const api = usePanelDrilldown(deps as any);
    await api.ensureDrilldownSchema();

    expect(api.panelWhereByStream.value).toEqual({
      stream_a: "env = 'prod'",
      stream_b: "tier = 'gold'",
    });
  });

  it("captures the backend-parsed WHERE from result_schema into panelBaseWhere", async () => {
    resultSchemaMock.mockResolvedValue({
      data: {
        where_clause: "level = 'error'",
        cross_links: { stream_links: [], org_links: [] },
      },
    });
    const deps = makeDeps();
    const api = usePanelDrilldown(deps as any);
    await api.ensureDrilldownSchema();

    expect(api.panelBaseWhere.value).toBe("level = 'error'");
  });

  it("fetches per clicked query index for multi-query panels (2nd-query cell fires result_schema)", async () => {
    // result_schema returns a WHERE keyed off the SQL it was sent, so we can tell the two apart.
    resultSchemaMock.mockImplementation((payload: any) => {
      const sql = payload?.query?.query?.sql ?? "";
      return Promise.resolve({
        data: {
          where_clause: sql.includes("stream_b") ? "region = 'us'" : "level = 'error'",
          cross_links: { stream_links: [], org_links: [] },
        },
      });
    });

    const deps = makeDeps();
    deps.panelSchema.value.queries = [
      { fields: { stream: "stream_a", stream_type: "logs" }, query: "select * from stream_a" },
      { fields: { stream: "stream_b", stream_type: "logs" }, query: "select * from stream_b" },
    ] as any;
    deps.metadata.value.queries = [
      { query: "select * from stream_a where level = 'error'" },
      { query: "select * from stream_b where region = 'us'" },
    ] as any;

    const api = usePanelDrilldown(deps as any);

    // Click a query-0 cell.
    await api.ensureDrilldownSchema(0);
    expect(api.panelBaseWhere.value).toBe("level = 'error'");

    // Click a query-1 cell — must fire a fresh result_schema for query 1, not reuse query 0's cache.
    await api.ensureDrilldownSchema(1);
    expect(resultSchemaMock).toHaveBeenCalledTimes(2);
    expect(api.panelBaseWhere.value).toBe("region = 'us'");
    // The query-1 request carried query 1's SQL.
    const secondCallSql = resultSchemaMock.mock.calls[1][0]?.query?.query?.sql ?? "";
    expect(secondCallSql).toContain("stream_b");

    // Re-clicking query 0 hits the cache (no third call).
    await api.ensureDrilldownSchema(0);
    expect(resultSchemaMock).toHaveBeenCalledTimes(2);
    expect(api.panelBaseWhere.value).toBe("level = 'error'");
  });
});
