import { describe, expect, it, beforeEach, vi } from "vitest";
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
          queries: [{
            fields: {
              stream: "default",
              stream_type: "logs",
              x: [],
              y: [],
              z: [],
              breakdown: [],
            },
            query: "select * from logs",
          }],
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

  it("fetches cross-links through result schema watch", async () => {
    const deps = makeDeps();
    const api = usePanelDrilldown(deps as any);

    await nextTick();

    expect(resultSchemaMock).toHaveBeenCalledTimes(1);
    expect(api.crossLinksData.value.stream_links).toHaveLength(1);
  });

  it("resets cross-links when disabled", async () => {
    const deps = makeDeps();
    deps.store.state.zoConfig.enable_cross_linking = false;

    const api = usePanelDrilldown(deps as any);
    await nextTick();

    expect(resultSchemaMock).not.toHaveBeenCalled();
    expect(api.crossLinksData.value).toEqual({ stream_links: [], org_links: [] });
  });
});
