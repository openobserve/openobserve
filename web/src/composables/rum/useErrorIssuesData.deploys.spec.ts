import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { AxiosError, AxiosHeaders } from "axios";
import golden from "@/test/unit/fixtures/serviceVersions/stage5.json";
import { FULL_SCHEMA, MOCK_ISSUE_HITS } from "@/test/unit/mockData/errorIssues";
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  deploys: vi.fn(),
  config: { isEnterprise: "true", isCloud: "false" },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/aws-exports", () => ({ default: mocks.config }));
vi.mock("@/utils/chartTheme", () => ({ chartColor: (token: string) => token }));
vi.mock("@/services/search", async (original) => {
  const actual = await original<{ default: object }>();
  return { ...actual, default: { ...actual.default, search: mocks.search } };
});
vi.mock("@/services/service_versions", async (original) => {
  const actual = await original<{ default: object }>();
  return { ...actual, default: { ...actual.default, deploys: mocks.deploys } };
});
vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org" },
      timezone: "UTC",
      zoConfig: { timestamp_column: "_timestamp", sql_base64_enabled: false },
    },
  }),
}));
import useErrorIssuesData from "./useErrorIssuesData";
const deploys = golden.deploys.deploys;
const at = deploys[0].at;
const params = (service: string) => ({
  startTime: at - 3_600_000_000,
  endTime: at + 3_600_000_000,
  schema: FULL_SCHEMA,
  userQuery: "",
  service,
});
const t = ((key: string, values?: Record<string, unknown>) =>
  values?.version ? `${key}:${values.version}` : key) as never;
const sqlDeployCalls = () =>
  mocks.search.mock.calls.filter((call) => JSON.stringify(call).includes("SELECT version, MIN("));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.isEnterprise = "true";
  mocks.search.mockImplementation(async (request: unknown) => {
    const text = JSON.stringify(request);
    if (text.includes("SELECT version, MIN("))
      return { data: { hits: [{ version: "sql-1", first_seen: at + 60_000_000 }] } };
    if (text.includes("prior_events")) return { data: { hits: [{ prior_events: 0 }] } };
    return { data: { hits: MOCK_ISSUE_HITS } };
  });
  mocks.deploys.mockResolvedValue({ data: { deploys } });
});
it("reads the registry deploys and never runs the first-seen SQL on the versioned build", async () => {
  const data = useErrorIssuesData(t);
  await data.fetchAll(params("store"));
  await flushPromises();
  expect(mocks.deploys).toHaveBeenCalledWith(
    "org",
    { service: "store", start_time: at - 3_600_000_000, end_time: at + 3_600_000_000 },
    expect.anything(),
  );
  expect(sqlDeployCalls()).toEqual([]);
  expect(data.deployMarkerList.value.map((m) => [m.version, m.deployKey])).toEqual([
    ["2.0", deploys[0].deploy_key],
    ["3.0", deploys[1].deploy_key],
  ]);
  expect(data.latestDeploy.value).toEqual({ version: "2.0", firstSeen: at });
});
it("falls back to the first-seen SQL with grey markers when the registry answers 503", async () => {
  const response = {
    status: 503,
    data: {},
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  mocks.deploys.mockRejectedValue(new AxiosError("down", "503", undefined, undefined, response));
  const data = useErrorIssuesData(t);
  await data.fetchAll(params("store"));
  await flushPromises();
  expect(sqlDeployCalls()).toHaveLength(1);
  expect(data.deployMarkerList.value).toHaveLength(1);
  expect(data.deployMarkerList.value[0]).toMatchObject({ version: "sql-1", unavailable: true });
  expect(data.deployMarkerList.value[0].deployKey).toBeUndefined();
});
it("keeps the first-seen SQL as the only producer in the open-source build and without a service", async () => {
  mocks.config.isEnterprise = "false";
  const oss = useErrorIssuesData(t);
  await oss.fetchAll(params("store"));
  await flushPromises();
  mocks.config.isEnterprise = "true";
  const unscoped = useErrorIssuesData(t);
  await unscoped.fetchAll(params(""));
  await flushPromises();
  expect(mocks.deploys).not.toHaveBeenCalled();
  expect(sqlDeployCalls()).toHaveLength(2);
  for (const data of [oss, unscoped]) {
    expect(data.deployMarkerList.value).toHaveLength(1);
    expect(data.deployMarkerList.value[0]).toMatchObject({
      version: "sql-1",
      label: { formatter: "rum.deployMarker:sql-1" },
    });
    expect(data.deployMarkerList.value[0].unavailable).toBeFalsy();
  }
});
