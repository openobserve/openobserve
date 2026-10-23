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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import workflows from "@/services/workflows";
import {
  HTTP_TOKEN,
  ODrawerStub,
  OPopoverStub,
  OSwitchStub,
  RouterLinkStub,
  httpAbsent,
  httpConfig,
} from "@/test/unit/helpers/workflowHttp";
import WorkflowHttpEndpointPanel from "./WorkflowHttpEndpointPanel.vue";

vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getHttpTrigger: vi.fn(),
      putHttpTrigger: vi.fn(),
      deleteHttpTrigger: vi.fn(),
      rotateHttpCredential: vi.fn(),
      revokeHttpCredential: vi.fn(),
      revealHttpCredentialSecret: vi.fn(),
    },
    dryRunHook: vi.fn(),
  });
});

const api = vi.mocked(workflows);
const t = (k: string, v?: Record<string, unknown>) => i18n.global.t(k, v ?? {});
const mounted: VueWrapper[] = [];

const mountPanel = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(WorkflowHttpEndpointPanel, {
    props: {
      open: true,
      workflowId: "wf1",
      workflowName: "Restart failed deploy",
      kind: "alert_fired",
      isDraftOnly: false,
      workflowEnabled: true,
      context: "editor",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        OPopover: OPopoverStub,
        OSwitch: OSwitchStub,
        RouterLink: RouterLinkStub,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
};

const byTest = (w: VueWrapper, id: string) => w.find(`[data-test="${id}"]`);
const drawer = (w: VueWrapper) => w.findComponent(ODrawerStub);

describe("WorkflowHttpEndpointPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "acme" };
    store.state.zoConfig = { ...store.state.zoConfig, rbac_enabled: false };
    store.state.currentuser = { role: "admin" };
    api.getHttpTrigger.mockResolvedValue(httpConfig());
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
  });

  it("the panel is xl with the kind subtitle, name only without a trigger", async () => {
    const w = await mountPanel();
    expect(drawer(w).props("size")).toBe("xl");
    expect(drawer(w).props("title")).toBe(t("workflow.http.panelTitle"));
    expect(drawer(w).props("subTitle")).toBe(
      t("workflow.http.panelSubtitle", { name: "Restart failed deploy", kind: "Alert Fired" }),
    );
    expect(drawer(w).attributes("data-test")).toBe("workflow-http-panel");
    expect(drawer(w).props("persistent")).toBeFalsy();
    const bare = await mountPanel({ kind: undefined });
    expect(drawer(bare).props("subTitle")).toBe("Restart failed deploy");
  });

  it("kind note on alert and incident workflows only", async () => {
    const alert = await mountPanel();
    expect(byTest(alert, "workflow-http-kind-note").text()).toContain("Alert Fired");
    expect(byTest(alert, "workflow-http-kind-note").text()).toContain(
      'meta.trigger_source = "http"',
    );
    await byTest(alert, "workflow-http-kind-note-payload").trigger("click");
    expect(byTest(alert, "workflow-http-kind-note-sample").text()).toContain("trigger_source");
    const incident = await mountPanel({ kind: "incident_event" });
    expect(byTest(incident, "workflow-http-kind-note").text()).toContain("Incident Event");
    const none = await mountPanel({ kind: undefined });
    expect(byTest(none, "workflow-http-kind-note").exists()).toBe(false);
  });

  it("unsaved workflow saves a draft then creates the endpoint", async () => {
    api.getHttpTrigger.mockResolvedValue(httpAbsent());
    api.putHttpTrigger.mockResolvedValue({ ...httpConfig(), secret: HTTP_TOKEN });
    let w!: VueWrapper;
    const beforeCreate = vi.fn(async () => {
      await w.setProps({ workflowId: "wf9" });
      return true;
    });
    w = await mountPanel({ workflowId: null, beforeCreate });
    expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.unsavedBody"));
    expect(byTest(w, "workflow-http-toggle").exists()).toBe(false);
    await byTest(w, "workflow-http-save-and-create").trigger("click");
    await flushPromises();
    expect(beforeCreate).toHaveBeenCalledTimes(1);
    expect(api.putHttpTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wf9", payload: { enabled: true, auth_mode: "token" } }),
    );
    expect(byTest(w, "workflow-http-reveal").exists()).toBe(true);
  });

  it("a false persistDraft adds no panel message", async () => {
    const beforeCreate = vi.fn(async () => false);
    const w = await mountPanel({ workflowId: null, beforeCreate });
    const before = byTest(w, "workflow-http-section").text();
    await byTest(w, "workflow-http-save-and-create").trigger("click");
    await flushPromises();
    expect(api.putHttpTrigger).not.toHaveBeenCalled();
    expect(byTest(w, "workflow-http-section").text()).toBe(before);
    expect(byTest(w, "workflow-http-error").exists()).toBe(false);
  });

  it("without credential access the unsaved panel shows the admin line and no button", async () => {
    store.state.currentuser = { role: "member" };
    const beforeCreate = vi.fn(async () => true);
    const w = await mountPanel({ workflowId: null, beforeCreate });
    expect(byTest(w, "workflow-http-needs-admin").text()).toBe(t("workflow.http.needsAdmin"));
    expect(byTest(w, "workflow-http-save-and-create").exists()).toBe(false);
    expect(beforeCreate).not.toHaveBeenCalled();
  });

  it("draft shows the 403 banner", async () => {
    const w = await mountPanel({ isDraftOnly: true });
    expect(byTest(w, "workflow-http-draft-banner").text()).toBe(t("workflow.http.draftBanner"));
  });

  it("disabled shows workflow-http-disabled-banner", async () => {
    const w = await mountPanel({ workflowEnabled: false });
    expect(byTest(w, "workflow-http-disabled-banner").text()).toBe(
      t("workflow.http.disabledBanner"),
    );
  });

  it("Run test closes the panel and opens the Test dialog preset to HTTP request", async () => {
    const order: string[] = [];
    const w = await mountPanel({
      "onUpdate:open": (v: boolean) => order.push(`open:${v}`),
      onRunTest: () => order.push("run-test"),
    });
    await byTest(w, "workflow-http-run-test").trigger("click");
    expect(order).toEqual(["open:false", "run-test"]);
    const seed = w.emitted("run-test")?.[0][0] as { meta: Record<string, unknown> }[];
    expect(seed[0].meta).toMatchObject({ trigger_source: "http", trigger_id: "test" });
  });

  it("list context replaces Run test with Open the workflow", async () => {
    const w = await mountPanel({ context: "list" });
    expect(byTest(w, "workflow-http-run-test").exists()).toBe(false);
    expect(byTest(w, "workflow-http-run-test-list-hint").exists()).toBe(true);
  });

  it("closing the panel unmounts the section and drops a revealed token", async () => {
    api.getHttpTrigger.mockResolvedValue(httpAbsent());
    api.putHttpTrigger.mockResolvedValue({ ...httpConfig(), secret: HTTP_TOKEN });
    const w = await mountPanel();
    await byTest(w, "workflow-http-toggle").trigger("click");
    await flushPromises();
    expect(byTest(w, "workflow-http-reveal").exists()).toBe(true);
    await w.setProps({ open: false });
    expect(byTest(w, "workflow-http-section").exists()).toBe(false);
    await w.setProps({ open: true });
    await flushPromises();
    expect(byTest(w, "workflow-http-reveal").exists()).toBe(false);
  });
});
