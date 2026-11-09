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

describe("BulkReviewDrawer — results", () => {
  it("locks an open group editor across Create and partial failure", async () => {
    let reject!: (reason: unknown) => void;
    api.create.mockReturnValue(new Promise((_resolve, fail) => (reject = fail)));
    await mountDrawer();
    await openWith(m12Rows(IDS).slice(0, 1));
    await click("bulk-review-group-change-team-ingest");
    const header = wrapper!.findComponent({ name: "BulkReviewGroupHeader" });
    const selects = header.findAllComponents({ name: "OSelect" });
    selects[0].vm.$emit("update:modelValue", "f-pay");
    selects[1].vm.$emit("update:modelValue", []);
    await flushPromises();
    await click("bulk-review-create");
    const assertFrozen = async () => {
      for (const select of selects) expect(select.props("disabled")).toBe(true);
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

  it("measures an errors draft's usual level, and asks for a threshold when the week has none (F1)", async () => {
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
    expect(text("bulk-review-cant-errs")).toBe(
      "AutoObserve found no usual error count for svc-ingest-b over the last 7 days. Set a threshold to add this alert.",
    );
    expect(createButton().disabled).toBe(true);
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="bulk-review-threshold-errs"] input',
    )!;
    input.value = "40";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(createButton().disabled).toBe(false);
    expect(text("bulk-review-firesWhen-errs")).toBe("errors above 40 an hour");
  });

  it("keeps Create off while a ticked row waits for its stream fields", async () => {
    let answer!: (value: unknown) => void;
    api.schema.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await mountDrawer();
    await openWith(fieldRows(IDS).slice(0, 1));
    expect(text("bulk-review-cant-read-b")).toBe("Checking the stream's fields…");
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

describe("BulkReviewDrawer: a group that notifies no one is a warning", () => {
  it("shows notifies no one on the No team yet row in amber, not in the red of a failure", async () => {
    await mountDrawer();
    await openWith([
      {
        key: "lonely",
        scope: {
          service: "svc-lonely",
          cluster: null,
          namespace: null,
          stream: { type: "logs", name: "app_logs" },
          schema: ["_timestamp", "service_name"],
        },
        usually: null,
      },
    ]);
    const meta = q("bulk-review-group-meta-__no_team__");
    expect(text("bulk-review-group-meta-__no_team__")).toContain("notifies no one");
    const part = [...meta!.querySelectorAll("span")].find(
      (span) => span.textContent?.trim() === "notifies no one",
    )!;
    expect(part.className).toContain("text-status-warning-text");
    expect(part.className).not.toContain("text-status-error-text");
  });
});
