import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

const getStreamsMock = vi.hoisted(() =>
  vi.fn(async (type: string) => {
    const map: Record<string, any> = {
      logs: { list: [{ name: "app" }, { name: "sys" }] },
      metrics: { list: [{ name: "cpu" }] },
      traces: { list: [{ name: "svc-a" }] },
      index: { list: [{ name: "users" }] },
      enrichment_tables: { list: [{ name: "geo" }] },
      metadata: { list: [{ name: "meta" }] },
    };
    return map[type] || { list: [] };
  }),
);

vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    getGroups: vi.fn(async () => ({ data: [] })),
    getRoles: vi.fn(async () => ({ data: [] })),
  });
});

vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, { default: {} });
});
vi.mock("@/services/pipelines", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      getPipelines: vi.fn(async () => ({ data: { list: [{ pipeline_id: "p1", name: "P1" }] } })),
    },
  });
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      listByFolderId: vi.fn(async () => ({ data: { list: [{ alertId: "a1", name: "A1" }] } })),
    },
  });
});
vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      listByFolderId: vi.fn(async () => ({
        data: { list: [{ report_id: "rep1", name: "Rep1" }] },
      })),
    },
  });
});
vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: { list: vi.fn(async () => ({ data: [{ name: "t1" }] })) },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: { list: vi.fn(async () => ({ data: [{ name: "dest1" }] })) },
  });
});
vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: { list: vi.fn(async () => ({ data: { list: [{ name: "f1" }] } })) },
  });
});
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      list: vi.fn(async () => ({ data: { data: [{ identifier: "org1" }] } })),
    },
  });
});
vi.mock("@/services/saved_views", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      get: vi.fn(async () => ({ data: { views: [{ view_id: "v1", view_name: "V1" }] } })),
    },
  });
});
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      list: vi.fn(async () => ({ data: { dashboards: [{ dashboardId: "d1", title: "D1" }] } })),
      list_Folders: vi.fn(async () => ({ data: { list: [{ folderId: "f1", name: "F1" }] } })),
    },
  });
});
vi.mock("@/services/service_accounts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: { list: vi.fn(async () => ({ data: { data: ["svc1@example.com"] } })) },
  });
});
vi.mock("@/services/cipher_keys", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: { list: vi.fn(async () => ({ data: { keys: [{ name: "key1" }] } })) },
  });
});
vi.mock("@/services/regex_pattern", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      list: vi.fn(async () => ({ data: { patterns: [{ id: "re1", name: "Re1" }] } })),
    },
  });
});
vi.mock("@/services/common", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      list_Folders: vi.fn(async () => ({ data: { list: [{ folderId: "f9", name: "F9" }] } })),
    },
  });
});
vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      listByFolderId: vi.fn(async () => ({ data: { checks: [{ id: "s1", name: "S1" }] } })),
    },
  });
});
vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      listWorkflows: vi.fn(async () => ({ data: [{ id: "w1", name: "W1" }] })),
    },
  });
});
vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock((await importOriginal()) as any, {
    default: {
      providers: { list: vi.fn(async () => [{ id: "openai", name: "OpenAI" }]) },
      scoreConfigs: {
        list: vi.fn(async () => [{ entity_id: "quality-score", name: "Quality Score" }]),
      },
      scorers: { list: vi.fn(async () => [{ entityId: "llm-judge", name: "LLM Judge" }]) },
      jobs: { list: vi.fn(async () => [{ id: "daily-eval", name: "Daily Eval" }]) },
    },
  });
});
vi.mock("@/services/llm-queues.service", () => ({
  default: { list: vi.fn(async () => [{ id: "review-queue", name: "Review Queue" }]) },
}));
vi.mock("@/services/llm-datasets.service", () => ({
  default: { list: vi.fn(async () => [{ id: "golden-set", name: "Golden Set" }]) },
}));

import { useRoleEntityLoaders } from "@/composables/iam/useRoleEntityLoaders";
import { queryClient } from "@/composables/query/queryClient";
import alertService from "@/services/alerts";
import cipherKeysService from "@/services/cipher_keys";
import commonService from "@/services/common";
import dashboardService from "@/services/dashboards";
import destinationService from "@/services/alert_destination";
import jsTransformService from "@/services/jstransform";
import llmDatasetsService from "@/services/llm-datasets.service";
import llmQueuesService from "@/services/llm-queues.service";
import onlineEvalsService from "@/services/online-evals.service";
import organizationsService from "@/services/organizations";
import pipelineService from "@/services/pipelines";
import RePatternsService from "@/services/regex_pattern";
import reportService from "@/services/reports";
import savedviewsService from "@/services/saved_views";
import serviceAccountService from "@/services/service_accounts";
import syntheticsService from "@/services/synthetics";
import templateService from "@/services/alert_templates";
import workflowService from "@/services/workflows";

const ORG = "default";

// The row builders live in EditRole.vue; here they are stubs that record what
// each loader hands them and keep the entity count observable.
function setup() {
  const updateResourceEntities = vi.fn();
  const updateEntityEntities = vi.fn((entity: any, _keys: string[], entities: any[]) => {
    entity?.entities?.push(...entities);
  });
  const updateResourceResource = vi.fn();

  const loaders = useRoleEntityLoaders({
    store: { state: { selectedOrganization: { identifier: ORG } } },
    getStreams: getStreamsMock,
    t: (key: string) => key,
    updateResourceEntities,
    updateEntityEntities,
    updateResourceResource,
  });

  return { ...loaders, updateResourceEntities, updateEntityEntities, updateResourceResource };
}

const row = (extra: Record<string, any> = {}) => ({
  name: "",
  entities: [] as any[],
  is_loading: false,
  ...extra,
});

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRoleEntityLoaders - getResourceEntities dispatch", () => {
  it("resolves without touching a service when the resource is missing", async () => {
    const { getResourceEntities } = setup();
    getStreamsMock.mockClear();

    await expect(getResourceEntities(null as any)).resolves.toBe(true);
    expect(getStreamsMock).not.toHaveBeenCalled();
  });

  it("dispatches on resourceName and flips is_loading back to false", async () => {
    const { getResourceEntities } = setup();
    const resource = row({ resourceName: "pipeline" });

    const pending = getResourceEntities(resource as any);
    expect(resource.is_loading).toBe(true);
    await pending;

    expect(pipelineService.getPipelines).toHaveBeenCalledTimes(1);
    expect(resource.is_loading).toBe(false);
  });

  it("prefers childName over resourceName when both map to a loader", async () => {
    const { getResourceEntities } = setup();
    // The folder row carries resourceName "dfolder" AND childName "dashboard";
    // childName wins, so the dashboards loader runs, not the folders loader.
    const folder = row({ name: "f1", resourceName: "dfolder", childName: "dashboard" });

    await getResourceEntities(folder as any);

    expect(dashboardService.list).toHaveBeenCalledTimes(1);
    expect(dashboardService.list_Folders).not.toHaveBeenCalled();
  });

  it("leaves a resource with no registered loader untouched", async () => {
    const { getResourceEntities } = setup();
    const resource = row({ resourceName: "settings" });

    await expect(getResourceEntities(resource as any)).resolves.toBe(true);
    expect(resource.entities).toEqual([]);
    expect(resource.is_loading).toBe(false);
  });

  it("does not reload a resource that already has entities", async () => {
    const { getResourceEntities } = setup();
    const resource = row({ resourceName: "pipeline", entities: [{ name: "p1" }] });

    await expect(getResourceEntities(resource as any)).resolves.toBe(true);

    expect(pipelineService.getPipelines).not.toHaveBeenCalled();
    expect(resource.entities.length).toBe(1);
  });

  it("calls the service once when the same resource is opened twice concurrently", async () => {
    const { getResourceEntities } = setup();
    const resource = row({ name: "f9", resourceName: "report", childName: "report" });

    const a = getResourceEntities(resource as any);
    const b = getResourceEntities(resource as any);
    await Promise.all([a, b]);

    expect(reportService.listByFolderId).toHaveBeenCalledTimes(1);
    expect(resource.entities.length).toBe(1);
  });

  it("retries after a rejected load", async () => {
    const { getResourceEntities } = setup();
    const resource = row({ name: "f9", resourceName: "report", childName: "report" });
    vi.mocked(reportService.listByFolderId).mockRejectedValueOnce(new Error("boom"));

    await expect(getResourceEntities(resource as any)).rejects.toThrow("boom");
    expect(resource.is_loading).toBe(false);

    await getResourceEntities(resource as any);
    expect(reportService.listByFolderId).toHaveBeenCalledTimes(2);
    expect(resource.entities.length).toBe(1);
  });

  // The in-flight map is keyed by the row object, so rows that share a name still load separately.
  it("loads two different resources that share a name", async () => {
    const { getResourceEntities, updateResourceEntities } = setup();
    const dfolder = row({ name: "clash", resourceName: "dfolder" });
    const afolder = row({ name: "clash", resourceName: "afolder" });

    await Promise.all([getResourceEntities(dfolder as any), getResourceEntities(afolder as any)]);

    expect(dashboardService.list_Folders).toHaveBeenCalledTimes(1);
    expect(commonService.list_Folders).toHaveBeenCalledTimes(1);
    const afolderCall = updateResourceEntities.mock.calls.find((call) => call[0] === "afolder");
    expect(afolderCall?.[2].length).toBeGreaterThan(0);
  });
});

describe("useRoleEntityLoaders - stream loaders", () => {
  it("getStreamsTypes builds four type rows without a service call", async () => {
    const { getStreamsTypes, updateResourceResource } = setup();
    getStreamsMock.mockClear();

    await getStreamsTypes();

    expect(getStreamsMock).not.toHaveBeenCalled();
    expect(updateResourceResource.mock.calls.map((call) => call[0])).toEqual([
      "logs",
      "traces",
      "metrics",
      "index",
    ]);
    expect(updateResourceResource.mock.calls[0]).toEqual([
      "logs",
      "stream",
      ["stream_type"],
      [{ stream_type: "logs", name: "common.logs" }],
      true,
      "name",
    ]);
    expect(updateResourceResource.mock.calls[3][3]).toEqual([
      { stream_type: "index", name: "iam.indices" },
    ]);
  });

  it("getLogs lists logs streams onto the type row", async () => {
    const { getLogs, updateEntityEntities } = setup();
    const logsNode = row({ name: "logs", resourceName: "logs", childName: "logs" });

    await getLogs(logsNode as any);

    expect(getStreamsMock).toHaveBeenCalledWith("logs", false);
    expect(updateEntityEntities).toHaveBeenCalledWith(
      logsNode,
      ["name"],
      [{ name: "app" }, { name: "sys" }],
    );
  });

  it("getMetrics, getTraces and getIndexStreams each ask for their own stream type", async () => {
    const { getMetrics, getTraces, getIndexStreams, updateEntityEntities } = setup();
    getStreamsMock.mockClear();

    const metrics = row({ name: "metrics", childName: "metrics" });
    const traces = row({ name: "traces", childName: "traces" });
    const index = row({ name: "index", childName: "index" });

    await getMetrics(metrics as any);
    await getTraces(traces as any);
    await getIndexStreams(index as any);

    expect(getStreamsMock.mock.calls).toEqual([
      ["metrics", false],
      ["traces", false],
      ["index", false],
    ]);
    expect(updateEntityEntities.mock.calls.map((call) => call[2])).toEqual([
      [{ name: "cpu" }],
      [{ name: "svc-a" }],
      [{ name: "users" }],
    ]);
  });

  it("getMetadataStreams and getEnrichmentTables push onto their own resource", async () => {
    const { getMetadataStreams, getEnrichmentTables, updateResourceEntities } = setup();

    await getMetadataStreams();
    await getEnrichmentTables();

    expect(getStreamsMock).toHaveBeenCalledWith("metadata", false);
    expect(getStreamsMock).toHaveBeenCalledWith("enrichment_tables", false);
    expect(updateResourceEntities.mock.calls).toEqual([
      ["metadata", ["name"], [{ name: "meta" }]],
      ["enrichment_table", ["name"], [{ name: "geo" }]],
    ]);
  });

  it("logs_pattern, logs_insights and logs_cache all list logs streams", async () => {
    const {
      getLogsPatternStreams,
      getLogsInsightsStreams,
      getLogsCacheStreams,
      updateResourceEntities,
    } = setup();

    await getLogsPatternStreams();
    await getLogsInsightsStreams();
    await getLogsCacheStreams();

    expect(getStreamsMock).toHaveBeenCalledWith("logs", false);
    expect(updateResourceEntities.mock.calls).toEqual([
      ["logs_pattern", ["name"], [{ name: "app" }, { name: "sys" }]],
      ["logs_insights", ["name"], [{ name: "app" }, { name: "sys" }]],
      ["logs_cache", ["name"], [{ name: "app" }, { name: "sys" }]],
    ]);
  });
});

describe("useRoleEntityLoaders - folder loaders", () => {
  it("getFolders lists dashboard folders and prepends a default folder", async () => {
    const { getFolders, updateResourceEntities } = setup();

    await getFolders();

    expect(dashboardService.list_Folders).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities).toHaveBeenCalledWith(
      "dfolder",
      ["folderId"],
      [
        { folderId: "default", name: "default" },
        { folderId: "f1", name: "F1" },
      ],
      true,
      "name",
      "dashboard",
    );
  });

  it("getFolders does not prepend when the service already returns default", async () => {
    const { getFolders, updateResourceEntities } = setup();
    vi.mocked(dashboardService.list_Folders).mockResolvedValueOnce({
      data: { list: [{ folderId: "default", name: "Default" }] },
    } as any);

    await getFolders();

    expect(updateResourceEntities.mock.calls[0][2]).toEqual([
      { folderId: "default", name: "Default" },
    ]);
  });

  it("getAlertFolders, getReportFolders, getSyntheticsFolders and getWorkflowFolders differ only by folder type", async () => {
    const {
      getAlertFolders,
      getReportFolders,
      getSyntheticsFolders,
      getWorkflowFolders,
      updateResourceEntities,
    } = setup();

    await getAlertFolders();
    await getReportFolders();
    await getSyntheticsFolders();
    await getWorkflowFolders();

    expect(vi.mocked(commonService.list_Folders).mock.calls).toEqual([
      [ORG, "alerts"],
      [ORG, "reports"],
      [ORG, "synthetics"],
      [ORG, "workflows"],
    ]);
    expect(
      updateResourceEntities.mock.calls.map((call) => [call[0], call[3], call[4], call[5]]),
    ).toEqual([
      ["afolder", true, "name", "alert"],
      ["rfolder", true, "name", "report"],
      ["synthetic_folder", true, "name", "synthetics"],
      ["workflow_folder", true, "name", "workflows"],
    ]);
    expect(updateResourceEntities.mock.calls[0][2]).toEqual([
      { folderId: "default", name: "default" },
      { folderId: "f9", name: "F9" },
    ]);
  });
});

describe("useRoleEntityLoaders - folder children", () => {
  // BUG pinned, not fixed: getDashboards flattens each dashboard to its first
  // truthy value before building rows, so the rows are plain strings — the
  // `folder/dashboardId` naming and the "title" display name never apply.
  it("getDashboards asks for one folder's dashboards and hands over flattened ids", async () => {
    const { getDashboards, updateEntityEntities } = setup();
    const folder = row({ name: "f1", childName: "dashboard" });

    await getDashboards(folder as any);

    expect(dashboardService.list).toHaveBeenCalledWith(0, 10000, "name", false, "", ORG, "f1", "");
    expect(updateEntityEntities).toHaveBeenCalledWith(
      folder,
      ["dashboardId"],
      ["d1"],
      false,
      "title",
    );
  });

  // BUG pinned, not fixed: the loader keys alert rows off `alertId` but the row
  // builder reads `alert_id`, so every alert row's name ends in "/undefined".
  it("getAlerts asks for one folder's alerts and keys rows off alertId", async () => {
    const { getAlerts, updateEntityEntities } = setup();
    const folder = row({ name: "f9", childName: "alert" });

    await getAlerts(folder as any);

    expect(alertService.listByFolderId).toHaveBeenCalledWith(
      0,
      10000,
      "name",
      false,
      "",
      ORG,
      "f9",
      "",
    );
    expect(updateEntityEntities).toHaveBeenCalledWith(
      folder,
      ["alertId"],
      [{ alertId: "a1", name: "A1" }],
      false,
      "name",
    );
  });

  it("getReports keys rows off report_id", async () => {
    const { getReports, updateEntityEntities } = setup();
    const folder = row({ name: "f9", childName: "report" });

    await getReports(folder as any);

    expect(reportService.listByFolderId).toHaveBeenCalledWith(ORG, "f9");
    expect(updateEntityEntities).toHaveBeenCalledWith(
      folder,
      ["report_id"],
      [{ report_id: "rep1", name: "Rep1" }],
      false,
      "name",
    );
  });

  it("getReports falls back to a bare array response", async () => {
    const { getReports, updateEntityEntities } = setup();
    vi.mocked(reportService.listByFolderId).mockResolvedValueOnce({
      data: [{ report_id: "rep2", name: "Rep2" }],
    } as any);
    const folder = row({ name: "f9", childName: "report" });

    await getReports(folder as any);

    expect(updateEntityEntities.mock.calls[0][2]).toEqual([{ report_id: "rep2", name: "Rep2" }]);
  });

  it("getSynthetics names rows by plain monitor id, reading checks first", async () => {
    const { getSynthetics, updateEntityEntities } = setup();
    const folder = row({ name: "f9", childName: "synthetics" });

    await getSynthetics(folder as any);

    expect(syntheticsService.listByFolderId).toHaveBeenCalledWith(ORG, "f9");
    expect(updateEntityEntities).toHaveBeenCalledWith(
      folder,
      ["id"],
      [{ id: "s1", name: "S1" }],
      false,
      "name",
    );
  });

  it("getSynthetics falls back to the legacy monitors key", async () => {
    const { getSynthetics, updateEntityEntities } = setup();
    vi.mocked(syntheticsService.listByFolderId).mockResolvedValueOnce({
      data: { monitors: [{ id: "s2", name: "S2" }] },
    } as any);
    const folder = row({ name: "f9", childName: "synthetics" });

    await getSynthetics(folder as any);

    expect(updateEntityEntities.mock.calls[0][2]).toEqual([{ id: "s2", name: "S2" }]);
  });

  it("getWorkflows accepts both an array and a list-wrapped response", async () => {
    const { getWorkflows, updateEntityEntities } = setup();
    const first = row({ name: "f9", childName: "workflows" });

    await getWorkflows(first as any);

    expect(workflowService.listWorkflows).toHaveBeenCalledWith(ORG, "f9");
    expect(updateEntityEntities).toHaveBeenCalledWith(
      first,
      ["id"],
      [{ id: "w1", name: "W1" }],
      false,
      "name",
    );

    const second = row({ name: "default", childName: "workflows" });
    vi.mocked(workflowService.listWorkflows).mockResolvedValueOnce({
      data: { list: [{ id: "w2", name: "W2" }] },
    } as any);
    await getWorkflows(second as any);

    expect(updateEntityEntities.mock.calls[1][2]).toEqual([{ id: "w2", name: "W2" }]);
  });
});

describe("useRoleEntityLoaders - flat resource loaders", () => {
  it("getFunctions lists functions by name", async () => {
    const { getFunctions, updateResourceEntities } = setup();

    await getFunctions();

    expect(jsTransformService.list).toHaveBeenCalledWith(1, 100000, "name", false, "", ORG);
    expect(updateResourceEntities).toHaveBeenCalledWith("function", ["name"], [{ name: "f1" }]);
  });

  it("getPipelines names rows by pipeline_id and labels them by name", async () => {
    const { getPipelines, updateResourceEntities } = setup();

    await getPipelines();

    expect(pipelineService.getPipelines).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities).toHaveBeenCalledWith(
      "pipeline",
      ["pipeline_id"],
      [{ pipeline_id: "p1", name: "P1" }],
      false,
      "name",
    );
  });

  it("getDestinations and getTemplates go through the query cache", async () => {
    const { getDestinations, getTemplates, updateResourceEntities } = setup();

    await getDestinations();
    await getTemplates();

    expect(destinationService.list).toHaveBeenCalledWith({
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      org_identifier: ORG,
      module: undefined,
    });
    expect(templateService.list).toHaveBeenCalledWith({ org_identifier: ORG });
    expect(updateResourceEntities.mock.calls).toEqual([
      ["destination", ["name"], [{ name: "dest1" }]],
      ["template", ["name"], [{ name: "t1" }]],
    ]);
  });

  it("getSavedViews names rows by view_id and labels them by view_name", async () => {
    const { getSavedViews, updateResourceEntities } = setup();

    await getSavedViews();

    expect(savedviewsService.get).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities).toHaveBeenCalledWith(
      "savedviews",
      ["view_id"],
      [{ view_id: "v1", view_name: "V1" }],
      false,
      "view_name",
    );
  });

  it("getOrgs lists every org, ignoring the selected one", async () => {
    const { getOrgs, updateResourceEntities } = setup();

    await getOrgs();

    expect(organizationsService.list).toHaveBeenCalledWith(0, 100000, "name", false, "");
    expect(updateResourceEntities).toHaveBeenCalledWith(
      "org",
      ["identifier"],
      [{ identifier: "org1" }],
    );
  });

  it("getServiceAccounts names rows by email", async () => {
    const { getServiceAccounts, updateResourceEntities } = setup();

    await getServiceAccounts();

    expect(serviceAccountService.list).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities).toHaveBeenCalledWith(
      "service_accounts",
      ["email"],
      ["svc1@example.com"],
    );
  });

  it("getCipherKeys reads data.keys and getRePatterns reads data.patterns", async () => {
    const { getCipherKeys, getRePatterns, updateResourceEntities } = setup();

    await getCipherKeys();
    await getRePatterns();

    expect(cipherKeysService.list).toHaveBeenCalledWith(ORG);
    expect(RePatternsService.list).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities.mock.calls).toEqual([
      ["cipher_keys", ["name"], [{ name: "key1" }]],
      ["re_patterns", ["id"], [{ id: "re1", name: "Re1" }], false, "name"],
    ]);
  });

  it("getProviders and getEvalJobs name rows by id", async () => {
    const { getProviders, getEvalJobs, updateResourceEntities } = setup();

    await getProviders();
    await getEvalJobs();

    expect(onlineEvalsService.providers.list).toHaveBeenCalledWith(ORG);
    expect(onlineEvalsService.jobs.list).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities.mock.calls).toEqual([
      ["provider", ["id"], [{ id: "openai", name: "OpenAI" }], false, "name"],
      ["eval_job", ["id"], [{ id: "daily-eval", name: "Daily Eval" }], false, "name"],
    ]);
  });

  it("getScoreConfigs and getScorers fall back across entityId, entity_id and id", async () => {
    const { getScoreConfigs, getScorers, updateResourceEntities } = setup();

    await getScoreConfigs();
    await getScorers();

    expect(onlineEvalsService.scoreConfigs.list).toHaveBeenCalledWith(ORG);
    expect(onlineEvalsService.scorers.list).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities.mock.calls).toEqual([
      [
        "score_config",
        ["entityId"],
        [{ entity_id: "quality-score", entityId: "quality-score", name: "Quality Score" }],
        false,
        "name",
      ],
      ["scorer", ["entityId"], [{ entityId: "llm-judge", name: "LLM Judge" }], false, "name"],
    ]);
  });

  it("getAnnotationQueues and getDatasets call the LLM services with the org id", async () => {
    const { getAnnotationQueues, getDatasets, updateResourceEntities } = setup();

    await getAnnotationQueues();
    await getDatasets();

    expect(llmQueuesService.list).toHaveBeenCalledWith(ORG);
    expect(llmDatasetsService.list).toHaveBeenCalledWith(ORG);
    expect(updateResourceEntities.mock.calls).toEqual([
      ["annotation_queue", ["id"], [{ id: "review-queue", name: "Review Queue" }], false, "name"],
      ["dataset", ["id"], [{ id: "golden-set", name: "Golden Set" }], false, "name"],
    ]);
  });
});
