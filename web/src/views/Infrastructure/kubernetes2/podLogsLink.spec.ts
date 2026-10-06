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

import { beforeEach, describe, expect, it, vi } from "vitest";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { resolvePodLogs } from "./podLogsLink";

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

const searchMock = vi.mocked(searchService.search);

const SCHEMAS: Record<string, string[]> = {
  default: ["k8s_pod_name", "k8s_namespace_name", "k8s_cluster", "body"],
  logs_default: ["pod_name", "namespace", "cluster", "message"],
  podOnly: ["k8s_pod_name"],
  noCluster: ["k8s_pod_name", "k8s_namespace_name"],
};

const streamsApi = (names: string[], schemas: Record<string, string[]> = SCHEMAS) => ({
  getStreams: vi.fn().mockResolvedValue({ list: names.map((name) => ({ name })) }),
  getStream: vi.fn((name: string) =>
    Promise.resolve({ name, schema: (schemas[name] ?? []).map((field) => ({ name: field })) }),
  ),
});

const target = { cluster: "prod", namespace: "shop", pod: "web-1" };
const ctx = { orgId: "org1", start: 100, end: 200, multiCluster: false };

const hits = (n: number) => ({ data: { hits: [{ n }] } }) as any;

describe("resolvePodLogs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links to the collector's default stream with pod, namespace and cluster terms", async () => {
    const api = streamsApi(["default"]);
    const link = await resolvePodLogs(target, ctx, api);
    expect(link?.route).toEqual({
      path: "/logs",
      query: {
        stream_type: "logs",
        stream: "default",
        from: 100,
        to: 200,
        sql_mode: "false",
        query: b64EncodeUnicode(
          "k8s_pod_name='web-1' AND k8s_namespace_name='shop' AND k8s_cluster='prod'",
        ),
        org_identifier: "org1",
        quick_mode: "false",
      },
    });
    expect(link?.warnNoClusterField).toBe(false);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("uses the generator's flat fields on logs_default", async () => {
    const link = await resolvePodLogs(target, ctx, streamsApi(["logs_default"]));
    expect(link?.route.query.stream).toBe("logs_default");
    expect(link?.route.query.query).toBe(
      b64EncodeUnicode("pod_name='web-1' AND namespace='shop' AND cluster='prod'"),
    );
  });

  it("does not qualify a stream with a pod field but no namespace field", async () => {
    const api = streamsApi(["default"], { default: SCHEMAS.podOnly });
    expect(await resolvePodLogs(target, ctx, api)).toBeNull();
  });

  it("omits the cluster term without a cluster field and warns only across clusters", async () => {
    const api = streamsApi(["default"], { default: SCHEMAS.noCluster });
    const single = await resolvePodLogs(target, ctx, api);
    expect(single?.route.query.query).toBe(
      b64EncodeUnicode("k8s_pod_name='web-1' AND k8s_namespace_name='shop'"),
    );
    expect(single?.warnNoClusterField).toBe(false);
    const multi = await resolvePodLogs(target, { ...ctx, multiCluster: true }, api);
    expect(multi?.warnNoClusterField).toBe(true);
  });

  it("omits the cluster term for a pod with an empty cluster", async () => {
    const link = await resolvePodLogs({ ...target, cluster: "" }, ctx, streamsApi(["default"]));
    expect(link?.route.query.query).toBe(
      b64EncodeUnicode("k8s_pod_name='web-1' AND k8s_namespace_name='shop'"),
    );
  });

  it("escapes single quotes in values", async () => {
    const link = await resolvePodLogs({ ...target, pod: "o'brien" }, ctx, streamsApi(["default"]));
    expect(link?.route.query.query).toBe(
      b64EncodeUnicode(
        "k8s_pod_name='o''brien' AND k8s_namespace_name='shop' AND k8s_cluster='prod'",
      ),
    );
  });

  describe("when both candidates qualify", () => {
    const counted = (defaultHits: number, generatorHits: number) => {
      searchMock.mockImplementation(((req: any) =>
        Promise.resolve(
          hits(req.query.query.sql.includes('"logs_default"') ? generatorHits : defaultHits),
        )) as any);
      return resolvePodLogs(target, ctx, streamsApi(["default", "logs_default", "other"]));
    };

    it("runs exactly one count per stream over the page range", async () => {
      await counted(0, 0);
      expect(searchMock).toHaveBeenCalledTimes(2);
      const sqls = searchMock.mock.calls.map(([req]: any[]) => req.query.query);
      expect(sqls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sql: `SELECT COUNT(*) AS n FROM "default" WHERE k8s_pod_name='web-1' AND k8s_namespace_name='shop' AND k8s_cluster='prod'`,
            start_time: 100,
            end_time: 200,
            from: 0,
            size: 1,
          }),
          expect.objectContaining({
            sql: `SELECT COUNT(*) AS n FROM "logs_default" WHERE pod_name='web-1' AND namespace='shop' AND cluster='prod'`,
          }),
        ]),
      );
      expect(searchMock.mock.calls[0][0]).toMatchObject({
        org_identifier: "org1",
        page_type: "logs",
      });
    });

    it.each([
      [0, 3, "logs_default"],
      [2, 3, "default"],
      [0, 0, "default"],
      [5, 0, "default"],
    ])("default=%i, logs_default=%i picks %s", async (d, g, expected) => {
      expect((await counted(d, g))?.route.query.stream).toBe(expected);
    });
  });

  it("returns null and reads no other stream's schema when nothing qualifies", async () => {
    const api = streamsApi(["app_logs", "default"], { default: [] });
    expect(await resolvePodLogs(target, ctx, api)).toBeNull();
    expect(api.getStream.mock.calls.map(([name]) => name)).toEqual(["default"]);
  });
});
