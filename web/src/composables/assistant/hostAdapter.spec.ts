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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

import { contextRegistry } from "@/composables/contextProviders/registry";
import { raw } from "@/types/i18n";

import { AVAILABLE, fakeRuntime } from "./__tests__/fakeRuntime";
import type { AssistantHostAdapter } from "./assistantStore.types";
import {
  focusDockComposer,
  isDockOpen,
  queueDockStage,
  useAssistantDockHost,
  useAssistantDockToggle,
  useDockedEditor,
} from "./hostAdapter";
import { createOpenAssistant } from "./openAssistant";
import { setRuntimeHandle } from "./runtimeHandle";

const { runtime, track } = vi.hoisted(() => ({
  runtime: { current: null as any },
  track: vi.fn(),
}));

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

function build() {
  const base = fakeRuntime();
  const openAssistant = createOpenAssistant({
    store: base.store,
    capability: () => AVAILABLE,
    hosts: base.hosts,
    routeName: () => "logs",
    routePrefersFloating: () => false,
    pushRoute: vi.fn(),
    lgUp: () => true,
    viewportPx: () => 1280,
    currentOrg: () => "org1",
    now: () => Date.now(),
    notify: vi.fn(),
  });
  runtime.current = { ...base, openAssistant };
  setRuntimeHandle(runtime.current);
  return runtime.current as ReturnType<typeof fakeRuntime>;
}

function adapter(over: Partial<AssistantHostAdapter> = {}): AssistantHostAdapter {
  return {
    id: "alert_query",
    objectKind: "alert",
    objectTitle: () => raw("Alert · checkout"),
    language: "sql",
    getBuffer: () => "SELECT 1",
    getContext: () => ({ selectedStreams: ["default"], currentSQLQuery: "SELECT 1" }),
    previewInsert: vi.fn(),
    revert: vi.fn(),
    isDirty: () => false,
    focusEditor: vi.fn(),
    dockSlot: ref(null),
    dockRowRem: () => 80,
    ...over,
  };
}

function mountHost(host: AssistantHostAdapter, options = {}) {
  const view: { current: ReturnType<typeof useAssistantDockHost> | null } = { current: null };
  const wrapper = mount(
    defineComponent({
      setup() {
        view.current = useAssistantDockHost(host, options);
        return () => h("div");
      },
    }),
  );
  return { wrapper, dock: view.current! };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  contextRegistry.cleanup();
  contextRegistry.register("default", {
    getContext: () => ({ currentPage: "logs", org_id: "org1" }),
  });
  track.mockClear();
});

afterEach(() => {
  contextRegistry.cleanup();
  document.body.innerHTML = "";
});

describe("useAssistantDockHost", () => {
  it("registers the adapter and pushes its context over the page's, then pops only its own", async () => {
    const rt = build();
    contextRegistry.push("parent", {
      getContext: () => ({ currentPage: "pipelines", pipelineId: "p1" }),
    });
    const { wrapper } = mountHost(adapter());
    expect(rt.hosts.has("alert_query")).toBe(true);
    const context = await contextRegistry.getActiveContext();
    expect(context).toMatchObject({
      currentPage: "pipelines",
      pipelineId: "p1",
      currentSQLQuery: "SELECT 1",
    });
    wrapper.unmount();
    expect(rt.hosts.has("alert_query")).toBe(false);
    expect(await contextRegistry.getActiveContext()).toMatchObject({ pipelineId: "p1" });
  });

  it("opens docked with the object's title and restores the previous placement when the host goes", async () => {
    const rt = build();
    rt.store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    const { wrapper, dock } = mountHost(adapter());
    const result = await dock.open();
    expect(result).toMatchObject({ ok: true, container: "docked.alert_query" });
    expect(dock.isOpen.value).toBe(true);
    expect(isDockOpen("alert_query")).toBe(true);
    const sid = rt.store.state.shell.activeSid!;
    expect(String(rt.store.state.sessions[sid].title)).toBe("Alert · checkout");
    wrapper.unmount();
    expect(rt.store.state.shell.placement).toEqual({ kind: "sidebar", mode: "pinned" });
    expect(track).toHaveBeenCalledWith("ai_container_closed", { reason: "host_closed" });
  });

  it("closes through the store, so the toggle's second press returns to the previous placement", async () => {
    const rt = build();
    const { dock } = mountHost(adapter());
    await dock.open();
    dock.close();
    expect(rt.store.state.shell.placement.kind).toBe("hidden");
    expect(track).toHaveBeenCalledWith("ai_container_closed", { reason: "close" });
  });

  it("pushes the context but never docks on a page that opens the sidebar instead", async () => {
    const rt = build();
    const { dock } = mountHost(adapter({ id: "function", objectKind: "function" }), {
      dock: false,
    });
    expect(rt.hosts.has("function")).toBe(false);
    expect((await contextRegistry.getActiveContext())?.currentSQLQuery).toBe("SELECT 1");
    expect(await dock.open()).toMatchObject({ ok: true, container: "sidebar" });
  });

  it("registers a drawer host only while it is shown, and a hide closes its dock", async () => {
    const rt = build();
    const shown = ref(false);
    const { dock } = mountHost(adapter({ id: "regex", objectKind: "regex" }), {
      active: () => shown.value,
    });
    expect(rt.hosts.has("regex")).toBe(false);
    shown.value = true;
    await flushPromises();
    expect(rt.hosts.has("regex")).toBe(true);
    await dock.open();
    shown.value = false;
    await flushPromises();
    expect(rt.hosts.has("regex")).toBe(false);
    expect(rt.store.state.shell.placement.kind).toBe("hidden");
  });

  it("stages a queued hand-off once when its host arrives, in a new docked chat", async () => {
    const rt = build();
    queueDockStage(
      "regex",
      { chips: [], text: "Write a regex" },
      { entryKind: "object_verb", objectKind: "log_field" },
    );
    mountHost(
      adapter({ id: "regex", objectKind: "regex", objectTitle: () => raw("Regex pattern · new") }),
    );
    await flushPromises();
    expect(rt.store.state.shell.placement).toEqual({ kind: "docked", hostId: "regex" });
    const sid = rt.store.state.shell.activeSid!;
    expect(rt.store.state.sessions[sid].composer.text).toBe("Write a regex");
    expect(rt.store.state.sessions[sid].origin.container).toBe("docked.regex");
    rt.store.close("close");
    mountHost(adapter({ id: "regex", objectKind: "regex" }));
    await flushPromises();
    expect(rt.store.state.shell.placement.kind).toBe("hidden");
  });

  it("focuses the open dock's composer for the editor's chord, and says so when none is open", async () => {
    build();
    expect(focusDockComposer("alert_query")).toBe(false);
    const { dock } = mountHost(adapter());
    await dock.open();
    document.body.innerHTML =
      '<section data-assistant-root data-placement="docked" data-host="alert_query"><textarea data-assistant-composer></textarea></section>';
    expect(focusDockComposer("alert_query")).toBe(true);
    expect(document.activeElement?.hasAttribute("data-assistant-composer")).toBe(true);
  });

  it("asks again into the same docked chat without sending", async () => {
    const rt = build();
    const { dock } = mountHost(adapter());
    const first = await dock.open();
    await dock.askAgain("Add p95 latency");
    const sid = rt.store.state.shell.activeSid!;
    expect(first.ok && first.sid).toBe(sid);
    expect(rt.store.state.sessions[sid].composer.text).toBe("Add p95 latency");
  });
});

describe("useAssistantDockToggle", () => {
  it("is pressed while that host's dock shows and builds the title of the mounted adapter", async () => {
    const rt = build();
    const view: { toggle: ReturnType<typeof useAssistantDockToggle> | null } = { toggle: null };
    const { dock } = mountHost(adapter({ id: "json_editor", objectKind: "pipeline_node" }));
    mount(
      defineComponent({
        setup() {
          view.toggle = useAssistantDockToggle("json_editor");
          return () => h("div");
        },
      }),
    );
    expect(view.toggle!.pressed.value).toBe(false);
    expect(String(view.toggle!.build().title)).toBe("Alert · checkout");
    await dock.open();
    expect(view.toggle!.pressed.value).toBe(true);
    view.toggle!.close();
    expect(rt.store.state.shell.placement.kind).toBe("hidden");
  });
});

describe("useDockedEditor", () => {
  it("builds one adapter whose Insert previews through the proposal and whose language follows the host", async () => {
    build();
    const language = ref<"sql" | "promql">("sql");
    const text = ref("SELECT 1");
    const write = vi.fn((next: string) => void (text.value = next));
    const view: { docked: ReturnType<typeof useDockedEditor> | null } = { docked: null };
    mount(
      defineComponent({
        setup() {
          view.docked = useDockedEditor({
            id: "alert_query",
            objectKind: "alert",
            objectTitle: () => raw("Alert · checkout"),
            language: () => language.value,
            getBuffer: () => text.value,
            getContext: () => ({}),
            isDirty: () => false,
            focusEditor: vi.fn(),
            write,
          });
          return () => h("div");
        },
      }),
    );
    const docked = view.docked!;
    expect(docked.adapter.language).toBe("sql");
    language.value = "promql";
    expect(docked.adapter.language).toBe("promql");
    const handle = await docked.adapter.previewInsert("SELECT 2", "replace");
    expect(text.value).toBe("SELECT 1");
    handle.accept();
    expect(write).toHaveBeenCalledTimes(1);
    expect(text.value).toBe("SELECT 2");
  });
});
