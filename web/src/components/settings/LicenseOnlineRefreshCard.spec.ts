import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import type { RefreshBody, RefreshStatus } from "@/utils/licenseRefresh";
import LicenseOnlineRefreshCard from "./LicenseOnlineRefreshCard.vue";

const refresh = vi.hoisted(() => vi.fn());
const rotate = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useLicenseRefresh", () => ({
  useLicenseRefresh: () => ({ refreshLicenseLimits: refresh, rotateInstanceKey: rotate }),
}));
const copy = vi.hoisted(() => vi.fn());
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copy }));
const status = (patch: Partial<RefreshStatus> = {}): RefreshStatus => ({
  mode: "online",
  server_host: "license.openobserve.ai",
  registration: "registered",
  key_id: "Jt4W-long-key-pQ8c",
  key_created: true,
  key_at_rest: "encrypted",
  rotate_recommended: false,
  rotation_unsettled: false,
  last_attempt_at: 1792748460000000,
  last_success_at: 1792748460000000,
  last_attempt_by: "dana@northwind.example",
  last_status: "updated",
  last_error: null,
  last_error_detail: "",
  last_outcome: null,
  successor_available: null,
  stored_key: null,
  ...patch,
});
let wrapper: VueWrapper | undefined;
const card = (patch: Partial<RefreshStatus> = {}, props = {}) =>
  (wrapper = mount(LicenseOnlineRefreshCard, {
    props: { refresh: status(patch), canUpdate: true, envKeyActive: false, isRoot: true, ...props },
    global: {
      plugins: [i18n, createStore({ state: { selectedOrganization: { identifier: "default" } } })],
    },
  }));
beforeEach(() => {
  vi.clearAllMocks();
  refresh.mockResolvedValue({ ok: true, body: { outcome: "unchanged" } });
  rotate.mockResolvedValue({ ok: true, body: { outcome: "updated" } });
});
afterEach(() => wrapper?.unmount());
describe("LicenseOnlineRefreshCard", () => {
  it("never refreshes on mount or status changes", async () => {
    const w = card();
    await w.setProps({ refresh: status({ last_status: "unchanged" }) });
    expect(refresh).not.toHaveBeenCalled();
    expect(rotate).not.toHaveBeenCalled();
  });
  it("in progress shows spinner text and blocks duplicate requests", async () => {
    let done: (v: unknown) => void = () => {};
    refresh.mockImplementation(() => new Promise((r) => (done = r)));
    const w = card();
    await w.get('[data-test="license-online-refresh"]').trigger("click");
    await w.get('[data-test="license-online-refresh"]').trigger("click");
    expect(w.text()).toContain("Refreshing limits, then checking with the license server…");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(w.get('[data-test="license-online-rotate"]').attributes("disabled")).toBeDefined();
    done({ ok: true, body: { outcome: "unchanged" } });
    await flushPromises();
    expect(w.text()).toContain("License is up to date");
  });
  it.each<[string, RefreshBody, string]>([
    ["up to date", { outcome: "unchanged" }, "License is up to date"],
    ["renewal applied", { outcome: "renewed" }, "A renewed license was applied"],
    ["key conflict", { error: "key_conflict" }, "registered with another key"],
    ["rate limited", { error: "rate_limited", retry_after_s: 30 }, "Try again in 30 s"],
    ["another click running", { code: 409, reason: "refresh_in_progress" }, "already running"],
  ])("renders the %s panel", async (_, body, text) => {
    refresh.mockResolvedValue({ ok: true, body });
    const w = card();
    await w.get('[data-test="license-online-refresh"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="license-online-outcome"]').text()).toContain(text);
  });
  it("never refreshed shows first-registration hint", () => {
    expect(
      card({
        registration: "not_registered",
        last_success_at: null,
        last_attempt_at: null,
        last_outcome: null,
      }).text(),
    ).toContain("The first Refresh now registers this installation with OpenObserve.");
  });
  it("turned off still lets administrators refresh local limits", () => {
    const w = card({ mode: "disabled" });
    expect(w.text()).toContain("Turned off");
    expect(w.find('[data-test="license-online-refresh"]').exists()).toBe(true);
    expect(w.find('[data-test="license-online-rotate"]').exists()).toBe(false);
  });
  it("viewer sees the ask line and no buttons or key material", () => {
    const w = card({ stored_key: "secret" }, { canUpdate: false, isRoot: false });
    expect(w.text()).toContain("Ask an administrator to refresh the license.");
    expect(w.findAll("button")).toHaveLength(0);
    expect(w.text()).not.toContain("Jt4W");
    expect(w.text()).not.toContain("secret");
  });
  it("plaintext shows the master-key hint", () => {
    expect(card({ key_at_rest: "plaintext" }).text()).toContain(
      "Set O2_MASTER_ENCRYPTION_KEY to encrypt it, then rotate the key.",
    );
  });
  it("copy renewed key only with stored_key, env and root rights", async () => {
    const w = card(
      {
        successor_available: { license_id: "new", expires_at: 1825113600000000 },
        stored_key: "synthetic-key",
      },
      { envKeyActive: true },
    );
    expect(w.text()).toContain("Copy renewed key");
    await w.get('[data-test="license-online-copy"]').trigger("click");
    expect(copy).toHaveBeenCalledWith("synthetic-key", expect.any(Function));
    await w.setProps({
      refresh: status({ successor_available: { license_id: "new", expires_at: 1825113600000000 } }),
    });
    expect(w.find('[data-test="license-online-copy"]').exists()).toBe(false);
    await w.setProps({ refresh: status({ stored_key: "synthetic-key" }), isRoot: false });
    expect(w.find('[data-test="license-online-copy"]').exists()).toBe(false);
  });
  it("rotate hint uses the OpenObserve-asked copy and rotation endpoint", async () => {
    const w = card({ rotate_recommended: true });
    expect(w.text()).toContain("OpenObserve has asked this installation to rotate its key.");
    await w.get('[data-test="license-online-rotate"]').trigger("click");
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("409 shows already running", async () => {
    refresh.mockResolvedValue({
      ok: false,
      status: 409,
      body: { code: 409, reason: "refresh_in_progress" },
    });
    const w = card();
    await w.get('[data-test="license-online-refresh"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("already running");
  });
  it("network error retains last success and shows the proxy hint", () => {
    const w = card({
      last_error: "timeout",
      last_error_detail: "connection timed out after 10 s.",
      last_outcome: { error: "timeout" },
    });
    expect(w.text()).toContain("connection timed out after 10 s.");
    expect(w.text()).toContain("HTTPS_PROXY / NO_PROXY");
  });
  it("blocked hides rotation", () => {
    const w = card({ registration: "blocked", last_outcome: { error: "blocked" } });
    expect(w.text()).toContain("Blocked by OpenObserve");
    expect(w.find('[data-test="license-online-rotate"]').exists()).toBe(false);
  });
  it("airgapped offers paste instead of rotation", async () => {
    const w = card({ mode: "airgapped" });
    expect(w.text()).toContain("air-gapped license");
    await w.get('[data-test="license-online-add-key"]').trigger("click");
    expect(w.emitted("add-license-key")).toHaveLength(1);
  });
  it("renders an unknown registration safely", () => {
    expect(card({ registration: "future_state" }).text()).toContain("Status unavailable");
  });
});

it("rotation confirms the installation key changed", async () => {
  const w = card();
  await w.get('[data-test="license-online-rotate"]').trigger("click");
  await flushPromises();
  expect(w.get('[data-test="license-online-outcome"]').text()).toBe("Installation key rotated.");
});
it("does not attribute an earlier success to the latest failed-attempt actor", () => {
  const w = card({
    last_success_at: 1792485600000000,
    last_attempt_by: "different@example.test",
    last_error: "timeout",
  });
  const rows = w.findAll('[data-test="o2-description-item"]');
  expect(rows.find((row) => row.text().includes("Last refreshed"))?.text()).not.toContain(
    "different@example.test",
  );
});
it("shows the fetched successor and expiry beside the last refresh", () => {
  const w = card({
    last_outcome: { error: "refused_by_env" },
    successor_available: { license_id: "lic_new", expires_at: 1825113600000000 },
  });
  expect(w.text()).toContain("renewed license fetched (lic_new, expires Nov 2, 2027)");
});

it("blocked status explains how long the current license keeps working", () => {
  const w = card({ registration: "blocked" }, { licenseExpiresAt: Date.UTC(2027, 4, 10) * 1000 });
  expect(w.text()).toContain("the current license keeps working until May 10, 2027");
});

it("turned-off status retains the last refresh time", () => {
  const w = card({ mode: "disabled" });
  expect(w.text()).toContain("Last refreshed");
  expect(w.text()).toContain("Oct 23, 09:41 UTC");
});

it("shows the proxy hint once when a saved network error and click outcome overlap", async () => {
  refresh.mockResolvedValue({ ok: true, body: { error: "timeout", limits_refreshed: true } });
  const w = card({ last_error: "timeout", last_error_detail: "timed out" });
  await w.get('[data-test="license-online-refresh"]').trigger("click");
  await flushPromises();
  expect(w.text().match(/Check outbound HTTPS/g)).toHaveLength(1);
});
