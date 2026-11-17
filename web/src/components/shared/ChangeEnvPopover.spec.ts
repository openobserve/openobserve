// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ServiceEnvChip from "./ServiceEnvChip.vue";
import { envSourceSentence } from "./ChangeEnvPopover.vue";
import { gt } from "@/types/i18n";
import type { Environment, IdentityOverride, OverrideWrite } from "@/services/service_versions";
import { serviceVersionKeys } from "@/services/service_versions.querykeys";
import { envFixtures } from "./ChangeEnvPopover.fixtures";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  post: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/services/http", () => ({ default: () => transport }));
const storeState = vi.hoisted(() => ({
  selectedOrganization: { identifier: "org" },
  userInfo: { email: "admin@example.com" },
  timezone: "UTC",
  zoConfig: { features: {} as Record<string, string> },
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: storeState }),
}));
vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push }),
}));

const {
  identity,
  overrideIdentity,
  serviceIdentity,
  serviceRule,
  clusterRule,
  overrideRow,
  labels,
  scoped,
  created,
  previous,
  golden,
} = envFixtures;
let wrapper: VueWrapper | undefined;
const $ = (test: string) => document.body.querySelector<HTMLElement>(`[data-test="${test}"]`);
const fail = (status: number, error: string) => ({
  isAxiosError: true,
  response: { status, data: { error } },
});

function serveEnvs(can_edit = true, overrides: IdentityOverride[] = []) {
  transport.get.mockImplementation(async (url: string, config: { params: { where?: string } }) => {
    if (url.endsWith("/service_identity/envs"))
      return { data: { ...(config.params.where ? scoped : labels), can_edit } };
    return { data: { overrides, total: overrides.length } };
  });
}
const PARTLY =
  "Couldn't undo the change. The env may be partly changed; the chip shows the server's state.";
interface Fault {
  method: "put" | "delete";
  commit: boolean;
  status: number;
  skip?: number;
  // Another admin's writes that land between this client's snapshot and the failing request.
  meddle?: (server: FakeServer) => void;
  // Another admin's writes that land after this request committed, before the client re-reads.
  late?: (server: FakeServer) => void;
}
interface FakeServer {
  values: () => string[];
  failReads: () => void;
  writeAs: (user: string, row: IdentityOverride) => void;
  drop: (ruleKey: string) => void;
}
const ME = "admin@example.com";
const OTHER = "other@example.com";
const sameFields = (row: IdentityOverride, body: OverrideWrite) =>
  row.scope === body.scope &&
  row.where_key === body.where_key &&
  row.k8s_cluster === body.k8s_cluster &&
  row.service_name === body.service_name;

// A stateful overrides store that stamps each write and whose writes can fail before or after they commit.
function serveStore(rows: IdentityOverride[], faults: Fault[] = []): FakeServer {
  const store = rows.map((row) => ({ ...row }));
  let clock = Math.max(0, ...rows.map((row) => row.updated_at));
  let readFails = false;
  const calls = { put: 0, delete: 0 };
  const known = (body: OverrideWrite) =>
    [previous, serviceRule, clusterRule].find((row) => sameFields(row, body))?.rule_key ??
    "new-rule";
  const writeAs = (user: string, body: IdentityOverride) => {
    clock += 1;
    const index = store.findIndex((row) => sameFields(row, body));
    const row = { ...body, rule_key: known(body), updated_by: user, updated_at: clock };
    if (index < 0) store.push(row);
    else store[index] = row;
    return row;
  };
  const server: FakeServer = {
    values: () => store.map((row) => `${row.scope}=${row.value}`).sort(),
    failReads: () => {
      readFails = true;
    },
    writeAs: (user, row) => void writeAs(user, row),
    drop: (ruleKey) => {
      const index = store.findIndex((row) => row.rule_key === ruleKey);
      if (index >= 0) store.splice(index, 1);
    },
  };
  const fault = (method: Fault["method"]) => {
    const index = faults.findIndex(
      (item) => item.method === method && (item.skip ?? 0) <= calls[method],
    );
    calls[method] += 1;
    const found = index < 0 ? undefined : faults.splice(index, 1)[0];
    found?.meddle?.(server);
    return found;
  };
  transport.get.mockImplementation(async (url: string, config: { params: { where?: string } }) => {
    if (url.endsWith("/service_identity/envs"))
      return { data: { ...(config.params.where ? scoped : labels), can_edit: true } };
    if (readFails) throw fail(503, "unavailable");
    return { data: { overrides: store.map((row) => ({ ...row })), total: store.length } };
  });
  transport.put.mockImplementation(async (_url: string, body: OverrideWrite) => {
    const failure = fault("put");
    if (failure && !failure.commit) throw fail(failure.status, "write failed");
    const index = store.findIndex((row) => sameFields(row, body));
    const before = index < 0 ? null : { ...store[index] };
    const row = writeAs(ME, { ...previous, ...body });
    failure?.late?.(server);
    if (failure) throw fail(failure.status, "committed then failed");
    const affected = { services: 9, versions: 14 };
    return { data: { override: { ...row }, previous: before, removed: false, affected } };
  });
  transport.delete.mockImplementation(async (url: string) => {
    const failure = fault("delete");
    if (failure && !failure.commit) throw fail(failure.status, "write failed");
    const ruleKey = decodeURIComponent(url.split("/").pop() || "");
    const index = store.findIndex((row) => row.rule_key === ruleKey);
    if (index < 0) throw fail(404, "Override not found");
    const [removed] = store.splice(index, 1);
    failure?.late?.(server);
    if (failure) throw fail(failure.status, "committed then failed");
    return { data: { removed } };
  });
  return server;
}
const deleted = () => transport.delete.mock.calls.map((call) => decodeURIComponent(call[0]));
const scopeValue = (view: VueWrapper) => view.findComponent(OSelect).props("modelValue");

async function openPopover(env: Environment = identity, service = "ingester") {
  wrapper = mount(ServiceEnvChip, { props: { identity: env, service }, attachTo: document.body });
  wrapper
    .get('[data-test="svcver-env-chip"]')
    .element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  serveEnvs();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  queryClient.clear();
  document.body.innerHTML = "";
});

describe("env chip in a narrow cell", () => {
  it("drops the env word under a column that names it, keeping the value and the inferred segment", () => {
    for (const readonly of [false, true]) {
      wrapper = mount(ServiceEnvChip, {
        props: {
          identity: { ...identity, env_source: "namespace" },
          service: "ingester",
          readonly,
          hideKey: true,
        },
      });
      const chip = wrapper.get('[data-test="svcver-env-chip"]');
      expect(chip.get('[data-test="o-truncated-text"]').text()).toBe(identity.env);
      expect(chip.get('[data-test="svcver-env-inferred"]').exists()).toBe(true);
      expect(chip.text()).not.toMatch(/^env/);
      wrapper.unmount();
      wrapper = undefined;
    }
  });
});

describe("ChangeEnvPopover", () => {
  it("saves in two clicks for the whole where and reports the response counts", async () => {
    transport.put.mockResolvedValue({
      data: {
        override: created,
        previous: null,
        removed: false,
        affected: { services: 9, versions: 14 },
      },
    });
    await openPopover();
    expect($("svcver-env-popover")).not.toBeNull();
    expect(transport.get).toHaveBeenCalledWith(
      "/api/org/service_identity/envs",
      expect.objectContaining({ params: { where: identity.where_key, service: "ingester" } }),
    );
    expect($("svcver-env-impact")?.textContent).toContain("9 services · 14 versions in this scope");
    expect($("svcver-env-option-prod")?.textContent).toContain(
      "current · 24 services org-wide · no change",
    );
    expect($("svcver-env-option-demo-k8s")?.textContent).toContain(
      "1 service org-wide · cluster name",
    );
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(transport.put.mock.calls[0][0]).toBe("/api/org/service_identity/overrides");
    expect(transport.put.mock.calls[0][1]).toEqual({
      scope: "where",
      where_key: identity.where_key,
      k8s_cluster: "eu-a",
      service_name: "",
      value: "staging",
    });
    expect($("svcver-env-undo-bar")?.textContent).toContain(
      "Env set to staging for 9 services in shop-cloud-prod (eu-a)",
    );
  });

  it("words a scope outside Kubernetes from its where, in the popover and its toast, never default", async () => {
    transport.put.mockResolvedValue({
      data: {
        override: created,
        previous: null,
        removed: false,
        affected: { services: 2, versions: 3 },
      },
    });
    const outside: Environment = {
      ...identity,
      where_key: "default",
      where: { kind: "default", k8s_cluster: "", k8s_namespace: "" },
      env: "default",
      env_source: "default",
      no_env: true,
      override_key: undefined,
    };
    await openPopover(outside, "");
    const popover = $("svcver-env-popover")!.textContent!;
    expect(popover).toContain("Where: outside Kubernetes, all its instances together");
    expect(popover).toContain("this service sends no deployment.environment and runs outside");
    expect(popover).not.toMatch(/default/i);
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    const toast = $("svcver-env-undo-bar")!.textContent!;
    expect(toast).toContain("Env set to staging for 2 services outside Kubernetes");
    expect(toast).not.toMatch(/default|in outside/i);
  });

  it("undoes a new override with DELETE of its rule key", async () => {
    const server = serveStore([]);
    await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    $("svcver-env-undo")!.click();
    await flushPromises();
    expect(transport.delete).toHaveBeenCalledWith(
      `/api/org/service_identity/overrides/${encodeURIComponent(created.rule_key)}`,
      expect.anything(),
    );
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(server.values()).toEqual([]);
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("removes the override when the detected label is picked and Undo re-PUTs the previous one", async () => {
    const server = serveStore([overrideRow]);
    await openPopover(overrideIdentity);
    expect($("svcver-env-option-prod")?.textContent).toContain("detected");
    $("svcver-env-option-prod")!.click();
    await flushPromises();
    expect(transport.put).not.toHaveBeenCalled();
    expect(deleted()).toEqual([`/api/org/service_identity/overrides/${previous.rule_key}`]);
    expect($("svcver-env-undo-bar")?.textContent).toContain(
      "Env set to prod for 1 service in shop-cloud-prod (eu-a)",
    );
    $("svcver-env-undo")!.click();
    await flushPromises();
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(transport.put.mock.calls[0][1]).toEqual({
      scope: previous.scope,
      where_key: previous.where_key,
      k8s_cluster: previous.k8s_cluster,
      service_name: previous.service_name,
      value: previous.value,
    });
    expect(transport.delete).toHaveBeenCalledTimes(1);
    expect(server.values()).toEqual(["where=eu1cloud"]);
  });

  it("opens at a service override's scope and removes that rule, not a where tombstone, for the detected label", async () => {
    serveStore([serviceRule]);
    const view = await openPopover(serviceIdentity);
    expect(scopeValue(view)).toBe("service");
    expect($("svcver-env-impact")?.textContent).toContain("1 service · 2 versions in this scope");
    $("svcver-env-option-prod")!.click();
    await flushPromises();
    expect(transport.put).not.toHaveBeenCalled();
    expect(deleted()).toEqual([`/api/org/service_identity/overrides/${serviceRule.rule_key}`]);
    expect($("svcver-env-undo-bar")?.textContent).toContain(
      "Env set to prod for ingester in shop-cloud-prod (eu-a)",
    );
    $("svcver-env-undo")!.click();
    await flushPromises();
    expect(transport.put.mock.calls[0][1]).toEqual({
      scope: "service",
      where_key: serviceRule.where_key,
      k8s_cluster: "eu-a",
      service_name: "ingester",
      value: "eu1svc",
    });
  });

  it("a broader write also removes the narrower rule that would keep the label, and Undo restores both", async () => {
    const server = serveStore([serviceRule]);
    const view = await openPopover(serviceIdentity);
    view.findComponent(OSelect).vm.$emit("update:modelValue", "where");
    await flushPromises();
    expect($("svcver-env-shadow")?.textContent).toContain(
      "Also removes the override for ingester in shop-cloud-prod (eu-a) (eu1svc), so this label follows.",
    );
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put.mock.calls[0][1]).toMatchObject({ scope: "where", value: "staging" });
    expect(deleted()).toEqual([`/api/org/service_identity/overrides/${serviceRule.rule_key}`]);
    $("svcver-env-undo")!.click();
    await flushPromises();
    expect(deleted()[1]).toBe(`/api/org/service_identity/overrides/${created.rule_key}`);
    expect(transport.put.mock.calls[1][1]).toMatchObject({ scope: "service", value: "eu1svc" });
    expect(server.values()).toEqual(["service=eu1svc"]);
  });

  it("rolls a broader write back when deleting the narrower rule fails, with no success or Undo", async () => {
    const server = serveStore([serviceRule], [{ method: "delete", commit: false, status: 503 }]);
    const view = await openPopover(serviceIdentity);
    view.findComponent(OSelect).vm.$emit("update:modelValue", "where");
    await flushPromises();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(deleted()).toEqual([
      `/api/org/service_identity/overrides/${serviceRule.rule_key}`,
      `/api/org/service_identity/overrides/${created.rule_key}`,
    ]);
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(server.values()).toEqual(["service=eu1svc"]);
    expect($("svcver-env-error")?.textContent).toContain(
      "The service registry is unavailable. Try again in a few seconds.",
    );
    expect($("svcver-env-option-staging")).not.toBeNull();
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("re-PUTs the previous broader rule when the narrower DELETE fails after an update", async () => {
    const server = serveStore(
      [serviceRule, overrideRow],
      [{ method: "delete", commit: false, status: 500 }],
    );
    const view = await openPopover(serviceIdentity);
    view.findComponent(OSelect).vm.$emit("update:modelValue", "where");
    await flushPromises();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put).toHaveBeenCalledTimes(2);
    expect(transport.put.mock.calls[1][1]).toEqual({
      scope: previous.scope,
      where_key: previous.where_key,
      k8s_cluster: previous.k8s_cluster,
      service_name: previous.service_name,
      value: previous.value,
    });
    expect(server.values()).toEqual(["service=eu1svc", "where=eu1cloud"]);
    expect($("svcver-env-error")?.textContent).toContain("Couldn't change the env. Try again.");
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("re-PUTs a removed rule when a later DELETE of a detected-label restore fails", async () => {
    const server = serveStore(
      [serviceRule, overrideRow],
      [{ method: "delete", commit: false, status: 404, skip: 1 }],
    );
    const view = await openPopover(serviceIdentity);
    view.findComponent(OSelect).vm.$emit("update:modelValue", "where");
    await flushPromises();
    $("svcver-env-option-prod")!.click();
    await flushPromises();
    expect(deleted()).toEqual([
      `/api/org/service_identity/overrides/${serviceRule.rule_key}`,
      `/api/org/service_identity/overrides/${overrideRow.rule_key}`,
    ]);
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(transport.put.mock.calls[0][1]).toMatchObject({ scope: "service", value: "eu1svc" });
    expect(server.values()).toEqual(["service=eu1svc", "where=eu1cloud"]);
    expect($("svcver-env-error")).not.toBeNull();
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("says the env may be partly changed and refreshes the chip when the re-read fails", async () => {
    const server = serveStore(
      [],
      [{ method: "put", commit: true, status: 503, meddle: (fake) => fake.failReads() }],
    );
    const refresh = vi.spyOn(queryClient, "invalidateQueries");
    await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(server.values()).toEqual(["where=staging"]);
    expect($("svcver-env-undo-bar")?.textContent).toContain(PARTLY);
    expect($("svcver-env-undo-bar")?.textContent).not.toContain("Env set to");
    expect($("svcver-env-undo")).toBeNull();
    expect($("svcver-env-view-overrides")).not.toBeNull();
    expect($("svcver-env-error")?.textContent).toContain("The service registry is unavailable");
    expect(refresh).toHaveBeenCalledWith({ queryKey: serviceVersionKeys.all("org") });
    refresh.mockRestore();
  });

  it.each([
    ["a new rule's PUT", [], "put", undefined, "", "staging", false, []],
    [
      "an update's PUT",
      [overrideRow],
      "put",
      overrideIdentity,
      "",
      "staging",
      false,
      ["where=eu1cloud"],
    ],
    [
      "a narrower rule's DELETE",
      [serviceRule],
      "delete",
      serviceIdentity,
      "where",
      "staging",
      false,
      ["service=eu1svc"],
    ],
    [
      "a detected-label removal's DELETE",
      [overrideRow],
      "delete",
      overrideIdentity,
      "",
      "prod",
      false,
      ["where=eu1cloud"],
    ],
    ["an Undo's DELETE", [], "delete", undefined, "", "staging", true, []],
    [
      "an Undo's re-PUT",
      [overrideRow],
      "put",
      overrideIdentity,
      "",
      "staging",
      true,
      ["where=eu1cloud"],
    ],
  ] as const)(
    "puts the store back when %s committed before answering 503",
    async (_, rows, method, from, scope, option, undo, after) => {
      const fault = {
        method,
        commit: true,
        status: 503,
        ...(undo && method === "put" ? { skip: 1 } : {}),
      };
      const server = serveStore([...rows], [fault]);
      const view = await openPopover(from);
      if (scope) {
        view.findComponent(OSelect).vm.$emit("update:modelValue", scope);
        await flushPromises();
      }
      $(`svcver-env-option-${option}`)!.click();
      await flushPromises();
      if (undo) {
        $("svcver-env-undo")!.click();
        await flushPromises();
      } else
        expect($("svcver-env-error")?.textContent).toContain("The service registry is unavailable");
      expect(server.values()).toEqual(after);
      expect($("svcver-env-undo-bar")).toBeNull();
    },
  );

  it("says the env may be partly changed, without Undo, when a restore step fails", async () => {
    const server = serveStore(
      [serviceRule],
      [
        { method: "delete", commit: false, status: 503 },
        { method: "delete", commit: false, status: 503 },
      ],
    );
    const view = await openPopover(serviceIdentity);
    view.findComponent(OSelect).vm.$emit("update:modelValue", "where");
    await flushPromises();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.delete).toHaveBeenCalledTimes(2);
    expect(server.values()).toEqual(["service=eu1svc", "where=staging"]);
    expect($("svcver-env-error")).not.toBeNull();
    expect($("svcver-env-undo-bar")?.textContent).toContain(PARTLY);
    expect($("svcver-env-undo")).toBeNull();
    expect($("svcver-env-undo-bar")?.textContent).not.toContain("Env set to");
  });

  it.each(["staging", "qa"])(
    "keeps another admin's new %s rule when this PUT fails before committing",
    async (theirs) => {
      const refresh = vi.spyOn(queryClient, "invalidateQueries");
      const server = serveStore(
        [],
        [
          {
            method: "put",
            commit: false,
            status: 503,
            meddle: (fake) => fake.writeAs(OTHER, { ...created, value: theirs }),
          },
        ],
      );
      await openPopover();
      $("svcver-env-option-staging")!.click();
      await flushPromises();
      expect(transport.put).toHaveBeenCalledTimes(1);
      expect(transport.delete).not.toHaveBeenCalled();
      expect(server.values()).toEqual([`where=${theirs}`]);
      expect($("svcver-env-undo-bar")?.textContent).toContain(PARTLY);
      expect($("svcver-env-undo")).toBeNull();
      expect($("svcver-env-error")?.textContent).toContain("The service registry is unavailable");
      expect(refresh).toHaveBeenCalledWith({ queryKey: serviceVersionKeys.all("org") });
      refresh.mockRestore();
    },
  );

  it("keeps a rule another admin wrote after this PUT committed and answered 503", async () => {
    const server = serveStore(
      [],
      [
        {
          method: "put",
          commit: true,
          status: 503,
          late: (fake) => fake.writeAs(OTHER, { ...created, value: "staging" }),
        },
      ],
    );
    await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.delete).not.toHaveBeenCalled();
    expect(server.values()).toEqual(["where=staging"]);
    expect($("svcver-env-undo-bar")?.textContent).toContain(PARTLY);
  });

  it("keeps another admin's edit of the narrower rule when this DELETE fails", async () => {
    const server = serveStore(
      [serviceRule],
      [
        {
          method: "delete",
          commit: false,
          status: 503,
          meddle: (fake) => fake.writeAs(OTHER, { ...serviceRule, value: "qa" }),
        },
      ],
    );
    const view = await openPopover(serviceIdentity);
    view.findComponent(OSelect).vm.$emit("update:modelValue", "where");
    await flushPromises();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(deleted()).toEqual([
      `/api/org/service_identity/overrides/${serviceRule.rule_key}`,
      `/api/org/service_identity/overrides/${created.rule_key}`,
    ]);
    expect(server.values()).toEqual(["service=qa"]);
    expect($("svcver-env-undo-bar")?.textContent).toContain(PARTLY);
    expect($("svcver-env-undo")).toBeNull();
  });

  it("keeps a value newer than the cached one when this PUT fails before committing", async () => {
    const server = serveStore([overrideRow], [{ method: "put", commit: false, status: 503 }]);
    await openPopover(overrideIdentity);
    server.writeAs(OTHER, { ...overrideRow, value: "qa" });
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(transport.delete).not.toHaveBeenCalled();
    expect(server.values()).toEqual(["where=qa"]);
    expect($("svcver-env-error")?.textContent).toContain("The service registry is unavailable");
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("writes nothing and shows the error when the snapshot read fails", async () => {
    const server = serveStore([]);
    await openPopover();
    server.failReads();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put).not.toHaveBeenCalled();
    expect(transport.delete).not.toHaveBeenCalled();
    expect(server.values()).toEqual([]);
    expect($("svcver-env-error")?.textContent).toContain("The service registry is unavailable");
    expect($("svcver-env-option-staging")).not.toBeNull();
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("Undo leaves a rule another admin changed after this write", async () => {
    const server = serveStore([]);
    await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    server.writeAs(OTHER, { ...created, value: "qa" });
    $("svcver-env-undo")!.click();
    await flushPromises();
    expect(transport.delete).not.toHaveBeenCalled();
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(server.values()).toEqual(["where=qa"]);
    expect($("svcver-env-undo-bar")?.textContent).toContain(PARTLY);
    expect($("svcver-env-undo")).toBeNull();
  });

  it("refuses the detected label while a broader rule would still control it, with no write", async () => {
    serveEnvs(true, [serviceRule, clusterRule]);
    const view = await openPopover(serviceIdentity);
    expect(scopeValue(view)).toBe("service");
    $("svcver-env-option-prod")!.click();
    await flushPromises();
    expect(transport.put).not.toHaveBeenCalled();
    expect(transport.delete).not.toHaveBeenCalled();
    expect($("svcver-env-error")?.textContent).toContain(
      "cluster eu-a also has an override (eu1all)",
    );
    view.findComponent(OSelect).vm.$emit("update:modelValue", "cluster");
    await flushPromises();
    transport.delete
      .mockResolvedValueOnce({ data: { removed: serviceRule } })
      .mockResolvedValueOnce({ data: { removed: clusterRule } });
    $("svcver-env-option-prod")!.click();
    await flushPromises();
    expect(deleted()).toEqual([
      `/api/org/service_identity/overrides/${serviceRule.rule_key}`,
      `/api/org/service_identity/overrides/${clusterRule.rule_key}`,
    ]);
  });

  it("writes the narrower and wider scopes with the backend's consistent fields", async () => {
    transport.put.mockResolvedValue({
      data: {
        override: created,
        previous: null,
        removed: false,
        affected: { services: 1, versions: 2 },
      },
    });
    const view = await openPopover();
    const select = view.findComponent(OSelect);
    select.vm.$emit("update:modelValue", "service");
    await flushPromises();
    expect($("svcver-env-impact")?.textContent).toContain("1 service · 2 versions in this scope");
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put.mock.calls[0][1]).toMatchObject({
      scope: "service",
      where_key: identity.where_key,
      service_name: "ingester",
    });
    view
      .get('[data-test="svcver-env-chip"]')
      .element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    view.findComponent(OSelect).vm.$emit("update:modelValue", "cluster");
    await flushPromises();
    expect($("svcver-env-impact")?.textContent).toContain(
      "24 services · 41 versions in this scope",
    );
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect(transport.put.mock.calls[1][1]).toEqual({
      scope: "cluster",
      where_key: "",
      k8s_cluster: "eu-a",
      service_name: "",
      value: "staging",
    });
  });

  it("shows the read-only view without options or writes when can_edit is false", async () => {
    serveEnvs(false);
    await openPopover();
    expect($("svcver-env-readonly")?.textContent).toContain("Ask an admin to change this");
    expect($("svcver-env-option-staging")).toBeNull();
    expect($("svcver-env-new")).toBeNull();
    expect(transport.put).not.toHaveBeenCalled();
  });

  it("latches read-only on a PUT 403 and keeps the prior label", async () => {
    transport.put.mockRejectedValue(fail(403, "Unauthorized Access"));
    const view = await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect($("svcver-env-readonly")).not.toBeNull();
    expect($("svcver-env-option-pentest")).toBeNull();
    expect(view.get('[data-test="svcver-env-chip"]').text()).toContain("prod");
    expect($("svcver-env-undo-bar")).toBeNull();
    expect(transport.put).toHaveBeenCalledTimes(1);
  });

  it("validates a new env label before writing and applies a valid one on Enter", async () => {
    transport.put.mockResolvedValue({
      data: {
        override: created,
        previous: null,
        removed: false,
        affected: { services: 9, versions: 14 },
      },
    });
    await openPopover();
    $("svcver-env-new")!.click();
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>(
      '[data-test="svcver-env-new-input"] input, input[data-test="svcver-env-new-input"]',
    )!;
    const form = $("svcver-env-new-form") as HTMLFormElement;
    for (const value of ["bad label", "x".repeat(129), ""]) {
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await flushPromises();
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      await flushPromises();
      expect(form.textContent).toContain("Use 1 to 128 letters");
    }
    expect(transport.put).not.toHaveBeenCalled();
    input.value = "eu1cloud";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();
    expect(transport.put.mock.calls[0][1]).toMatchObject({ value: "eu1cloud" });
  });

  it.each([
    [400, "Override limit reached", "override limit"],
    [400, "inconsistent override scope", "This scope can't take an override"],
    [400, "invalid override value", "That env label isn't valid"],
    [404, "Override target not found", "Nothing in this scope was seen"],
    [503, "registry_unavailable", "The service registry is unavailable"],
    [500, "boom", "Couldn't change the env"],
  ])("maps a %s %s to its copy and keeps the popover open", async (status, error, copy) => {
    transport.put.mockRejectedValue(fail(status, error));
    await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    expect($("svcver-env-error")?.textContent).toContain(copy);
    expect($("svcver-env-option-staging")).not.toBeNull();
    expect($("svcver-env-undo-bar")).toBeNull();
  });

  it("opens Environments & versions from the undo bar", async () => {
    transport.put.mockResolvedValue({
      data: {
        override: created,
        previous: null,
        removed: false,
        affected: { services: 9, versions: 14 },
      },
    });
    await openPopover();
    $("svcver-env-option-staging")!.click();
    await flushPromises();
    $("svcver-env-view-overrides")!.click();
    expect(push).toHaveBeenCalledWith({
      name: "correlationSettings",
      params: { tab: "env-versions" },
      query: { org_identifier: "org" },
    });
  });

  it("renders the real envs responses of the golden run", async () => {
    transport.get.mockResolvedValue({ data: golden.envs });
    await openPopover();
    expect($("svcver-env-impact")?.textContent).toContain("1 service · 2 versions in this scope");
    expect($("svcver-env-option-prod")?.textContent).toContain(
      "current · 3 services org-wide · no change",
    );
    wrapper!.unmount();
    wrapper = undefined;
    queryClient.clear();
    transport.get.mockResolvedValue({ data: golden.envsRum });
    await openPopover(golden.rumIdentity, "storefront");
    expect($("svcver-env-impact")?.textContent).toContain("2 services · 3 versions in this scope");
  });

  it("names services only when the server sends no scope_versions", async () => {
    transport.get.mockResolvedValue({ data: { ...scoped, scope_versions: undefined } });
    await openPopover();
    const impact = $("svcver-env-impact")?.textContent ?? "";
    expect(impact).toContain("9 services in this scope");
    expect(impact).not.toContain("·");
  });
});

describe("envSourceSentence", () => {
  it("dates an override with the feature's one deploy-time format, month first", () => {
    const at = Date.UTC(2026, 10, 1, 23, 27) * 1000;
    const row = { updated_by: "root@example.com", updated_at: at } as IdentityOverride;
    const text = envSourceSentence({ ...identity, env_source: "override" }, gt, "UTC", row);
    expect(text).toContain("root@example.com");
    expect(text).toMatch(/Nov 1(, 2026)?, 23:27/);
    expect(text).not.toContain("1 Nov");
  });
});

describe("ServiceEnvChip", () => {
  it("shows the read-only chip and reads no overrides while the correlation licence is locked", async () => {
    storeState.zoConfig.features = { correlation: "locked" };
    try {
      wrapper = mount(ServiceEnvChip, {
        props: { identity: overrideIdentity, service: "ingester" },
        global: { provide: { store: { state: storeState } } },
      });
      await wrapper.get('[data-test="svcver-env-chip"]').trigger("mouseenter");
      await flushPromises();
      expect(wrapper.find("button").exists()).toBe(false);
      expect(transport.get).not.toHaveBeenCalled();
    } finally {
      storeState.zoConfig.features = {};
    }
  });

  it("keeps a read-only chip's inferred segment and names the source with no click hint", () => {
    wrapper = mount(ServiceEnvChip, {
      props: { identity, readonly: true },
      global: { stubs: { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } } },
    });
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.get('[data-test="svcver-env-inferred"]').text()).toBe("inferred");
    const tooltip = wrapper.get('[data-test="svcver-env-tooltip"]').text();
    expect(tooltip).toContain("inferred from namespace shop-cloud-prod");
    expect(tooltip).not.toContain("click to change");
  });

  it.each(["namespace", "cluster", "workload", "cluster_name", "namespace_name"])(
    "marks an env inferred from %s with the segment and an inferred-from tooltip line",
    (source) => {
      wrapper = mount(ServiceEnvChip, {
        props: {
          identity: {
            ...identity,
            env: "prod",
            env_source: source,
            env_source_value: "payments-prod",
          },
        },
        global: { stubs: { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } } },
      });
      expect(wrapper.find('[data-test="svcver-env-inferred"]').exists()).toBe(true);
      expect(wrapper.html()).not.toContain("decoration-dotted");
      const line = wrapper.get('[data-test="svcver-env-tooltip"] > span').text();
      expect(line).toMatch(/^prod · inferred from [a-z ]+ payments-prod/);
    },
  );

  it.each(["attribute", "rum", "override"])(
    "gives an env from %s no inferred segment",
    (source) => {
      wrapper = mount(ServiceEnvChip, {
        props: { identity: { ...identity, env_source: source }, readonly: true },
      });
      expect(wrapper.find('[data-test="svcver-env-inferred"]').exists()).toBe(false);
    },
  );

  it("names the cluster in a cluster-name fallback when the producer sends no value", () => {
    const text = envSourceSentence(
      { ...identity, env: "o2-nava", env_source: "cluster_name", env_source_value: "" },
      gt,
      "UTC",
    );
    expect(text).toBe("inferred from cluster name o2-nava (no env word found)");
  });

  it("gives a chip showing another env than its pinned one no inferred segment", () => {
    wrapper = mount(ServiceEnvChip, { props: { identity, shownEnv: "staging" } });
    expect(wrapper.find('[data-test="svcver-env-inferred"]').exists()).toBe(false);
  });

  it("names three other envs, then counts the rest, for a scope seen in eleven envs", () => {
    const envs = ["prod", ...Array.from({ length: 10 }, (_, index) => `env${index + 1}`)];
    wrapper = mount(ServiceEnvChip, {
      props: { identity: { ...identity, env: "prod", envs }, readonly: true },
      global: { stubs: { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } } },
    });
    expect(wrapper.get('[data-test="svcver-env-also"]').text()).toBe(
      "Also seen in: env1, env2, env3, and 7 more",
    );
  });

  it("names the other env of a real producer scope seen in two envs", () => {
    wrapper = mount(ServiceEnvChip, {
      props: { identity: structuredClone(producer.two_env.services.services[0]), readonly: true },
      global: { stubs: { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } } },
    });
    expect(wrapper.get('[data-test="svcver-env-also"]').text()).toBe("Also seen in: staging");
  });

  it("names the env that matched the Env filter in the tooltip and lists the pinned one with the others", () => {
    const tip = { stubs: { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } } };
    const scope = structuredClone(producer.two_env.services.services[0]);
    wrapper = mount(ServiceEnvChip, {
      props: { identity: scope, shownEnv: "staging" },
      global: tip,
    });
    expect(wrapper.get('[data-test="svcver-env-chip"]').text()).toContain("staging");
    const tooltip = wrapper.get('[data-test="svcver-env-tooltip"]');
    expect(tooltip.get("b").text()).toBe("staging");
    expect(tooltip.text()).not.toContain("deployment.environment attribute");
    expect(wrapper.get('[data-test="svcver-env-also"]').text()).toBe("Also seen in: prod");
    wrapper.unmount();
    wrapper = mount(ServiceEnvChip, {
      props: { identity: { ...scope, envs: ["prod", "staging", "dev"] }, shownEnv: "dev" },
      global: tip,
    });
    expect(wrapper.get('[data-test="svcver-env-chip"]').text()).toContain("dev");
    expect(wrapper.get('[data-test="svcver-env-tooltip"] b').text()).toBe("dev");
    expect(wrapper.get('[data-test="svcver-env-also"]').text()).toBe(
      "Also seen in: prod and staging",
    );
  });

  it("names the env attribute and its value in words, never the raw key=value pair", () => {
    wrapper = mount(ServiceEnvChip, {
      props: {
        identity: {
          ...structuredClone(producer.two_env.services.services[0]),
          env_source_value: "deployment.environment.name=production",
        },
      },
      global: { stubs: { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } } },
    });
    const text = wrapper.get('[data-test="svcver-env-tooltip"]').text();
    expect(text).toContain("from your deployment.environment attribute (production)");
    expect(text).not.toContain("=");
  });

  it("is a button with no inferred segment for an override", () => {
    wrapper = mount(ServiceEnvChip, { props: { identity: overrideIdentity } });
    const chip = wrapper.get('[data-test="svcver-env-chip"]');
    expect(chip.element.tagName).toBe("BUTTON");
    expect(chip.find('[data-test="svcver-env-inferred"]').exists()).toBe(false);
  });
});
