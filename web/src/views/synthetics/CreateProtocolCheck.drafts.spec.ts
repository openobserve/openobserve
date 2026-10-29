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
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import syntheticsService from "@/services/synthetics";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import type { ProtocolCheck } from "@/types/synthetics";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import CreateProtocolCheck from "./CreateProtocolCheck.vue";

vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getLocations: vi.fn(() => Promise.resolve({ data: { locations: [] } })),
      create: vi.fn(() => Promise.resolve({ data: { id: "created-1" } })),
      update: vi.fn(() => Promise.resolve({})),
      get: vi.fn(),
    },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(() => Promise.resolve({ data: [] })) },
  });
});
vi.mock("@/utils/commons", () => ({ getFoldersListByType: vi.fn(() => Promise.resolve([])) }));

const newScope: EditorDraftScope = {
  kind: "synthetic_check",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "chk-1" };
const httpScope: EditorDraftScope = { ...newScope, variant: "http" };

const savedCheck = (): ProtocolCheck => ({
  checkType: "http",
  name: "API health",
  url: "https://api.test/health",
  enabled: true,
  folder: "default",
  tags: [],
  journey: [],
  schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
  locations: [],
  notifications: { destinations: [] },
  rum: { collect: false, sessionReplay: false },
  capture: { screenshot: "off", trace: "off" },
  auth: { type: "basic", username: "bot", password: "s3cret" },
  headers: [{ id: "h1", key: "X-Team", value: "team-key" }],
  http: {
    method: "GET",
    headers: [],
    body: "",
    follow_redirects: true,
    timeout_ms: 10000,
    assertions: [],
  },
});

let router: Router;
let wrapper: VueWrapper | null = null;
let routeProps: { checkType: ProtocolCheck["checkType"]; editId?: string };

const EditorRoute = defineComponent({
  setup: () => () => h(CreateProtocolCheck, routeProps),
});

const mountEditor = async (
  props: typeof routeProps = { checkType: "http" },
  stubs: Record<string, unknown> = {},
) => {
  routeProps = props;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/synthetics/add", name: "syntheticsAdd", component: EditorRoute },
      { path: "/synthetics", name: "synthetics", component: { render: () => h("div") } },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push("/synthetics/add");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, router, store],
        stubs: {
          CheckConfigure: true,
          CheckHttpConfig: true,
          CheckTcpConfig: true,
          CheckTlsConfig: true,
          CheckSshConfig: true,
          AgentSetupDrawer: true,
          ...stubs,
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
};

const configure = () => wrapper!.findComponent({ name: "CheckConfigure" });

/** An edit as the configure card makes it, after the author's first input. */
const edit = async (patch: Partial<ProtocolCheck>) => {
  window.dispatchEvent(new Event("pointerdown"));
  const current = configure().props("check") as ProtocolCheck;
  configure().vm.$emit("update:check", { ...current, ...patch });
  await flushPromises();
};

describe("CreateProtocolCheck drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(syntheticsService.get).mockResolvedValue({ data: savedCheck() } as never);
    vi.mocked(syntheticsService.create).mockClear();
    vi.mocked(syntheticsService.update).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new check's draft on pagehide with the auth credentials blanked", async () => {
    await mountEditor();
    await edit({
      name: "Checkout",
      auth: { type: "basic", username: "bot", password: "hunter2" },
      headers: [{ id: "h1", key: "X-Session", value: "abc" }],
      http: {
        method: "GET",
        headers: [{ name: "Cookie", value: "sid=plain" }],
        body: "",
        follow_redirects: true,
        timeout_ms: 10000,
        assertions: [],
      },
    });
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<ProtocolCheck>(httpScope);
    expect(JSON.stringify(draft)).not.toContain("sid=plain");
    expect(draft?.data.http?.headers).toEqual([{ name: "Cookie", value: "" }]);
    expect(draft?.data).toMatchObject({
      name: "Checkout",
      auth: { username: "bot", password: "" },
      headers: [{ key: "X-Session", value: "" }],
    });
    expect(draft?.redactedPaths).toEqual(
      expect.arrayContaining(["/auth/password", "/headers/0/value", "/http/headers/0/value"]),
    );
  });

  it("drafts a name filled with no key or pointer event, and leaving asks", async () => {
    await mountEditor({ checkType: "http" }, { CheckConfigure: false });
    await fillField("synthetics-check-details-name-input", "Autofilled check");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<ProtocolCheck>(httpScope)?.data.name).toBe("Autofilled check");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-close-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("syntheticsAdd");
  });

  it("Escape on the restore dialog keeps the draft, Start fresh drops it", async () => {
    writeEditorDraft(httpScope, { data: { ...savedCheck(), name: "From draft" } });
    await mountEditor();
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect((configure().props("check") as ProtocolCheck).name).toBe("");
    expect(readEditorDraft(httpScope)).not.toBeNull();
    wrapper!.unmount();

    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect((configure().props("check") as ProtocolCheck).name).toBe("");
    expect(readEditorDraft(httpScope)).toBeNull();
  });

  it("continues a new check's draft and warns that credentials were not kept", async () => {
    writeEditorDraft(httpScope, {
      data: { ...savedCheck(), name: "From draft" },
      redactedPaths: ["/auth/password"],
    });
    await mountEditor();

    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this synthetic check",
    );
    expect(byTest("editor-draft-credentials-not-saved")).not.toBeNull();
    click("editor-draft-continue");
    await flushPromises();

    expect((configure().props("check") as ProtocolCheck).name).toBe("From draft");
  });

  it("keeps each type's new-check draft apart, so another type's draft is never offered", async () => {
    writeEditorDraft(httpScope, { data: { ...savedCheck(), name: "Was HTTP" } });
    await mountEditor({ checkType: "tcp" });
    expect(byTest("editor-draft-restore-dialog")).toBeNull();

    await edit({ name: "TCP work" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<ProtocolCheck>(httpScope)?.data.name).toBe("Was HTTP");
    expect(readEditorDraft<ProtocolCheck>({ ...newScope, variant: "tcp" })?.data.name).toBe(
      "TCP work",
    );
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("keys an edited check's draft by its id and restores its stored password", async () => {
    await mountEditor({ checkType: "http", editId: "chk-1" });
    await edit({ name: "Renamed" });
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<ProtocolCheck>(editScope);
    expect(draft?.data.name).toBe("Renamed");
    expect(draft?.data.auth?.password).toBe("");
    expect(draft?.baseHash).toMatch(/^[0-9a-f]{8}$/);
    wrapper!.unmount();

    await mountEditor({ checkType: "http", editId: "chk-1" });
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    click("editor-draft-continue");
    await flushPromises();
    expect(configure().props("check")).toMatchObject({
      name: "Renamed",
      auth: { password: "s3cret" },
      headers: [{ value: "team-key" }],
    });
  });

  it("restores a header's stored value by its name after a header was deleted", async () => {
    vi.mocked(syntheticsService.get).mockResolvedValue({
      data: {
        ...savedCheck(),
        headers: [
          { id: "h1", key: "Authorization", value: "tokA" },
          { id: "h2", key: "X-Api-Key", value: "tokB" },
        ],
      },
    } as never);
    await mountEditor({ checkType: "http", editId: "chk-1" });
    const headers = (configure().props("check") as ProtocolCheck).headers ?? [];
    await edit({ headers: headers.slice(1) });
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor({ checkType: "http", editId: "chk-1" });
    click("editor-draft-continue");
    await flushPromises();
    expect((configure().props("check") as ProtocolCheck).headers).toEqual([
      expect.objectContaining({ key: "X-Api-Key", value: "tokB" }),
    ]);
  });

  it("a changed password comes back blank, flagged, and blocks Save until typed again", async () => {
    await mountEditor({ checkType: "http", editId: "chk-1" });
    await edit({ auth: { type: "basic", username: "bot", password: "changed" } });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)?.changedRedactedPaths).toEqual(["/auth/password"]);
    wrapper!.unmount();

    await mountEditor({ checkType: "http", editId: "chk-1" });
    click("editor-draft-continue");
    await flushPromises();
    expect((configure().props("check") as ProtocolCheck).auth?.password).toBe("");
    expect(configure().props("validationErrors")).toMatchObject({
      "auth.password": "Re-enter this value: your change was not kept in the draft.",
    });

    await wrapper!.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(syntheticsService.update).not.toHaveBeenCalled();

    await edit({ auth: { type: "basic", username: "bot", password: "typed again" } });
    expect(configure().props("validationErrors")).not.toHaveProperty("auth.password");
    await wrapper!.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(syntheticsService.update).toHaveBeenCalledTimes(1);
  });

  it("a target URL carrying a token is never stored, is named on restore, and blocks Save", async () => {
    await mountEditor({ checkType: "http", editId: "chk-1" });
    await edit({ url: "https://api.test/health?api_key=k3y-123" });
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.stringify(localStorage)).not.toContain("k3y-123");
    expect(readEditorDraft(editScope)?.changedRedactedPaths).toEqual(["/url"]);
    wrapper!.unmount();

    await mountEditor({ checkType: "http", editId: "chk-1" });
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "Your change to the URL was not kept.",
    );
    click("editor-draft-continue");
    await flushPromises();
    expect((configure().props("check") as ProtocolCheck).url).toBe("");
    expect(configure().props("validationErrors")).toMatchObject({
      url: "Re-enter this value: your change was not kept in the draft.",
    });
    await wrapper!.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(syntheticsService.update).not.toHaveBeenCalled();

    await edit({ url: "https://api.test/health" });
    await wrapper!.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(syntheticsService.update).toHaveBeenCalledTimes(1);
  });

  it("an unchanged target URL with a query string comes back from the saved check", async () => {
    vi.mocked(syntheticsService.get).mockResolvedValue({
      data: { ...savedCheck(), target: "https://api.test/health?token=t0k" },
    } as never);
    await mountEditor({ checkType: "http", editId: "chk-1" });
    await edit({ name: "Renamed" });
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.stringify(localStorage)).not.toContain("t0k");
    wrapper!.unmount();

    await mountEditor({ checkType: "http", editId: "chk-1" });
    click("editor-draft-continue");
    await flushPromises();
    expect(configure().props("check")).toMatchObject({
      name: "Renamed",
      url: "https://api.test/health?token=t0k",
    });
  });

  it("a changed request header is named on restore, flagged on its value and blocks Save", async () => {
    vi.mocked(syntheticsService.get).mockResolvedValue({
      data: {
        ...savedCheck(),
        http: { ...savedCheck().http!, headers: [{ name: "X-Signature", value: "sig-1" }] },
      },
    } as never);
    // Renders the type card slot, so the real HTTP card shows the flag.
    const withTypeCard = {
      CheckHttpConfig: false,
      CheckConfigure: {
        name: "CheckConfigure",
        props: ["check", "validationErrors"],
        emits: ["update:check"],
        template: '<div><slot name="type-config" /></div>',
      },
    };
    const props = { checkType: "http" as const, editId: "chk-1" };
    await mountEditor(props, withTypeCard);
    const current = configure().props("check") as ProtocolCheck;
    await edit({ http: { ...current.http!, headers: [{ name: "X-Signature", value: "sig-2" }] } });
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.stringify(readEditorDraft(editScope))).not.toContain("sig-2");
    wrapper!.unmount();

    await mountEditor(props, withTypeCard);
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "X-Signature header",
    );
    click("editor-draft-continue");
    await flushPromises();
    const value = wrapper!.find('[data-test="synthetics-check-http-header-value-0"]');
    expect(value.exists()).toBe(true);
    expect(wrapper!.text()).toContain(
      "Re-enter this value: your change was not kept in the draft.",
    );

    await wrapper!.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(syntheticsService.update).not.toHaveBeenCalled();
  });

  it("save from the leave dialog on a check deleted meanwhile lets the leave go on", async () => {
    await mountEditor({ checkType: "http", editId: "chk-1" });
    await edit({ name: "Gone" });
    window.dispatchEvent(new Event("pagehide"));
    vi.mocked(syntheticsService.update).mockRejectedValueOnce({ response: { status: 404 } });

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("warns when the check changed on the server after the draft was written", async () => {
    writeEditorDraft(editScope, { data: savedCheck(), baseHash: "00000000" });
    await mountEditor({ checkType: "http", editId: "chk-1" });

    expect(byTest("editor-draft-changed-on-server")?.textContent).toContain(
      "was changed after your draft was saved",
    );
  });

  it("save from the leave dialog saves without navigating, then the leave goes on", async () => {
    await mountEditor();
    await edit({ name: "Leaving" });

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(syntheticsService.create).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(httpScope)).toBeNull();
  });

  it("keep draft leaves and keeps the work, discard leaves and drops it", async () => {
    await mountEditor();
    await edit({ name: "Kept" });
    const keep = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-secondary-btn");
    await keep;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<ProtocolCheck>(httpScope)?.data.name).toBe("Kept");
    wrapper!.unmount();

    await mountEditor();
    click("editor-draft-continue");
    await flushPromises();
    const discard = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-neutral-btn");
    await discard;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(httpScope)).toBeNull();
  });

  it("a normal save drops the draft and returns to the list without asking", async () => {
    await mountEditor();
    await edit({ name: "Saved" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(httpScope)).not.toBeNull();

    await wrapper!.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();

    expect(syntheticsService.create).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(httpScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });
});
