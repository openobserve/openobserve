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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import config from "@/aws-exports";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { fieldRows, m12Rows } from "./bulkFixtures";
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";
import {
  closeBulkReview,
  openBulkReview,
  setFolderRightsSource,
  useBulkReview,
} from "./useBulkReview";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  folders: vi.fn(),
  destinations: vi.fn(),
  copy: vi.fn(),
  schema: vi.fn(),
  configFull: vi.fn(),
}));

vi.mock("@/services/alerts", () => ({
  default: {
    create_by_alert_id: api.create,
    delete_by_alert_id: api.remove,
    listByFolderId: api.list,
  },
}));
vi.mock("@/services/common", () => ({ default: { list_Folders: api.folders } }));
vi.mock("@/services/alert_destination", () => ({ default: { list: api.destinations } }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: api.copy }));
vi.mock("@/services/stream", () => ({ default: { schema: api.schema } }));
vi.mock("@/services/config", () => ({ default: { get_config_full: api.configFull } }));
const measureBaseline = vi.hoisted(() => vi.fn());
vi.mock("../targets/baseline", () => ({
  measureBaseline: (...a: unknown[]) => measureBaseline(...a),
}));

const { default: BulkReviewDrawer } = await import("./BulkReviewDrawer.vue");
const { default: ODrawer } = await import("@/lib/overlay/Drawer/ODrawer.vue");

const IDS = { ingest: "f-ingest", payments: "f-pay" };
const original = config.isEnterprise;
const review = useBulkReview();
let wrapper: VueWrapper | null = null;

const q = (test: string) => document.querySelector<HTMLElement>(`[data-test="${test}"]`);
const text = (test: string) => q(test)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const mountDrawer = async () => {
  wrapper = mount(BulkReviewDrawer, {
    attachTo: document.body,
    global: { plugins: [i18n, store, router] },
  });
  await flushPromises();
  return wrapper;
};

const openWith = async (rows = m12Rows(IDS), opener?: HTMLElement) => {
  opener?.focus();
  openBulkReview({ kind: "no_data", rows });
  await flushPromises();
};

const click = async (test: string) => {
  q(test)!.click();
  await flushPromises();
};

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });

beforeEach(() => {
  measureBaseline.mockReset().mockResolvedValue(null);
  config.isEnterprise = "true";
  store.state.selectedOrganization.identifier = "demo-org";
  api.create.mockReset();
  api.remove.mockReset().mockResolvedValue({ data: {} });
  api.list.mockReset().mockResolvedValue({ data: { list: [] } });
  api.copy.mockReset().mockResolvedValue(true);
  api.folders.mockReset().mockResolvedValue({
    data: {
      list: [
        { folderId: "default", name: "default" },
        { folderId: "f-ingest", name: "ingest" },
        { folderId: "f-pay", name: "payments" },
      ],
    },
  });
  api.destinations.mockReset().mockResolvedValue({ data: [{ name: "ops-webhook" }] });
  api.schema.mockReset().mockImplementation((_org: string, name: string) =>
    name === "gone_logs"
      ? Promise.reject(httpError(404))
      : Promise.resolve({
          data: { schema: [{ name: "service_name" }, { name: "k8s_namespace_name" }] },
        }),
  );
});

afterEach(() => {
  closeBulkReview();
  setFolderRightsSource(null);
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  config.isEnterprise = original;
});

describe("BulkReviewDrawer — review", () => {
  it("stacks above the service drawer it is opened from", async () => {
    await mountDrawer();
    await openWith();
    const layers = [...document.querySelectorAll<HTMLElement>("[style*='z-index']")].map((el) =>
      Number(el.style.zIndex),
    );
    expect(Math.max(...layers)).toBeGreaterThanOrEqual(7000);
  });

  it("shows the title, the rule and the footer before anything is saved", async () => {
    await mountDrawer();
    await openWith();
    expect(text("bulk-review-title")).toBe("Add 12 no-data alerts");
    // The drawer's own title and sub-title, so it reads like every other drawer (T5-29).
    const drawer = wrapper!.findComponent({ name: "ODrawer" });
    expect(drawer.props("title")).toBe("Add 12 no-data alerts");
    expect(String(drawer.props("subTitle"))).toContain(
      "Nothing is saved until you click Add alerts.",
    );
    expect(text("bulk-review-rule")).toContain("Nothing is saved until you click Add alerts.");
    expect(text("bulk-review-footer")).toBe(
      "11 alerts will be created: 5 in folder ingest, 3 in folder default, 3 in folder payments. Each description says it came from an AutoObserve suggestion.",
    );
    expect(text("bulk-review-create")).toBe("Add alerts");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("names one alert in the singular", async () => {
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    expect(text("bulk-review-title")).toBe("Add 1 no-data alert");
    expect(text("bulk-review-create")).toBe("Add alerts");
  });

  it("writes nothing on Cancel and closes", async () => {
    await mountDrawer();
    await openWith();
    await click("bulk-review-cancel");
    expect(review.state.open).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("locks a folder the user can't write to, with a request to copy", async () => {
    setFolderRightsSource(async () => ({ "f-pay": false }));
    await mountDrawer();
    await openWith();
    expect(text("bulk-review-rights")).toContain("You can add 9 of 12.");
    expect(text("bulk-review-group-locked-team-payments")).toContain(
      "You can't write to folder payments. Its admins can add these.",
    );
    await click("bulk-review-group-request-team-payments");
    expect(api.copy.mock.calls[0][0]).toMatch(/^Please add 3 no-data alerts in folder payments/);
    expect(text("bulk-review-create")).toBe("Add alerts");
    expect(text("bulk-review-footer")).toContain("8 alerts will be created");
  });

  it("shows no lock and no rights banner before the server serves rights", async () => {
    await mountDrawer();
    await openWith();
    expect(q("bulk-review-rights")).toBeNull();
    expect(q("bulk-review-group-locked-team-payments")).toBeNull();
  });
});

describe("BulkReviewDrawer — rows that can't be added (T2-11, T2-18, T2-24)", () => {
  const svc = (key: string, kind: "errors" | "no_data") => ({
    key,
    kind,
    scope: {
      service: "svc-y",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "app_logs" },
      schema: ["service_name"],
    },
    usually: null,
  });

  it("a row AutoObserve can't build is unticked as well as disabled, and Add leaves it out", async () => {
    await mountDrawer();
    const unread = (key: string, kind: "errors" | "no_data") => {
      const row = svc(key, kind);
      return { ...row, scope: { ...row.scope, schema: undefined } };
    };
    await openWith([unread("y:errors", "errors"), unread("y:no_data", "no_data")] as never);
    expect(review.reviewRows.value.find((r) => r.key === "y:errors")?.prefill).toBeNull();
    const box = wrapper!
      .findAllComponents({ name: "BulkRowMark" })
      .find((c) => c.attributes("data-test") === "bulk-review-tick-y:errors")!;
    expect(box.props("disabled")).toBe(true);
    expect(box.props("checked")).toBe(false);
  });

  it("links Alerts in the line of a row it can't build (T2-11)", async () => {
    await mountDrawer();
    api.schema.mockResolvedValue({
      data: { schema: [{ name: "service_name" }, { name: "body" }] },
    });
    const row = {
      ...svc("z:errors", "errors"),
      scope: { ...svc("z:errors", "errors").scope, namespace: null, schema: undefined },
    };
    await openWith([row] as never);
    await flushPromises();
    const line = q("bulk-review-cant-z:errors")!;
    expect(line.textContent).toContain("Add it by hand in Alerts.");
    const link = line.querySelector<HTMLAnchorElement>('[data-test="bulk-review-open-alerts"]')!;
    expect(link.textContent).toBe("Alerts");
    expect(link.getAttribute("href")).toContain("alerts");
  });

  it("names the alert in each row's tick label, so two rows of one service differ", async () => {
    await mountDrawer();
    await openWith([svc("y:errors", "errors"), svc("y:no_data", "no_data")] as never);
    const labels = wrapper!
      .findAllComponents({ name: "BulkRowMark" })
      .map((c) => String(c.props("label")));
    expect(labels).toEqual(["Tick svc-y, Errors", "Tick svc-y, Stops sending"]);
  });

  it("says why a negative threshold can't be used, and keeps what was typed", async () => {
    measureBaseline.mockResolvedValue(null);
    await mountDrawer();
    await openWith([
      { ...svc("y:errors", "errors"), inputs: { errorField: { name: "level", kind: "level" } } },
    ] as never);
    await flushPromises();
    const input = wrapper!.findComponent('[data-test="bulk-review-threshold-y:errors"]');
    expect(input.props("modelValue")).toBe("0");
    input.vm.$emit("update:modelValue", "-5");
    await flushPromises();
    expect(input.props("modelValue")).toBe("-5");
    expect(input.props("errorMessage")).toBe("Enter 0 or more.");
    input.vm.$emit("update:modelValue", "5");
    await flushPromises();
    expect(input.props("errorMessage")).toBeUndefined();
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["y:errors"]);
  });

  it("a cleared threshold reads as an instruction, and the footer and Add say what is missing", async () => {
    measureBaseline.mockResolvedValue(null);
    await mountDrawer();
    await openWith([
      { ...svc("y:errors", "errors"), inputs: { errorField: { name: "level", kind: "level" } } },
    ] as never);
    await flushPromises();
    const input = wrapper!.findComponent('[data-test="bulk-review-threshold-y:errors"]');
    input.vm.$emit("update:modelValue", "");
    await flushPromises();
    expect(input.props("errorMessage")).toBe("Set a threshold");
    expect(
      q("bulk-review-threshold-y:errors")!.querySelector("input")!.getAttribute("aria-invalid"),
    ).toBe("true");
    const add = q("bulk-review-create") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(text("bulk-review-footer")).toBe(
      "1 alert needs a threshold before it can be added. Nothing is ticked, so nothing will be created.",
    );
    expect(add.getAttribute("aria-describedby")).toBe(q("bulk-review-footer")!.id);
  });
});

describe("BulkReviewDrawer — group editor (T2-17)", () => {
  it("the hint names teams only while grouped by team (T2-9)", async () => {
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    expect(text("bulk-review-group-hint")).toContain(
      "come from where each service's alerts already are",
    );
    const { setGroupBy } = await import("./useBulkReview");
    setGroupBy("folder");
    await flushPromises();
    expect(text("bulk-review-group-hint")).toBe("Change the folder and destination per group.");
  });

  it("applies a picked destination at once, without Done", async () => {
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    await click("bulk-review-group-change-team-ingest");
    const header = wrapper!.findComponent({ name: "BulkReviewGroupHeader" });
    const selects = header.findAllComponents({ name: "OSelect" });
    selects[1].vm.$emit("update:modelValue", ["ops-webhook"]);
    await flushPromises();
    expect(review.reviewRows.value[0].destinations).toEqual(["ops-webhook"]);
    expect(text("bulk-review-group-meta-team-ingest")).toContain("notifies ops-webhook");
    expect(q("bulk-review-group-editor-team-ingest")).not.toBeNull();
  });
});

describe("BulkReviewDrawer — results", () => {
  it("locks an open group editor across Create and partial failure", async () => {
    let reject!: (reason: unknown) => void;
    api.create.mockReturnValue(new Promise((_resolve, fail) => (reject = fail)));
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    await click("bulk-review-group-change-team-ingest");
    const header = wrapper!.findComponent({ name: "BulkReviewGroupHeader" });
    const selects = header.findAllComponents({ name: "OSelect" });
    await click("bulk-review-create");
    const assertFrozen = async () => {
      for (const select of selects) expect(select.props("disabled")).toBe(true);
      selects[0].vm.$emit("update:modelValue", "f-pay");
      selects[1].vm.$emit("update:modelValue", []);
      const done = header.findComponent(`[data-test="bulk-review-group-apply-team-ingest"]`);
      expect(done.props("disabled")).toBe(true);
      done.vm.$emit("click");
      await flushPromises();
      expect(text("bulk-review-group-meta-team-ingest")).toContain("ingest");
      expect(review.reviewRows.value[0].folder?.id).toBe("f-ingest");
      expect(review.reviewRows.value[0].destinations).toContain("ingest-oncall");
    };
    await assertFrozen();
    reject(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    await flushPromises();
    await assertFrozen();
    expect(q("bulk-review-retry-ingest-b")).not.toBeNull();
  });

  it("reports a 403 in red with the folder, and offers no retry for it", async () => {
    api.create.mockImplementation((_o: string, body: any) =>
      body.name === "svc-j-no-data"
        ? Promise.reject(httpError(403))
        : Promise.resolve({ data: { id: body.name } }),
    );
    await mountDrawer();
    await openWith();
    await click("bulk-review-create");
    expect(review.state.open).toBe(true);
    expect(text("bulk-review-failures")).toContain("1 of 11 alerts wasn't created.");
    expect(text("bulk-review-failure-j")).toBe(
      "svc-j: You can't create alerts. Your role is missing the Create permission on Alerts. The alert was going to folder payments.",
    );
    expect(q("bulk-review-failures")!.className).toContain("text-banner-error-soft-text");
    expect(q("bulk-review-retry-j")).toBeNull();
    expect(q("bulk-review-tick-j-failed")).not.toBeNull();
    expect(q("bulk-review-create")).toBeNull();
  });

  it("offers Open the existing alert for a duplicate, and no retry", async () => {
    api.create.mockImplementation((_o: string, body: any) =>
      body.name === "svc-a-ns-j-no-data"
        ? Promise.reject(httpError(409))
        : Promise.resolve({ data: { id: body.name } }),
    );
    await mountDrawer();
    await openWith();
    await click("bulk-review-create");
    expect(text("bulk-review-failure-a-j")).toBe(
      "svc-a · ns-j: an alert named svc-a-ns-j-no-data already exists in folder default.",
    );
    expect(q("bulk-review-open-existing-a-j")).not.toBeNull();
    expect(q("bulk-review-retry-a-j")).toBeNull();
  });

  it("offers Retry for a timeout and re-sends only that row", async () => {
    let first = true;
    api.create.mockImplementation((_o: string, body: any) => {
      if (body.name === "svc-ingest-f-no-data" && first) {
        first = false;
        return Promise.reject(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
      }
      return Promise.resolve({ data: { id: body.name } });
    });
    await mountDrawer();
    await openWith();
    await click("bulk-review-create");
    expect(text("bulk-review-retry-ingest-f")).toBe("Retry svc-ingest-f");
    api.create.mockClear();
    await click("bulk-review-retry-ingest-f");
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][1].name).toBe("svc-ingest-f-no-data");
  });
});

describe("BulkReviewDrawer — stream fields and org", () => {
  const createButton = () => q("bulk-review-create") as HTMLButtonElement;

  it("says why a row can't be ticked from its stream fields, in red when they couldn't be read", async () => {
    await mountDrawer();
    await openWith(fieldRows(IDS));
    expect(text("bulk-review-cant-no-cluster")).toBe(
      "Stream ingest_c has no cluster field, so this alert can't be limited to cluster cluster-k.",
    );
    expect(text("bulk-review-cant-no-service")).toBe(
      "Stream ingest_d has no service field, so this alert can't be limited to svc-ingest-d.",
    );
    expect(text("bulk-review-cant-unreadable")).toBe(
      "Couldn't read the fields of stream gone_logs, so this alert can't be checked. Reopen the review to try again.",
    );
    expect(q("bulk-review-cant-unreadable")!.className).toContain("text-status-error-text");
    expect(q("bulk-review-cant-no-cluster")!.className).not.toContain("text-status-error-text");
    expect(q("bulk-review-cant-read-b")).toBeNull();
    expect(text("bulk-review-create")).toBe("Add alerts");
  });

  it("measures an errors draft's usual level, and drafts any error when the week has none (F1)", async () => {
    api.schema.mockResolvedValue({
      data: {
        schema: [
          { name: "service_name" },
          { name: "k8s_namespace_name" },
          { name: "level", type: "Utf8" },
        ],
      },
    });
    measureBaseline.mockResolvedValue(null);
    await mountDrawer();
    const [row] = fieldRows(IDS);
    await openWith([{ ...row, key: "errs", kind: "errors", usually: null }]);
    await flushPromises();
    expect(measureBaseline).toHaveBeenCalledTimes(1);
    expect(text("bulk-review-no-usual-errs")).toBe("None in 7 days");
    expect(createButton().disabled).toBe(false);
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="bulk-review-firesWhen-errs"] [data-test="bulk-review-threshold-errs"] input',
    )!;
    input.value = "40";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(createButton().disabled).toBe(false);
    expect(review.reviewRows.value.find((r) => r.key === "errs")?.threshold).toBe(40);
  });

  it("shows a measuring row's wait in its Fires when cell, not as a line that later goes (T5-N5)", async () => {
    api.schema.mockResolvedValue({
      data: {
        schema: [
          { name: "service_name" },
          { name: "k8s_namespace_name" },
          { name: "level", type: "Utf8" },
        ],
      },
    });
    measureBaseline.mockReturnValue(new Promise(() => undefined));
    await mountDrawer();
    const [row] = fieldRows(IDS);
    await openWith([{ ...row, key: "errs", kind: "errors", usually: null }]);
    await flushPromises();
    expect(q("bulk-review-cant-errs")).toBeNull();
    const wait = q("bulk-review-measuring-errs")!;
    expect(q("bulk-review-firesWhen-errs")!.contains(wait)).toBe(true);
    expect(wait.getAttribute("aria-label")).toBe("Measuring the usual level over the last 7 days…");
  });

  it("keeps a row one line tall when its week has no usual level (T5-N5)", async () => {
    api.schema.mockResolvedValue({
      data: {
        schema: [
          { name: "service_name" },
          { name: "k8s_namespace_name" },
          { name: "level", type: "Utf8" },
        ],
      },
    });
    measureBaseline.mockResolvedValue(null);
    await mountDrawer();
    const [row] = fieldRows(IDS);
    await openWith([{ ...row, key: "errs", kind: "errors", usually: null }]);
    await flushPromises();
    const service = document.querySelector(
      '[data-test="bulk-review-service-errs"]',
    )!.parentElement!;
    expect(service.querySelector('[data-test="bulk-review-threshold-errs"]')).toBeNull();
    expect(q("bulk-review-cant-errs")).toBeNull();
    const field = q("bulk-review-threshold-errs")!;
    expect(field.querySelector("label")).toBeNull();
    const input = field.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Fire above");
    expect(input.getAttribute("placeholder")).toBe("Set value");
    expect(input.value).toBe("0");
    expect(wrapper!.findComponent('[data-test="bulk-review-threshold-errs"]').props("size")).toBe(
      "xs",
    );
    expect(text("bulk-review-no-usual-errs")).toBe("None in 7 days");
  });

  it("gives Service only the room the sized columns leave, so no line pushes Usually off the drawer (V-N1)", async () => {
    await mountDrawer();
    await openWith(fieldRows(IDS).slice(0, 1));
    const columns = wrapper!.findComponent({ name: "OTable" }).props("columns") as {
      id: string;
      meta?: { cellClass?: string };
    }[];
    expect(columns.find((c) => c.id === "service")?.meta?.cellClass).toContain("max-w-0");
  });

  it("keeps Create off while a ticked row waits for its stream fields", async () => {
    let answer!: (value: unknown) => void;
    api.schema.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await mountDrawer();
    await openWith(fieldRows(IDS).slice(0, 1));
    // The wait sits in the Fires when cell, so the row stays one line while its fields load (T5-N5).
    expect(q("bulk-review-cant-read-b")).toBeNull();
    const wait = q("bulk-review-measuring-read-b")!;
    expect(q("bulk-review-firesWhen-read-b")!.contains(wait)).toBe(true);
    expect(wait.getAttribute("aria-label")).toBe("Checking the stream's fields…");
    expect(text("bulk-review-rule")).toContain("no rows for 15 min");
    expect(text("bulk-review-footer")).toContain("1 alert will be created in folder ingest.");
    expect(text("bulk-review-create")).toBe("Add alerts");
    expect(createButton().disabled).toBe(true);
    answer({ data: { schema: [{ name: "service_name" }, { name: "k8s_namespace_name" }] } });
    await flushPromises();
    expect(q("bulk-review-cant-read-b")).toBeNull();
    expect(createButton().disabled).toBe(false);
  });

  it("hides the earlier batch's Undo while a new review is open, and shows it again after", async () => {
    const undoToasts = () => toastRecords.filter((r) => r.open && r.action);
    api.create.mockImplementation((_org: string, body: any) =>
      Promise.resolve({ data: { id: `id-${body.name}` } }),
    );
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    await click("bulk-review-create");
    expect(review.state.open).toBe(false);
    expect(undoToasts().map((r) => r.message)).toEqual([
      "1 alert created in folder ingest. Undo works until you leave this page.",
    ]);
    await openWith(m12Rows(IDS).slice(1, 2));
    expect(undoToasts()).toHaveLength(0);
    await click("bulk-review-cancel");
    expect(undoToasts().map((r) => r.message)).toEqual([
      "1 alert created in folder ingest. Undo works until you leave this page.",
    ]);
    undoToasts()[0].action!.handler();
    await flushPromises();
    expect(api.remove.mock.calls.map((c) => c[1])).toEqual(["id-svc-ingest-b-no-data"]);
    dismissAll();
  });

  it("closes the review when the org changes, and sends nothing to the new org", async () => {
    await mountDrawer();
    await openWith();
    store.state.selectedOrganization.identifier = "other-org";
    await flushPromises();
    expect(review.state.open).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });
});

describe("BulkReviewDrawer — focus and edition", () => {
  it("moves focus into the drawer on open and back to the opener on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    await mountDrawer();
    await openWith(m12Rows(IDS), opener);
    const drawer = q("bulk-review-drawer")!;
    expect(drawer.contains(document.activeElement)).toBe(true);
    // jsdom fires no closeAutoFocus, so the hand-back target is read off the drawer (Playwright covers the real close).
    const returnFocusTo = wrapper!
      .findComponent(ODrawer)
      .props("returnFocusTo") as () => HTMLElement;
    expect(returnFocusTo()).toBe(opener);
  });

  it("mounts nothing and opens nothing without enterprise", async () => {
    config.isEnterprise = "false";
    await mountDrawer();
    await openWith();
    expect(review.state.open).toBe(false);
    expect(q("bulk-review-drawer")).toBeNull();
    review.state.request = { kind: "no_data", rows: m12Rows(IDS) };
    review.state.open = true;
    await flushPromises();
    expect(q("bulk-review-drawer")).toBeNull();
    expect(q("bulk-review-title")).toBeNull();
  });
});

const reach = (incidents: boolean, oncall: boolean, pagesOncall?: boolean) => {
  const { incidents_page_oncall: _drop, ...rest } = store.state.zoConfig ?? {};
  store.state.zoConfig = {
    ...rest,
    incidents_enabled: incidents,
    oncall_enabled: oncall,
    ...(pagesOncall === undefined ? {} : { incidents_page_oncall: pagesOncall }),
  };
};

describe("BulkReviewDrawer: a group with no destination says who it reaches", () => {
  const lonely = {
    key: "lonely",
    scope: {
      service: "svc-lonely",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "app_logs" },
      schema: ["_timestamp", "service_name"],
    },
    usually: null,
  };
  const reachPart = () =>
    [...q("bulk-review-group-meta-__no_team__")!.querySelectorAll("span")].find((span) =>
      /on-call|no one/.test(span.textContent ?? ""),
    )!;

  it("with incidents paging on-call, the group reads as reaching on-call, in neutral text", async () => {
    reach(true, true);
    await mountDrawer();
    await openWith([lonely]);
    expect(text("bulk-review-group-meta-__no_team__")).toContain(
      "pages on-call through an incident",
    );
    expect(reachPart().className).not.toMatch(/status-(warning|error)-text/);
  });

  it("with incidents off, the group notifies no one, in the red of a failure", async () => {
    reach(false, true);
    await mountDrawer();
    await openWith([lonely]);
    expect(reachPart().textContent?.trim()).toBe("notifies no one");
    expect(reachPart().className).toContain("text-status-error-text");
  });

  it("a group where only some rows notify a destination says how many (T2-9)", async () => {
    reach(true, true);
    await mountDrawer();
    await openWith([
      lonely,
      { ...lonely, key: "lonely-2", notify: { destinations: ["legacy-pager"], reason: "none" } },
    ] as never);
    expect(text("bulk-review-group-meta-__no_team__")).toContain("1 of 2 notify legacy-pager");
  });
});

describe("BulkReviewDrawer — AutoObserve is the destination", () => {
  const orphan = (key: string, alertIds?: string[]) => ({
    key,
    scope: {
      service: "svc-a",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "app_logs" },
      schema: ["service_name", "k8s_namespace_name"],
    },
    usually: 40,
    notify: { destinations: [] as [], reason: "none" as const },
    ...(alertIds ? { alertIds } : {}),
  });

  it("with incidents paging on-call, rows with no destination can be added, with a neutral line", async () => {
    reach(true, true);
    await mountDrawer();
    await openWith([orphan("a-1"), orphan("a-2"), ...m12Rows(IDS).slice(0, 1)]);
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(false);
    expect(q("bulk-review-no-destination")).toBeNull();
    const line = q("bulk-review-via-incident")!;
    expect(line.textContent?.trim()).toBe(
      "No destination for 2 alerts: each opens an incident, and the incident pages on-call.",
    );
    expect(line.className).not.toMatch(/status-(warning|error)-text/);
    expect(text("bulk-review-footer")).toContain("3 alerts will be created");
  });

  it("counts only rows Add would send, not one still waiting for its stream fields", async () => {
    reach(false, true);
    api.schema.mockImplementation((_org: string, name: string) =>
      name === "slow_logs"
        ? new Promise(() => undefined)
        : Promise.resolve({ data: { schema: [{ name: "service_name" }] } }),
    );
    const waiting = {
      ...orphan("a-3"),
      scope: {
        ...orphan("a-3").scope,
        stream: { type: "logs", name: "slow_logs" },
        schema: undefined,
      },
    };
    await mountDrawer();
    await openWith([orphan("a-1"), waiting] as never);
    expect(text("bulk-review-no-destination")).toContain("Choose a destination for this alert.");
  });

  it("with incidents off, a ticked row with no destination blocks Add with the red line naming what is off", async () => {
    reach(false, true);
    await mountDrawer();
    await openWith([orphan("a-1"), orphan("a-2"), ...m12Rows(IDS).slice(0, 1)]);
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(true);
    const reason = q("bulk-review-no-destination")!;
    expect(reason.textContent?.trim()).toBe(
      "Choose a destination for these 2 alerts. Incidents are off in this organization, so an alert with no destination reaches no one.",
    );
    expect(reason.className).toContain("text-status-error-text");
    expect(text("bulk-review-footer")).toBe("");
  });

  it("in an org with no on-call team, Add is blocked in red with a way to set up on-call (F1)", async () => {
    reach(true, true, false);
    await mountDrawer();
    await openWith([orphan("a-1"), orphan("a-2"), ...m12Rows(IDS).slice(0, 1)]);
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(true);
    expect(q("bulk-review-via-incident")).toBeNull();
    const reason = q("bulk-review-no-destination")!;
    expect(reason.className).toContain("text-status-error-text");
    expect(reason.textContent).toContain(
      "Choose a destination for these 2 alerts, or set up on-call. This organization has no on-call team, so their incidents page no one.",
    );
    expect(text("bulk-review-setup-oncall")).toBe("Set up on-call");
    expect(text("bulk-review-group-meta-__no_team__")).toContain("notifies no one");
    reach(true, true);
  });

  it("sets up on-call in a new tab and checks again without losing the review", async () => {
    reach(true, true, false);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await mountDrawer();
    await openWith([orphan("a-1"), orphan("a-2")]);
    await click("bulk-review-setup-oncall");
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("oncall/teams"),
      "_blank",
      "noopener",
    );
    expect(review.state.open).toBe(true);
    api.configFull.mockResolvedValue({
      data: { ...store.state.zoConfig, incidents_page_oncall: true },
    });
    expect(text("bulk-review-check-oncall")).toBe("Check again");
    await click("bulk-review-check-oncall");
    expect(api.configFull).toHaveBeenCalledWith("demo-org");
    expect(q("bulk-review-no-destination")).toBeNull();
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(false);
    open.mockRestore();
    reach(true, true);
  });

  it("with on-call off, the red line says on-call is off", async () => {
    reach(true, false);
    await mountDrawer();
    await openWith([orphan("a-1")]);
    expect(text("bulk-review-no-destination")).toContain("On-call is off in this organization");
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(true);
  });

  it("choosing a destination for the group enables Add and brings back the count", async () => {
    reach(false, false);
    await mountDrawer();
    await openWith([orphan("a-1"), orphan("a-2")]);
    const group = review.groups.value[0];
    const { changeGroup } = await import("./useBulkReview");
    changeGroup(group, { id: "default", name: "default" }, ["ops-webhook"]);
    await flushPromises();
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(false);
    expect(q("bulk-review-no-destination")).toBeNull();
    expect(text("bulk-review-footer")).toContain("2 alerts will be created");
  });

  it("unticking the rows that notify no one also enables Add", async () => {
    reach(false, false);
    await mountDrawer();
    await openWith([orphan("a-1"), ...m12Rows(IDS).slice(0, 1)]);
    const { toggleRow } = await import("./useBulkReview");
    toggleRow("a-1", false);
    await flushPromises();
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(false);
  });

  it("fills folder and destination from the service's own alerts", async () => {
    api.list.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "al-1",
            folder_id: "f-pay",
            folder_name: "payments",
            destinations: ["payments-oncall"],
          },
          {
            alert_id: "al-2",
            folder_id: "f-pay",
            folder_name: "payments",
            destinations: ["payments-oncall"],
          },
          { alert_id: "other", folder_id: "f-ingest", folder_name: "ingest", destinations: ["x"] },
        ],
      },
    });
    await mountDrawer();
    await openWith([orphan("a-1", ["al-1", "al-2"])]);
    const row = review.reviewRows.value[0];
    expect(row.destinations).toEqual(["payments-oncall"]);
    expect(row.folder.id).toBe("f-pay");
    expect(row.row.notify?.reason).toBe("svc-a's 2 alerts notify payments-oncall.");
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(false);
  });

  it("takes the folder of the service's own alerts even when they notify no one (T2-10)", async () => {
    api.list.mockResolvedValue({
      data: {
        list: [{ alert_id: "al-1", folder_id: "f-pay", folder_name: "payments", destinations: [] }],
      },
    });
    await mountDrawer();
    await openWith([orphan("a-1", ["al-1"])]);
    const row = review.reviewRows.value[0];
    expect(row.folder.id).toBe("f-pay");
    expect(row.teamName).toBe("payments");
    expect(row.destinations).toEqual([]);
  });

  it("keeps the block when the service's alerts notify no one either and incidents are off", async () => {
    reach(false, false);
    api.list.mockResolvedValue({
      data: { list: [{ alert_id: "al-1", folder_id: "f-pay", destinations: [] }] },
    });
    await mountDrawer();
    await openWith([orphan("a-1", ["al-1"])]);
    expect(review.reviewRows.value[0].destinations).toEqual([]);
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("BulkReviewDrawer — drafts the org already has", () => {
  const existing = (name: string, folder: string, folderName: string, id: string) => ({
    alert_id: id,
    name,
    folder_id: folder,
    folder_name: folderName,
    stream_type: "logs",
    stream_name: "other",
    condition: { sql: "SELECT 1" },
  });

  it("shows an added draft as Already added with a link, unticked and left out of Add", async () => {
    api.list.mockResolvedValue({
      data: { list: [existing("svc-ingest-b-no-data", "f-ingest", "ingest", "al-b")] },
    });
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 2));
    expect(text("bulk-review-exists-ingest-b")).toContain(
      "Already added as svc-ingest-b-no-data in folder ingest.",
    );
    expect((q("bulk-review-tick-ingest-b") as HTMLElement).querySelector("button")?.disabled).toBe(
      true,
    );
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["ingest-c"]);
    expect(text("bulk-review-footer")).toBe(
      "1 alert will be created in folder ingest. 1 was already added and is left out. Each description says it came from an AutoObserve suggestion.",
    );
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    await click("bulk-review-open-added-ingest-b");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alertList",
        query: expect.objectContaining({ alert_id: "al-b", folder: "f-ingest", action: "update" }),
      }),
    );
    push.mockRestore();
    expect(review.state.open).toBe(false);
  });

  it("counts only the rows Add can send in the group header, as the footer does", async () => {
    api.list.mockResolvedValue({
      data: { list: [existing("svc-ingest-b-no-data", "f-ingest", "ingest", "al-b")] },
    });
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 2));
    const meta = () => text("bulk-review-group-meta-team-ingest").split(" · ").at(-1);
    const press = async (test: string) => {
      q(test)!.querySelector("button")!.click();
      await flushPromises();
    };
    expect(meta()).toBe("1");
    await press("bulk-review-tick-ingest-c");
    expect(meta()).toBe("0 of 1 ticked");
    expect(text("bulk-review-footer")).toBe(
      "Nothing is ticked, so nothing will be created. 1 was already added and is left out.",
    );
    await press("bulk-review-group-tick-team-ingest");
    expect(meta()).toBe("1");
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["ingest-c"]);
  });

  it("the user's screen: a quiet service's errors row is ticked at any error beside an added one, and Add works", async () => {
    api.list.mockResolvedValue({
      data: { list: [existing("svc-ingest-b-no-data", "f-ingest", "ingest", "al-b")] },
    });
    api.schema.mockResolvedValue({
      data: { schema: [{ name: "service_name" }, { name: "level", type: "Utf8" }] },
    });
    measureBaseline.mockResolvedValue(null);
    await mountDrawer();
    const [added, other] = m12Rows(IDS).slice(0, 2);
    const { schema: _schema, ...scope } = other.scope as typeof other.scope & { schema?: string[] };
    await openWith([added, { ...other, scope, key: "errs", kind: "errors", usually: null }]);
    await flushPromises();
    const meta = () => text("bulk-review-group-meta-team-ingest").split(" · ").at(-1);
    expect(text("bulk-review-no-usual-errs")).toBe("None in 7 days");
    expect(text("bulk-review-group-team-ingest")).toContain("Owner: ingest");
    expect(meta()).toBe("1");
    expect(text("bulk-review-footer")).toContain(
      "1 alert will be created in folder ingest. 1 was already added and is left out.",
    );
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(false);
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="bulk-review-firesWhen-errs"] [data-test="bulk-review-threshold-errs"] input',
    )!;
    expect(input.value).toBe("0");
    input.value = "";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(meta()).toBe("0 of 1 ticked");
    expect(text("bulk-review-footer")).toBe(
      "1 alert needs a threshold before it can be added. Nothing is ticked, so nothing will be created. 1 was already added and is left out.",
    );
    input.value = "40";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(meta()).toBe("1");
  });

  it("says a group has nothing to add and disables its tick when every row was already added", async () => {
    api.list.mockResolvedValue({
      data: {
        list: [
          existing("svc-ingest-b-no-data", "f-ingest", "ingest", "al-b"),
          existing("svc-ingest-c-no-data", "f-ingest", "ingest", "al-c"),
        ],
      },
    });
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 2));
    expect(text("bulk-review-group-meta-team-ingest").split(" · ").at(-1)).toBe("nothing to add");
    expect(q("bulk-review-group-tick-team-ingest")!.querySelector("button")!.disabled).toBe(true);
  });

  it("disables Add with the reason when every draft was already added", async () => {
    api.list.mockResolvedValue({
      data: {
        list: [
          existing("svc-ingest-b-no-data", "f-ingest", "ingest", "al-b"),
          existing("svc-ingest-c-no-data", "f-ingest", "ingest", "al-c"),
        ],
      },
    });
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 2));
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(true);
    expect(text("bulk-review-footer")).toBe(
      "All 2 alerts in this list were already added, so there's nothing to add.",
    );
  });

  it("says in red that nothing can be checked when the alerts list fails", async () => {
    api.list.mockRejectedValue(httpError(500));
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    expect((q("bulk-review-create") as HTMLButtonElement).disabled).toBe(true);
    const line = q("bulk-review-cant-ingest-b")!;
    expect(line.className).toContain("text-status-error-text");
    expect(line.textContent).toContain("Couldn't read your alerts");
  });
});
