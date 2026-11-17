import { beforeEach, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import golden from "@/test/unit/fixtures/serviceVersions/stage5.json";
import { queryClient } from "@/composables/query/queryClient";
import { useAnnotations, type DeployMarkerScope } from "./useAnnotations";
import { unavailableDeployServices } from "./deployMarkerScope";
const mocks = vi.hoisted(() => ({ deploys: vi.fn(), manual: vi.fn() }));
vi.mock("@/services/service_versions", async (original) => {
  const actual = await original<{ default: object }>();
  return { ...actual, default: { ...actual.default, deploys: mocks.deploys } };
});
vi.mock("@/services/dashboard_annotations", async (original) => {
  const actual = await original<{ annotationService: object }>();
  return {
    ...actual,
    annotationService: { ...actual.annotationService, get_timed_annotations: mocks.manual },
  };
});
vi.mock("@/utils/chartTheme", () => ({ chartColor: (token: string) => token }));
const deploys = golden.deploys.deploys;
const scope =
  (extra: Partial<DeployMarkerScope> = {}) =>
  () => ({
    service: "store",
    metric: "overall",
    timezone: "UTC",
    user: "u@example.com",
    t: ((key: string) => key) as never,
    ...extra,
  });
function httpError(status: number) {
  const response = {
    status,
    data: {},
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError("failed", String(status), undefined, undefined, response);
}
beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retryDelay: 0 } });
  unavailableDeployServices.clear();
  mocks.deploys.mockResolvedValue({ data: { deploys } });
  mocks.manual.mockResolvedValue({ data: [] });
});
it("draws deploy markers on an inline dashboard that has no dashboard id", async () => {
  const list = await useAnnotations("org", "", "", true, scope()).refreshAnnotations(1, 2);
  expect(mocks.manual).not.toHaveBeenCalled();
  expect(mocks.deploys).toHaveBeenCalledWith(
    "org",
    { service: "store", start_time: 1, end_time: 2 },
    expect.anything(),
  );
  expect(list?.map((row: any) => [row.title, row.start_time, row.deploy_marker.service])).toEqual([
    ["2.0", deploys[0].at, "store"],
    ["3.0", deploys[1].at, "store"],
  ]);
  expect(list?.[0].deploy_marker.lineStyle.color).toContain("error");
  expect(list?.[1].deploy_marker.lineStyle.color).toContain("secondary");
});
it("keeps manual annotations and lets one titled or tagged with a version hide that marker", async () => {
  mocks.manual.mockResolvedValue({
    data: [
      { annotation_id: "m1", title: "2.0", tags: [], start_time: 5 },
      { annotation_id: "m2", title: "release", tags: ["3.0"], start_time: 6 },
      { annotation_id: "m3", title: "unrelated", tags: [], start_time: 7 },
    ],
  });
  const list = await useAnnotations("org", "dash", "panel", true, scope()).refreshAnnotations(1, 2);
  expect(list?.map((row: any) => row.annotation_id)).toEqual(["m1", "m2", "m3"]);
});
it("asks the server for the env variable's deploys and keeps what it returns", async () => {
  // The server matches the env against the scope's whole env set, which a marker does not carry.
  mocks.deploys.mockResolvedValue({
    data: { deploys: deploys.map((row) => ({ ...row, env: "prod" })) },
  });
  const list = await useAnnotations(
    "org",
    "",
    "",
    true,
    scope({ env: "staging" }),
  ).refreshAnnotations(1, 2);
  expect(mocks.deploys).toHaveBeenCalledWith(
    "org",
    { service: "store", env: "staging", start_time: 1, end_time: 2 },
    expect.anything(),
  );
  expect(list).toHaveLength(2);
});
it("flags a 503 as unavailable for the retry chip and clears it on the next success", async () => {
  mocks.deploys.mockRejectedValue(httpError(503));
  const loader = useAnnotations("org", "dash", "panel", true, scope());
  expect(await loader.refreshAnnotations(1, 2)).toEqual([]);
  expect([...unavailableDeployServices]).toEqual(["store"]);
  mocks.deploys.mockResolvedValue({ data: { deploys } });
  queryClient.clear();
  expect(await loader.refreshAnnotations(1, 2)).toHaveLength(2);
  expect(unavailableDeployServices.size).toBe(0);
});
it("treats 403 and a cancelled load as no markers without the retry chip", async () => {
  mocks.deploys.mockRejectedValue(httpError(403));
  await useAnnotations("org", "", "", true, scope()).refreshAnnotations(1, 2);
  queryClient.clear();
  mocks.deploys.mockRejectedValue(Object.assign(new Error("x"), { name: "CanceledError" }));
  await useAnnotations("org", "", "", true, scope()).refreshAnnotations(3, 4);
  expect(unavailableDeployServices.size).toBe(0);
});
