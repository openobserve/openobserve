import { describe, it, expect, vi, beforeEach } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import service from "./service_versions";
import { serviceVersionKeys } from "./service_versions.querykeys";
import {
  versionsQuery,
  compareQuery,
  servicesQuery,
  putOverrideMutation,
  deleteOverrideMutation,
  aliasesQuery,
  createAliasMutation,
  updateAliasMutation,
  deleteAliasMutation,
  bulkAliasesMutation,
  undoAliasesMutation,
} from "./service_versions.queries";
import { serviceStreamKeys } from "./service_streams.querykeys";
import stage8 from "@/test/unit/fixtures/serviceVersions/stage8.json";
import { goldenRumVitals } from "./service_versions.fixtures";
import type { RumSection } from "./service_versions";
const transport = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("./http", () => ({ default: () => transport }));
beforeEach(() => vi.clearAllMocks());
describe("service version transport", () => {
  it("encodes identity path segments and keeps list filters", () => {
    service.versions("org/a", { service: "checkout", where: "k8s:a/b", include_inactive: true });
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org%2Fa/service_versions",
      expect.objectContaining({
        params: { service: "checkout", where: "k8s:a/b", include_inactive: true },
      }),
    );
  });
  it("uses version keys for verdict reads", () => {
    service.verdicts("org", { keys: "vk1,vk2" });
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org/service_versions/verdicts",
      expect.objectContaining({ params: { keys: "vk1,vk2" } }),
    );
  });
  it("uses the absolute v2 incident endpoint", () => {
    service.openIncident("org", {
      title: "Regression",
      severity: "P2",
      service: "checkout",
      where_key: "env:prod",
      env: "prod",
      version: "v2",
      baseline_version: "v1",
      verdict_key: "verdict",
      summary: "Regression",
      link: "http://localhost/web/traces",
    });
    expect(transport.post.mock.calls[0][0]).toBe("/api/v2/org/alerts/incidents");
  });
});
describe("reader isolation", () => {
  it("separates org users filters and exact transitions", () => {
    const body = {
      service: "checkout",
      where: "env:prod",
      a: { version: "v2", deploy_key: "d1" },
      signals: ["traces"] as ["traces"],
    };
    expect(serviceVersionKeys.compare("a", "owner", body)).not.toEqual(
      serviceVersionKeys.compare("b", "owner", body),
    );
    expect(serviceVersionKeys.compare("a", "owner", body)).not.toEqual(
      serviceVersionKeys.compare("a", "reader", body),
    );
    expect(serviceVersionKeys.compare("a", "owner", body)).not.toEqual(
      serviceVersionKeys.compare("a", "owner", { ...body, a: { ...body.a, deploy_key: "d2" } }),
    );
  });
  it("caches an identical reader but never shares across orgs", async () => {
    const client = new QueryClient();
    transport.get.mockResolvedValue({
      data: { service: "checkout", versions: [], total: 0, aliases_applied: [] },
    });
    await client.fetchQuery(versionsQuery("org", "user", { service: "checkout" }));
    await client.fetchQuery(versionsQuery("org", "user", { service: "checkout" }));
    expect(transport.get).toHaveBeenCalledTimes(1);
    await client.fetchQuery(versionsQuery("other", "user", { service: "checkout" }));
    expect(transport.get).toHaveBeenCalledTimes(2);
    client.clear();
  });
  it("keeps signal omissions and bounds in compare keys", () => {
    const body = {
      service: "checkout",
      where: "env:prod",
      a: { version: "v2", start_time: 1, end_time: 2 },
      signals: ["rum"] as ["rum"],
    };
    expect(compareQuery("org", "user", body).queryKey).not.toEqual(
      compareQuery("org", "user", { ...body, signals: ["traces"] }).queryKey,
    );
    expect(compareQuery("org", "user", body).queryKey).not.toEqual(
      compareQuery("org", "user", { ...body, a: { ...body.a, end_time: 3 } }).queryKey,
    );
  });
});

describe("catalog pagination", () => {
  const rows = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ scope_key: String(start + i) }));
  it("reads all pages and merges counts without multiplying totals", async () => {
    transport.get
      .mockResolvedValueOnce({
        data: { services: rows(0, 100), envs: [], verdict_counts: { ok: 100 } },
      })
      .mockResolvedValueOnce({
        data: { services: rows(100, 1), envs: [], verdict_counts: { watch: 1 } },
      });
    const client = new QueryClient();
    const result = await client.fetchQuery(servicesQuery("org", "reader"));
    expect(result.services).toHaveLength(101);
    expect(result.verdict_counts).toEqual({ ok: 100, watch: 1 });
    expect(transport.get.mock.calls[1][1].params.offset).toBe(100);
    client.clear();
  });
  it("reads the empty final page at an exact boundary", async () => {
    transport.get
      .mockResolvedValueOnce({ data: { services: rows(0, 100), envs: [] } })
      .mockResolvedValueOnce({ data: { services: [], envs: [] } });
    const client = new QueryClient();
    expect((await client.fetchQuery(servicesQuery("org", "reader"))).services).toHaveLength(100);
    expect(transport.get).toHaveBeenCalledTimes(2);
    client.clear();
  });
  it("fails rather than returning an incomplete catalog on a later-page error", async () => {
    transport.get
      .mockResolvedValueOnce({ data: { services: rows(0, 100), envs: [] } })
      .mockRejectedValue(new Error("offline"));
    const options = servicesQuery("org", "reader");
    const client = new QueryClient();
    await expect(client.fetchQuery({ ...options, retry: false })).rejects.toThrow("offline");
    client.clear();
  });
  it("drops all verdicts if any page loses verdict enrichment", async () => {
    transport.get
      .mockResolvedValueOnce({
        data: {
          services: rows(0, 100).map((row) => ({ ...row, newest_verdict: { verdict: "ok" } })),
          envs: [],
          verdict_counts: { ok: 100 },
        },
      })
      .mockResolvedValueOnce({
        data: { services: rows(100, 1), envs: [], verdict_status: "unavailable" },
      });
    const client = new QueryClient();
    const result = await client.fetchQuery(servicesQuery("org", "reader"));
    expect(result.verdict_status).toBe("unavailable");
    expect(result.verdict_counts).toBeUndefined();
    expect(result.services.every((row) => !row.newest_verdict)).toBe(true);
    client.clear();
  });
});

describe("identity compatibility inventory", () => {
  it("reads typed override/env/unresolved envelopes with cancellation and encoded org", async () => {
    const signal = new AbortController().signal;
    transport.get.mockResolvedValue({ data: { overrides: [], total: 0 } });
    await service.identityOverrides("org /", { scope: "service", q: "cart", offset: 20 }, signal);
    expect(transport.get).toHaveBeenLastCalledWith(
      "/api/org%20%2F/service_identity/overrides",
      expect.objectContaining({ params: { scope: "service", q: "cart", offset: 20 }, signal }),
    );
    await service.identityEnvs("org /", { service: "cart", where: "k8s:/web" }, signal);
    expect(transport.get).toHaveBeenLastCalledWith(
      "/api/org%20%2F/service_identity/envs",
      expect.objectContaining({ params: { service: "cart", where: "k8s:/web" }, signal }),
    );
    await service.identityUnresolved("org /", { limit: 20 }, signal);
    expect(transport.get).toHaveBeenLastCalledWith(
      "/api/org%20%2F/service_identity/unresolved",
      expect.objectContaining({ params: { limit: 20 }, signal }),
    );
    expect(transport.put).not.toHaveBeenCalled();
  });
  it("preserves transport denials and failures", async () => {
    const denied = { response: { status: 403 } };
    for (const read of [
      service.identityOverrides,
      service.identityEnvs,
      service.identityUnresolved,
    ]) {
      transport.get.mockRejectedValueOnce(denied);
      await expect(read("org")).rejects.toBe(denied);
    }
  });
});

describe("complete version history", () => {
  it("reads later pages even when the server caps the requested page size", async () => {
    transport.get
      .mockResolvedValueOnce({ data: { versions: [{ version_key: "a" }], total: 2 } })
      .mockResolvedValueOnce({ data: { versions: [{ version_key: "b" }], total: 2 } });
    const result = await new QueryClient().fetchQuery(
      versionsQuery("org", "reader", { service: "cart", limit: 10000 }),
    );
    expect(result.versions).toHaveLength(2);
    expect(transport.get.mock.calls[1][1].params.offset).toBe(1);
  });
  it("rejects duplicate pages and incomplete history", async () => {
    for (const versions of [[{ version_key: "a" }], []]) {
      transport.get
        .mockResolvedValueOnce({ data: { versions: [{ version_key: "a" }], total: 2 } })
        .mockResolvedValueOnce({ data: { versions, total: 2 } });
      await expect(
        new QueryClient().fetchQuery({
          ...versionsQuery("org", "reader", { service: "cart", limit: 10000 }),
          retry: false,
        }),
      ).rejects.toThrow();
    }
  });
});

describe("env override writes", () => {
  const body = {
    scope: "service" as const,
    where_key: "k8s:c1/shop",
    k8s_cluster: "c1",
    service_name: "cart",
    value: "prod",
  };
  it("PUTs the override body and DELETEs by encoded rule key", async () => {
    transport.put.mockResolvedValue({
      data: {
        override: null,
        previous: null,
        removed: false,
        affected: { services: 1, versions: 2 },
      },
    });
    await service.putIdentityOverride("org /", body);
    expect(transport.put).toHaveBeenCalledWith(
      "/api/org%20%2F/service_identity/overrides",
      body,
      expect.objectContaining({ skipAccessToast: true }),
    );
    await service.deleteIdentityOverride("org", "rule/1 a");
    expect(transport.delete).toHaveBeenCalledWith(
      "/api/org/service_identity/overrides/rule%2F1%20a",
      expect.objectContaining({ skipAccessToast: true }),
    );
  });
  it("passes the catalog signal and service filters through", () => {
    service.services("org", { signal: "rum", service: "storefront" });
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org/service_versions/_services",
      expect.objectContaining({ params: { signal: "rum", service: "storefront" } }),
    );
    expect(servicesQuery("org", "u", { signal: "rum" }).queryKey).not.toEqual(
      servicesQuery("org", "u", { signal: "traces" }).queryKey,
    );
  });
  it("invalidates every service-version read after a write and never retries", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    transport.put.mockResolvedValueOnce({ data: { removed: true } });
    transport.delete.mockResolvedValueOnce({ data: { removed: { rule_key: "r" } } });
    const put = new MutationObserver(queryClient, putOverrideMutation("org"));
    expect(await put.mutate(body)).toEqual({ removed: true });
    const del = new MutationObserver(queryClient, deleteOverrideMutation("org"));
    expect(await del.mutate("r")).toEqual({ removed: { rule_key: "r" } });
    expect(invalidate).toHaveBeenCalledTimes(2);
    for (const call of invalidate.mock.calls)
      expect(call[0]).toEqual({ queryKey: serviceVersionKeys.all("org") });
    const denied = { isAxiosError: true, response: { status: 403 } };
    transport.put.mockRejectedValueOnce(denied);
    await expect(put.mutate(body)).rejects.toBe(denied);
    expect(transport.put).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    invalidate.mockRestore();
  });
});
describe("alias transport", () => {
  it("lists aliases with the filter params and encodes the alias key on writes", async () => {
    service.aliases("org /", { status: "proposed", confidence: "high", limit: 1 });
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org%20%2F/service_identity/aliases",
      expect.objectContaining({
        params: { status: "proposed", confidence: "high", limit: 1 },
        skipAccessToast: true,
      }),
    );
    service.createAlias("org", { kind: "rename", scope: "", alias: "nats", canonical: "NATS" });
    expect(transport.post).toHaveBeenCalledWith(
      "/api/org/service_identity/aliases",
      { kind: "rename", scope: "", alias: "nats", canonical: "NATS" },
      expect.objectContaining({ skipAccessToast: true }),
    );
    service.updateAlias("org", "a/b c", { status: "active", allow_collisions: true });
    expect(transport.put).toHaveBeenCalledWith(
      "/api/org/service_identity/aliases/a%2Fb%20c",
      { status: "active", allow_collisions: true },
      expect.anything(),
    );
    service.deleteAlias("org", "a/b");
    expect(transport.delete).toHaveBeenCalledWith(
      "/api/org/service_identity/aliases/a%2Fb",
      expect.anything(),
    );
    const bulk = {
      action: "accept" as const,
      alias_keys: null,
      filter: { status: "proposed" as const, confidence: "high" as const },
      allow_collisions: false,
    };
    service.bulkAliases("org", bulk);
    expect(transport.post).toHaveBeenLastCalledWith(
      "/api/org/service_identity/aliases/_bulk",
      bulk,
      expect.anything(),
    );
    service.undoAliases("org", "batch1");
    expect(transport.post).toHaveBeenLastCalledWith(
      "/api/org/service_identity/aliases/_undo",
      { batch_id: "batch1" },
      expect.anything(),
    );
  });
  it("keys alias lists by org, reader and filter", () => {
    const pending = aliasesQuery("org", "u", { status: "proposed" }).queryKey;
    expect(pending).not.toEqual(aliasesQuery("org", "u", { status: "accepted" }).queryKey);
    expect(pending).not.toEqual(aliasesQuery("org", "v", { status: "proposed" }).queryKey);
    expect(pending).not.toEqual(aliasesQuery("o2", "u", { status: "proposed" }).queryKey);
    expect(pending.slice(0, serviceVersionKeys.all("org").length)).toEqual(
      serviceVersionKeys.all("org"),
    );
  });
  it("does not retry an alias read that was denied", () => {
    const retry = aliasesQuery("org", "u").retry as (count: number, error: unknown) => boolean;
    expect(retry(0, { isAxiosError: true, response: { status: 403 } })).toBe(false);
    expect(retry(0, { isAxiosError: true, response: { status: 500 } })).toBe(true);
  });
  it("invalidates service versions and the service list after every alias write, never retrying", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    transport.post.mockResolvedValue({ data: stage8.create_201 });
    transport.put.mockResolvedValue({ data: stage8.accept_one });
    transport.delete.mockResolvedValue({ data: {} });
    await new MutationObserver(queryClient, createAliasMutation("org")).mutate({
      kind: "rename",
      scope: "",
      alias: "nats",
      canonical: "NATS",
    });
    await new MutationObserver(queryClient, updateAliasMutation("org")).mutate({
      aliasKey: "k",
      body: { status: "rejected" },
    });
    await new MutationObserver(queryClient, deleteAliasMutation("org")).mutate("k");
    await new MutationObserver(queryClient, bulkAliasesMutation("org")).mutate({
      action: "accept",
      alias_keys: ["k"],
      filter: null,
      allow_collisions: false,
    });
    await new MutationObserver(queryClient, undoAliasesMutation("org")).mutate("b");
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(
      keys.filter((key) => JSON.stringify(key) === JSON.stringify(serviceVersionKeys.all("org"))),
    ).toHaveLength(5);
    expect(
      keys.filter(
        (key) => JSON.stringify(key) === JSON.stringify(serviceStreamKeys.servicesList("org")),
      ),
    ).toHaveLength(5);
    const conflict = { isAxiosError: true, response: { status: 409, data: stage8.collision_409 } };
    transport.put.mockRejectedValueOnce(conflict);
    const update = new MutationObserver(queryClient, updateAliasMutation("org"));
    await expect(update.mutate({ aliasKey: "k", body: { status: "active" } })).rejects.toBe(
      conflict,
    );
    expect(transport.put).toHaveBeenCalledTimes(2);
    invalidate.mockRestore();
  });
});
describe("RUM vitals shape", () => {
  it("reads the delta flat beside the bands, as the producer sends it", () => {
    const rum: RumSection = { status: "ok", reason: null, ...goldenRumVitals };
    expect(rum.inp_p75?.delta).toBeCloseTo(34.87, 2);
    expect(rum.inp_p75?.lo).toBeCloseTo(30.99, 2);
    expect(rum.inp_p75?.band_crossed).toBe(true);
    expect(rum.cls_p75?.band_b).toBe("needs_improvement");
    expect(typeof rum.lcp_p75?.delta).toBe("number");
  });
});
