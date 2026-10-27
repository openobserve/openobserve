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
import { h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import downtimes from "@/services/downtimes";
import common from "@/services/common";
import { queryClient } from "@/composables/query/queryClient";
import OForm from "@/lib/forms/Form/OForm.vue";
import { defaultDowntimeValues } from "@/utils/downtimes/downtimeForm";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import AddDowntime from "./AddDowntime.vue";

vi.mock("@/composables/downtimes/useDowntimesEnabled", async () => {
  const { computed } = await import("vue");
  return { useDowntimesEnabled: () => computed(() => true) };
});

vi.mock("@/services/downtimes", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    preview: vi.fn(),
    resources: vi.fn(),
    values: vi.fn(() => Promise.resolve({ data: { values: [], partial: false } })),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(() => Promise.resolve({ data: [] })), test: vi.fn() },
}));

vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFoldersListByType: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/services/common", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    ...actual,
    default: { ...actual.default, list_Folders: vi.fn() },
  };
});

const EMPTY_PREVIEW = {
  alerts: [],
  resolved_at_fire_time: [],
  anomalies: [],
  synthetics: [],
  slos: [],
  alerts_total: 0,
  anomalies_total: 0,
  synthetics_total: 0,
  slos_total: 0,
};

const stored = (version: number) => ({
  id: "d1",
  org: "default",
  folder_id: "default",
  name: "Nightly deploy",
  reason: "",
  targets: [{ module: "alerts", folders: { kind: "all" }, ids: ["a1"] }],
  schedule: {
    repeat: "none",
    starts_at: (Date.now() + 3_600_000) * 1000,
    ends_at: (Date.now() + 7_200_000) * 1000,
    timezone: "UTC",
    duration_secs: 3600,
    weekdays: [],
  },
  show_banner: false,
  created_by: "lin",
  created_at: 1,
  updated_by: "lin",
  updated_at: version,
  version,
  status: "scheduled",
  current_window: null,
  next_window: null,
  matched_alerts: 1,
  matched_anomalies: 0,
  matched_synthetics: 0,
  matched_slos: 0,
  affected: { alerts: [], anomalies: [], synthetics: [], slos: [] },
});

const newScope: EditorDraftScope = {
  kind: "downtime",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "d1" };

let router: Router;
let wrapper: VueWrapper | null = null;

const mountAt = async (location: Parameters<Router["push"]>[0]) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/downtimes", name: "downtimes", component: { render: () => h("div") } },
      { path: "/downtimes/add", name: "addDowntime", component: AddDowntime },
      { path: "/downtimes/:id/edit", name: "editDowntime", component: AddDowntime },
      { path: "/downtimes/:id", name: "downtimeDetail", component: { render: () => h("div") } },
    ],
  });
  await router.push(location);
  await router.isReady();
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      global: { plugins: [store, router] },
      attachTo: document.body,
    },
  );
  await flushPromises();
};

const mountNew = () => mountAt({ name: "addDowntime", query: { org_identifier: "default" } });
const mountEdit = () =>
  mountAt({
    name: "editDowntime",
    params: { id: "d1" },
    query: { org_identifier: "default", folder: "default" },
  });

const form = () =>
  (
    wrapper!.findComponent(AddDowntime).findComponent(OForm).vm as unknown as {
      form: { setFieldValue: (k: string, v: unknown) => void };
    }
  ).form;

const typeReason = async (reason: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue("reason", reason);
  await nextTick();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("AddDowntime drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.mocked(common.list_Folders).mockImplementation(
      (_org: string, type: string) =>
        Promise.resolve({
          data: { list: type === "downtimes" ? [{ folderId: "default", name: "default" }] : [] },
        }) as never,
    );
    vi.mocked(downtimes.preview).mockResolvedValue({ data: EMPTY_PREVIEW } as never);
    vi.mocked(downtimes.get).mockReset();
    vi.mocked(downtimes.get).mockResolvedValue({ data: stored(3) } as never);
    vi.mocked(downtimes.update).mockReset();
    vi.mocked(downtimes.update).mockResolvedValue({ data: {} } as never);
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new downtime's draft when the page hides", async () => {
    await mountNew();
    await typeReason("Quarterly failover");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft<{ reason: string }>(newScope)?.data.reason).toBe("Quarterly failover");
  });

  it("offers a new-downtime draft on open and continues it", async () => {
    writeEditorDraft(newScope, {
      data: { ...defaultDowntimeValues(Date.now(), "UTC"), reason: "From the draft" },
    });
    await mountNew();

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain(
      "unsaved changes to this downtime",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    const reason = wrapper!.get('[data-test="add-downtime-reason"]');
    const textarea = reason.element.matches("textarea") ? reason : reason.get("textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("From the draft");
  });

  it("a duplicate neither offers nor overwrites the new-downtime draft, and keeps its own", async () => {
    const newDraft = { ...defaultDowntimeValues(Date.now(), "UTC"), reason: "Unrelated new one" };
    writeEditorDraft(newScope, { data: newDraft });
    const mountDuplicate = () =>
      mountAt({ name: "addDowntime", query: { org_identifier: "default", duplicate: "d1" } });
    await mountDuplicate();
    await vi.waitFor(() =>
      expect(form().state.values).toMatchObject({ name: expect.stringContaining("Nightly") }),
    );
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    await typeReason("Copied window");
    window.dispatchEvent(new Event("pagehide"));
    const duplicateScope = { ...newScope, variant: "clone:d1" };
    expect(readEditorDraft<{ reason: string }>(duplicateScope)?.data.reason).toBe("Copied window");
    expect(readEditorDraft(newScope)?.data).toEqual(newDraft);

    wrapper!.unmount();
    wrapper = null;
    await mountDuplicate();
    await vi.waitFor(() => expect(byTest("editor-draft-restore-dialog")).not.toBeNull());
  });

  it("keys an edit by the downtime id and warns when the stored row moved", async () => {
    await mountEdit();
    await typeReason("Mine");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)?.baseHash).toBeTruthy();
    expect(readEditorDraft(newScope)).toBeNull();
    wrapper!.unmount();
    wrapper = null;

    queryClient.clear();
    vi.mocked(downtimes.get).mockResolvedValue({ data: stored(4) } as never);
    await mountEdit();

    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("continuing an edit draft saves over the newer row, as the warning says", async () => {
    await mountEdit();
    await typeReason("Mine");
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();
    wrapper = null;

    queryClient.clear();
    vi.mocked(downtimes.get).mockResolvedValue({ data: stored(4) } as never);
    await mountEdit();
    await vi.waitFor(() => expect(byTest("editor-draft-continue")).not.toBeNull());
    byTest("editor-draft-continue")!.click();
    await flushPromises();

    await wrapper!.get('[data-test="add-downtime-save"]').trigger("click");
    await vi.waitFor(() => expect(downtimes.update).toHaveBeenCalled(), { timeout: 3000 });

    const body = vi.mocked(downtimes.update).mock.calls[0][2];
    expect(body.reason).toBe("Mine");
    expect(body.version).toBe(4);
  });

  it("drops the draft of a downtime that no longer exists", async () => {
    writeEditorDraft(editScope, { data: { ...defaultDowntimeValues(Date.now(), "UTC") } });
    vi.mocked(downtimes.get).mockRejectedValue({ response: { status: 404 } });
    await mountEdit();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("Cancel with unsaved changes asks; closing stays and Discard leaves without a draft", async () => {
    await mountNew();
    await typeReason("Not yet");
    window.dispatchEvent(new Event("pagehide"));

    await wrapper!.get('[data-test="add-downtime-cancel"]').trigger("click");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("addDowntime");

    await wrapper!.get('[data-test="add-downtime-cancel"]').trigger("click");
    await flushPromises();
    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("downtimes");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog saves the edit and goes where the user was heading", async () => {
    await mountEdit();
    await typeReason("Patched");

    const navigation = router.push({ name: "downtimeDetail", params: { id: "d1" } });
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(downtimes.update).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("downtimeDetail");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("a normal save drops the draft and returns to the list without asking", async () => {
    await mountEdit();
    await typeReason("Saved normally");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    await wrapper!.get('[data-test="add-downtime-save"]').trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("downtimes"), {
      timeout: 3000,
    });

    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(editScope)).toBeNull();
  });
});
