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
import { defineComponent, h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import destinationService from "@/services/alert_destination";
import OForm from "@/lib/forms/Form/OForm.vue";
import {
  editorDraftKey,
  readEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import AddDestination from "./AddDestination.vue";

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      test: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    },
  });
});
vi.mock("@/services/users", () => ({
  default: {
    orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getRoles: vi.fn().mockResolvedValue({ data: [] }),
  },
}));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

interface DestinationForm {
  state: { values: Record<string, unknown> & { apiHeaders: { key: string; value: string }[] } };
  setFieldValue: (k: string, v: unknown) => void;
}

const newScope: EditorDraftScope = {
  kind: "alert_destination",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "snow_ops" };

const templates = [{ name: "plain_http", body: "{}", type: "http" }];

const serviceNow = {
  name: "snow_ops",
  type: "http",
  destination_type_name: "servicenow",
  url: "https://acme.service-now.com",
  method: "post",
  template: "prebuilt_servicenow",
  headers: {
    Authorization: `Basic ${btoa("bot:hunter2")}`,
    "X-Team-Secret": "team-s3cret",
    "X-Region": "eu-west",
  },
  metadata: JSON.stringify({ credential_assignmentGroup: "noc" }),
};

let router: Router;
let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown>;
const emitted = { cancel: 0, refresh: 0 };

const EditorRoute = defineComponent({
  setup() {
    return () =>
      h(AddDestination, {
        templates,
        destination: null,
        isAlerts: true,
        ...editorProps,
        "onCancel:hideform": () => emitted.cancel++,
        "onGet:destinations": () => emitted.refresh++,
      });
  },
});

const mountEditor = async (props: Record<string, unknown> = {}) => {
  editorProps = props;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alert-destinations", name: "alertDestinations", component: EditorRoute },
      { path: "/alert-templates", name: "alertTemplates", component: { render: () => h("div") } },
    ],
  });
  await router.push({
    name: "alertDestinations",
    query: props.destination ? { action: "update", name: "snow_ops" } : { action: "add" },
  });
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, store, router],
        stubs: {
          PrebuiltDestinationSelector: true,
          AddUser: true,
          DestinationPreview: true,
          SlackDestinationSetup: true,
          SlackAppDestinationForm: true,
        },
      },
    },
  );
  await flushPromises();
};

const remount = async (props: Record<string, unknown> = {}) => {
  wrapper?.unmount();
  wrapper = null;
  await mountEditor(props);
};

const form = () =>
  (
    wrapper!.findComponent(AddDestination).findComponent(OForm).vm as unknown as {
      form: DestinationForm;
    }
  ).form;

const edit = async (values: Record<string, unknown>) => {
  window.dispatchEvent(new Event("pointerdown"));
  Object.entries(values).forEach(([field, value]) => form().setFieldValue(field, value));
  await nextTick();
};

const fillCustomWebhook = () =>
  edit({
    destination_type: "custom",
    type: "http",
    name: "ops_hook",
    template: "plain_http",
    url: "https://hooks.example.com/notify?token=very-secret-token",
    apiHeaders: [
      { key: "Authorization", value: "Bearer s3cr3t-token" },
      { key: "X-Routing-Key", value: "rk-12345" },
    ],
  });

const storedRaw = (scope: EditorDraftScope) => localStorage.getItem(editorDraftKey(scope)) ?? "";

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("AddDestination drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    emitted.cancel = 0;
    emitted.refresh = 0;
    vi.mocked(destinationService.create).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("never writes header values or the webhook URL to storage", async () => {
    await mountEditor();
    await fillCustomWebhook();
    window.dispatchEvent(new Event("pagehide"));

    const raw = storedRaw(newScope);
    expect(raw).toContain("X-Routing-Key");
    expect(raw).not.toContain("s3cr3t-token");
    expect(raw).not.toContain("rk-12345");
    expect(raw).not.toContain("very-secret-token");
    expect(readEditorDraft(newScope)?.redactedPaths).toEqual(
      expect.arrayContaining(["/apiHeaders/0/value", "/apiHeaders/1/value", "/url"]),
    );
  });

  it("keeps a URL that cannot carry a secret, and names every blanked field on restore", async () => {
    await mountEditor();
    await fillCustomWebhook();
    await edit({ url: "https://hooks.example.com/notify/v2" });
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft<{ url: string }>(newScope)?.data.url).toBe(
      "https://hooks.example.com/notify/v2",
    );
    expect(readEditorDraft(newScope)?.redactedPaths).not.toContain("/url");

    await remount();
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "Your changes to the Authorization header and X-Routing-Key header were not kept.",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.url).toBe("https://hooks.example.com/notify/v2");
  });

  it("a changed URL comes back empty and flagged, blocks Save, and an unchanged header is refilled", async () => {
    const hook = {
      name: "ops_hook",
      type: "http",
      url: "https://example.com/hook-v2",
      method: "post",
      template: "plain_http",
      headers: { Authorization: "Bearer saved-token" },
    };
    const hookScope: EditorDraftScope = { ...newScope, entityId: "ops_hook" };
    vi.mocked(destinationService.update).mockClear();
    await mountEditor({ destination: { ...hook } });
    await edit({ url: "https://hooks.slack.com/services/T000/B000/XXXX" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(hookScope)?.changedRedactedPaths).toEqual(["/url"]);
    expect(storedRaw(hookScope)).not.toContain("T000/B000");

    await remount({ destination: { ...hook } });
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "Your change to the URL was not kept. Re-enter it before saving.",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(form().state.values.url).toBe("");
    expect(form().state.values.apiHeaders).toEqual([
      { key: "Authorization", value: "Bearer saved-token" },
    ]);
    expect(form().getFieldMeta("url")?.errors).toContain(
      "Re-enter this value: your change was not kept in the draft.",
    );

    await edit({ url: "https://example.com/hook-v3" });
    await form().handleSubmit();
    await flushPromises();
    expect(destinationService.update).toHaveBeenCalledTimes(1);
  });

  it("does not save while a header whose change was not kept is still blank", async () => {
    const hook = {
      name: "ops_hook",
      type: "http",
      url: "https://example.com/hook",
      method: "post",
      template: "plain_http",
      headers: { Authorization: "Bearer saved-token" },
    };
    vi.mocked(destinationService.update).mockClear();
    await mountEditor({ destination: { ...hook } });
    await edit({ apiHeaders: [{ key: "Authorization", value: "Bearer new-token" }] });
    window.dispatchEvent(new Event("pagehide"));

    await remount({ destination: { ...hook } });
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.apiHeaders).toEqual([{ key: "Authorization", value: "" }]);

    await form().handleSubmit();
    await flushPromises();
    expect(destinationService.update).not.toHaveBeenCalled();
    expect(form().getFieldMeta("apiHeaders[0].value")?.errors?.length).toBeGreaterThan(0);
  });

  it("blanks a URL with credentials in it, or a Slack webhook URL", async () => {
    await mountEditor();
    await fillCustomWebhook();
    await edit({ url: "https://bot:pw@hooks.example.com/notify" });
    window.dispatchEvent(new Event("pagehide"));
    expect(storedRaw(newScope)).not.toContain("bot:pw");

    await edit({ url: "https://hooks.slack.com/services/T0/B0/xyz" });
    window.dispatchEvent(new Event("pagehide"));
    expect(storedRaw(newScope)).not.toContain("services/T0/B0/xyz");
    await remount();
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("URL, ");
  });

  it.each([
    [
      "a Telegram bot URL",
      "https://api.telegram.org/bot123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage",
    ],
    ["a Zapier hook", "https://hooks.zapier.com/hooks/catch/123456/abcdef/"],
    ["a Mattermost hook key", "https://chat.example.com/hooks/xr3j5x9n7f8gbh6tu1qzw2a4yd"],
    ["a scheme-less Slack webhook", "hooks.slack.com/services/T000/B000/XXXX"],
  ])("blanks %s", async (_name, url) => {
    await mountEditor();
    await fillCustomWebhook();
    await edit({ url });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)?.redactedPaths).toContain("/url");
    expect(readEditorDraft<{ url: string }>(newScope)?.data.url).toBe("");
  });

  it("never writes a prebuilt password, and says so when the draft is offered", async () => {
    await mountEditor();
    await edit({
      destination_type: "servicenow",
      name: "snow_new",
      credentials: {
        instanceUrl: "https://acme.service-now.com",
        username: "bot",
        password: "hunter2",
      },
    });
    window.dispatchEvent(new Event("pagehide"));

    const raw = storedRaw(newScope);
    expect(raw).toContain("bot");
    expect(raw).not.toContain("hunter2");

    await remount();
    expect(byTest("editor-draft-credentials-not-saved")).not.toBeNull();
  });

  it("never writes a secret credential whose name does not say so", async () => {
    await mountEditor();
    await edit({
      destination_type: "pagerduty",
      name: "pd_new",
      credentials: { integrationKey: "pd-routing-key-0123456789abcdef", severity: "critical" },
    });
    window.dispatchEvent(new Event("pagehide"));

    const raw = storedRaw(newScope);
    expect(raw).toContain("critical");
    expect(raw).not.toContain("pd-routing-key");
  });

  it("continuing an edit draft keeps the server's credentials, matched by header name", async () => {
    await mountEditor({ destination: { ...serviceNow } });
    expect(form().state.values.apiHeaders.map((row) => row.key)).toEqual([
      "X-Team-Secret",
      "X-Region",
    ]);
    await edit({
      apiHeaders: [{ key: "X-Region", value: "eu-west" }],
      credentials: { ...(form().state.values.credentials as object), assignmentGroup: "sre" },
    });
    window.dispatchEvent(new Event("pagehide"));

    const raw = storedRaw(editScope);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("eu-west");

    await remount({ destination: { ...serviceNow } });
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    const values = form().state.values;
    expect(values.credentials).toMatchObject({ password: "hunter2", assignmentGroup: "sre" });
    expect(values.apiHeaders).toEqual([{ key: "X-Region", value: "eu-west" }]);
  });

  it("Cancel with unsaved changes asks, and Discard closes and drops the draft", async () => {
    await mountEditor();
    await fillCustomWebhook();
    window.dispatchEvent(new Event("pagehide"));

    await wrapper!.get('[data-test="add-destination-cancel-btn"]').trigger("click");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(emitted.cancel).toBe(1);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("keeps no draft once the Slack app type is picked, and its Cancel closes without asking", async () => {
    await mountEditor();
    await fillCustomWebhook();
    await edit({ destination_type: "slack_app" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).toBeNull();

    wrapper!.findComponent({ name: "SlackAppDestinationForm" }).vm.$emit("cancel");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(emitted.cancel).toBe(1);
  });

  it("Save in the leave dialog saves without closing the editor itself", async () => {
    await mountEditor();
    await fillCustomWebhook();

    await wrapper!.get('[data-test="add-destination-cancel-btn"]').trigger("click");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await vi.waitFor(() => expect(emitted.cancel).toBe(1));

    expect(destinationService.create).toHaveBeenCalledTimes(1);
    expect(emitted.refresh).toBe(1);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Create email template goes through the leave dialog, and Keep draft carries on", async () => {
    await mountEditor({ templates: [] });
    await edit({ destination_type: "custom", type: "email", name: "mail_ops" });
    await flushPromises();

    await wrapper!.get('[data-test="add-destination-create-email-template-btn"]').trigger("click");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(router.currentRoute.value.name).toBe("alertDestinations");

    leaveButton("o-dialog-secondary-btn")?.click();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("alertTemplates");
    expect(router.currentRoute.value.query).toMatchObject({ action: "add", type: "email" });
    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("mail_ops");
  });
});
