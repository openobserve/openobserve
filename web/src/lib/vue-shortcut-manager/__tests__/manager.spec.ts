import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { ShortcutManager, getManager, resetManager } from "@/lib/vue-shortcut-manager/manager";
import { useShortcut, useShortcuts } from "@/lib/vue-shortcut-manager/composables";
import {
  getShortcutDef,
  getShortcutDisplay,
  resolveShortcutKeys,
} from "@/lib/vue-shortcut-manager/shortcutRegistry";

const fakeEvent = (over: Record<string, unknown>) =>
  ({
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...over,
  }) as any;

describe("ShortcutManager", () => {
  let manager: ShortcutManager;

  beforeEach(() => {
    resetManager();
    manager = new ShortcutManager();
  });

  it("should register and find shortcuts", () => {
    manager.register({ key: "ctrl+b", handler: () => {}, description: "test" });
    const all = manager.getAll();
    expect(all.length).toBe(1);
    expect(all[0].key).toBe("ctrl+b");
  });

  it("should fire handler on matching keydown", () => {
    const handler = vi.fn();
    manager.register({ key: "ctrl+b", handler, description: "test" });

    manager.handleKeyDown({
      key: "b",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("should fire handler for escape", () => {
    const handler = vi.fn();
    manager.register({ key: "escape", handler, description: "test" });

    manager.handleKeyDown({
      key: "Escape",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("should fire handler for meta+b", () => {
    const handler = vi.fn();
    manager.register({ key: "meta+b", handler, description: "test" });

    manager.handleKeyDown({
      key: "b",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();
  });

  describe("input-focus guard", () => {
    let input: HTMLInputElement;

    beforeEach(() => {
      input = document.createElement("input");
      document.body.appendChild(input);
    });

    afterEach(() => {
      input.blur();
      input.remove();
    });

    it('should not fire shift+? while typing "?" in an input', () => {
      const handler = vi.fn();
      manager.register({ key: "shift+?", handler, description: "cheatsheet" });
      input.focus();

      manager.handleKeyDown({
        key: "?",
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should fire shift+? when no input is focused", () => {
      const handler = vi.fn();
      manager.register({ key: "shift+?", handler, description: "cheatsheet" });

      manager.handleKeyDown({
        key: "?",
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any);

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should still fire command-modifier shortcuts while typing in an input", () => {
      const handler = vi.fn();
      manager.register({ key: "ctrl+shift+k", handler, description: "command" });
      input.focus();

      manager.handleKeyDown({
        key: "k",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any);

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should not fire plain-key shortcuts while a contenteditable element has focus", () => {
      const handler = vi.fn();
      manager.register({ key: "r", handler, description: "refresh" });

      // jsdom does not implement isContentEditable — stub it like a real
      // contenteditable element (RichTextInput, editable table cells, …).
      const editable = document.createElement("div");
      Object.defineProperty(editable, "isContentEditable", { value: true });

      manager.handleKeyDown(fakeEvent({ key: "r", target: editable }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not fire plain-key shortcuts while an ARIA textbox has focus", () => {
      const handler = vi.fn();
      manager.register({ key: "r", handler, description: "refresh" });

      const widget = document.createElement("div");
      widget.setAttribute("role", "combobox");

      manager.handleKeyDown(fakeEvent({ key: "r", target: widget }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should fire allowInInput shortcuts even while typing in an input", () => {
      const handler = vi.fn();
      manager.register({
        key: "escape",
        handler,
        description: "close",
        allowInInput: true,
      });
      input.focus();

      manager.handleKeyDown(fakeEvent({ key: "Escape", target: input }));

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should suppress plain escape (no allowInInput) while typing in an input", () => {
      const handler = vi.fn();
      manager.register({ key: "escape", handler, description: "close" });
      input.focus();

      manager.handleKeyDown(fakeEvent({ key: "Escape", target: input }));

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe("useShortcut composable", () => {
  beforeEach(() => {
    resetManager();
  });

  it("should register shortcut on mount", async () => {
    const handler = vi.fn();

    const TestComponent = defineComponent({
      setup() {
        useShortcut("ctrl+b", handler, { description: "test" });
        return () => h("div", "test");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager();
    expect(mgr).toBeTruthy();
    const all = mgr!.getAll();
    expect(all.length).toBe(1);
    expect(all[0].key).toBe("ctrl+b");

    // Simulate keydown
    mgr!.handleKeyDown({
      key: "b",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it("should unregister shortcut on unmount", async () => {
    const handler = vi.fn();

    const TestComponent = defineComponent({
      setup() {
        useShortcut("ctrl+b", handler, { description: "test" });
        return () => h("div", "test");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager();
    expect(mgr!.getAll().length).toBe(1);

    wrapper.unmount();
    expect(mgr!.getAll().length).toBe(0);
  });
});

describe("useShortcuts composable (multiple)", () => {
  beforeEach(() => {
    resetManager();
  });

  it("should register inline shortcuts exactly as given, with no implicit Mac twin", async () => {
    const escHandler = vi.fn();
    const ctrlBHandler = vi.fn();

    const TestComponent = defineComponent({
      setup() {
        useShortcuts([
          { key: "escape", handler: escHandler, description: "Close" },
          { key: "ctrl+b", handler: ctrlBHandler, description: "Toggle" },
        ]);
        return () => h("div", "test");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager();
    // escape + ctrl+b only — no auto-registered meta twin
    expect(mgr!.getAll().length).toBe(2);

    mgr!.handleKeyDown(fakeEvent({ key: "Escape" }));
    expect(escHandler).toHaveBeenCalledOnce();

    mgr!.handleKeyDown(fakeEvent({ key: "b", ctrlKey: true }));
    expect(ctrlBHandler).toHaveBeenCalledOnce();

    // ⌘+b does NOT fire — Mac requires an explicit keyForMac now
    mgr!.handleKeyDown(fakeEvent({ key: "b", metaKey: true }));
    expect(ctrlBHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it("should register only the current-platform combo for keyForWindows/keyForMac", async () => {
    // jsdom reports a non-Mac platform → the Windows combo is registered.
    const handler = vi.fn();
    const TestComponent = defineComponent({
      setup() {
        useShortcuts([
          {
            key: "ctrl+x",
            keyForWindows: "ctrl+x",
            keyForMac: "meta+x",
            handler,
            description: "X",
          },
        ]);
        return () => h("div");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager()!;
    expect(mgr.getAll().length).toBe(1);
    expect(mgr.getAll()[0].key).toBe("ctrl+x");

    wrapper.unmount();
  });

  it("should resolve key, scope and description from the registry by id", async () => {
    const handler = vi.fn();
    const TestComponent = defineComponent({
      setup() {
        useShortcuts([{ id: "logsRefresh", handler }]);
        return () => h("div");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager()!;
    const sc = mgr.getById("logsRefresh");
    expect(sc).toBeTruthy();
    expect(sc!.key).toBe("r");
    expect(sc!.scope).toBe("logs");
    expect(sc!.description).toBe("shortcuts.actions.logsRefresh");

    // useShortcuts activated the 'logs' scope, so 'r' fires.
    mgr.handleKeyDown(fakeEvent({ key: "r" }));
    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it("should register every binding for a multi-key registry id", async () => {
    const handler = vi.fn();
    const TestComponent = defineComponent({
      setup() {
        useShortcuts([{ id: "traceNextSpan", handler }]);
        return () => h("div");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager()!;
    expect(mgr.getAll().length).toBe(2);
    expect(mgr.getById("traceNextSpan-0")!.key).toBe("j");
    expect(mgr.getById("traceNextSpan-1")!.key).toBe("down");

    wrapper.unmount();
  });

  it("should warn and skip an unknown registry id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const TestComponent = defineComponent({
      setup() {
        useShortcuts([{ id: "thisIdDoesNotExist", handler: vi.fn() }]);
        return () => h("div");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    expect(getManager()!.getAll().length).toBe(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    wrapper.unmount();
  });

  it("should handle window keydown events via getManager singleton", async () => {
    const handler = vi.fn();

    const TestComponent = defineComponent({
      setup() {
        useShortcut("ctrl+b", handler, { description: "test" });
        return () => h("div", "test");
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    // Dispatch a real KeyboardEvent on window
    const event = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });
});

describe("shortcutRegistry", () => {
  it("should return a registerable definition by id", () => {
    const def = getShortcutDef("logsRunQuery");
    expect(def).toBeTruthy();
    expect(def!.scope).toBe("logs");
    expect(def!.keyForWindows).toBe("ctrl+enter");
    expect(def!.keyForMac).toBe("meta+enter");
    expect(def!.descriptionKey).toBe("shortcuts.actions.logsRunQuery");
  });

  it("should return undefined for an unknown id", () => {
    expect(getShortcutDef("nopeNotAnId")).toBeUndefined();
  });

  it("should return undefined for display-only entries (table-row keys)", () => {
    // Handled by OTableBodyRow, not useShortcuts — not registerable by id.
    expect(getShortcutDef("alertsRowDelete")).toBeUndefined();
  });

  it("should resolve platform-specific keys", () => {
    const def = getShortcutDef("logsRunQuery")!;
    expect(resolveShortcutKeys(def, false)).toEqual(["ctrl+enter"]);
    expect(resolveShortcutKeys(def, true)).toEqual(["meta+enter"]);
  });

  it("should resolve a single same-platform key on both platforms", () => {
    const def = getShortcutDef("logsRefresh")!;
    expect(resolveShortcutKeys(def, false)).toEqual(["r"]);
    expect(resolveShortcutKeys(def, true)).toEqual(["r"]);
  });

  it("should resolve every binding for a multi-key entry", () => {
    const def = getShortcutDef("traceNextSpan")!;
    expect(resolveShortcutKeys(def, false)).toEqual(["j", "down"]);
  });

  it("should resolve a tooltip display key by id (registerable)", () => {
    // Windows/common form — OShortcut renders ctrl→⌘ on Mac.
    expect(getShortcutDisplay("logsRunQuery")).toBe("ctrl+enter");
    expect(getShortcutDisplay("alertsImport")).toBe("i");
  });

  it("should resolve a tooltip display token for display-only ids", () => {
    expect(getShortcutDisplay("panelView")).toBe("v");
    // "del / ⌫" cheatsheet label → clean "del" token for the tooltip keycap.
    expect(getShortcutDisplay("alertsRowDelete")).toBe("del");
  });

  it("should return undefined display for an unknown id", () => {
    expect(getShortcutDisplay("nopeNotAnId")).toBeUndefined();
  });
});

describe("handler event argument", () => {
  beforeEach(() => {
    resetManager();
  });

  it("passes the KeyboardEvent to the handler, including repeat", () => {
    const handler = vi.fn();
    getManager()!.register({ key: "j", handler, description: "next" });

    const first = new KeyboardEvent("keydown", { key: "j" });
    window.dispatchEvent(first);
    const held = new KeyboardEvent("keydown", { key: "j", repeat: true });
    window.dispatchEvent(held);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0]).toBe(first);
    expect(handler.mock.calls[0][0].repeat).toBe(false);
    expect(handler.mock.calls[1][0]).toBe(held);
    expect(handler.mock.calls[1][0].repeat).toBe(true);
  });

  it("passes the event to a registry-bound useShortcuts handler", async () => {
    const handler = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup() {
          useShortcuts([{ id: "logsNextRow", handler }]);
          return () => h("div");
        },
      }),
    );
    await nextTick();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", repeat: true }));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toBeInstanceOf(KeyboardEvent);
    expect(handler.mock.calls[0][0].repeat).toBe(true);
    wrapper.unmount();
  });
});

describe("scope stack", () => {
  let manager: ShortcutManager;

  beforeEach(() => {
    resetManager();
    manager = new ShortcutManager();
  });

  it("returns the newest acquired scope, else the base scope", () => {
    expect(manager.getScope()).toBe("global");
    manager.setScope("base");
    const logs = manager.acquireScope("logs");
    expect(manager.getScope()).toBe("logs");
    manager.setScope("other-base");
    expect(manager.getScope()).toBe("logs");
    manager.releaseScope(logs);
    expect(manager.getScope()).toBe("other-base");
  });

  it("an out-of-order release never clobbers a newer owner", () => {
    const logs = manager.acquireScope("logs");
    const trace = manager.acquireScope("trace-detail");
    const dialog = manager.acquireScope("dialog");

    manager.releaseScope(trace);
    expect(manager.getScope()).toBe("dialog");
    manager.releaseScope(dialog);
    expect(manager.getScope()).toBe("logs");
    manager.releaseScope(logs);
    expect(manager.getScope()).toBe("global");
  });

  it("releasing an unknown or already released token is a no-op", () => {
    const logs = manager.acquireScope("logs");
    manager.releaseScope(Symbol("stranger"));
    expect(manager.getScope()).toBe("logs");
    manager.releaseScope(logs);
    manager.releaseScope(logs);
    expect(manager.getScope()).toBe("global");
  });

  it("dispatches to the shortcut of the scope on top of the stack", () => {
    const logsJ = vi.fn();
    const traceJ = vi.fn();
    manager.register({ key: "j", handler: logsJ, scope: "logs" });
    manager.register({ key: "j", handler: traceJ, scope: "trace-detail" });
    manager.acquireScope("logs");
    const trace = manager.acquireScope("trace-detail");

    manager.handleKeyDown(fakeEvent({ key: "j" }));
    expect(traceJ).toHaveBeenCalledOnce();

    manager.releaseScope(trace);
    manager.handleKeyDown(fakeEvent({ key: "j" }));
    expect(logsJ).toHaveBeenCalledOnce();
  });
});

describe("useShortcuts active option", () => {
  beforeEach(() => {
    resetManager();
  });

  it("registers and holds the scope only while active (false → true → false)", async () => {
    const active = ref(false);
    const handler = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup() {
          useShortcuts([{ id: "traceNextSpan", handler }], undefined, { active });
          return () => h("div");
        },
      }),
    );
    await nextTick();
    const mgr = getManager()!;
    expect(mgr.getAll()).toHaveLength(0);
    expect(mgr.getScope()).toBe("global");

    active.value = true;
    await nextTick();
    expect(mgr.getById("traceNextSpan-0")?.key).toBe("j");
    expect(mgr.getScope()).toBe("trace-detail");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(handler).toHaveBeenCalledOnce();

    active.value = false;
    await nextTick();
    expect(mgr.getAll()).toHaveLength(0);
    expect(mgr.getScope()).toBe("global");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it("registers nothing when mounted inactive and unmounted", async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          useShortcuts([{ id: "traceNextSpan", handler: vi.fn() }], undefined, {
            active: ref(false),
          });
          return () => h("div");
        },
      }),
    );
    await nextTick();
    wrapper.unmount();
    expect(getManager()!.getAll()).toHaveLength(0);
    expect(getManager()!.getScope()).toBe("global");
  });

  it("releases on unmount while active", async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          useShortcuts([{ id: "traceNextSpan", handler: vi.fn() }], undefined, {
            active: ref(true),
          });
          return () => h("div");
        },
      }),
    );
    await nextTick();
    expect(getManager()!.getScope()).toBe("trace-detail");
    wrapper.unmount();
    expect(getManager()!.getAll()).toHaveLength(0);
    expect(getManager()!.getScope()).toBe("global");
  });
});

describe("scope ownership sequences (4a §3.6)", () => {
  const logsJ = vi.fn();
  const spanJ = vi.fn();
  const showTrace = ref(false);
  const traceActive = ref(true);
  const showDialog = ref(false);
  const showOverlay = ref(false);

  const TraceDetails = defineComponent({
    setup() {
      useShortcuts([{ id: "traceNextSpan", handler: spanJ }], undefined, { active: traceActive });
      return () => h("div");
    },
  });
  const RegexDialog = defineComponent({
    setup() {
      useShortcuts([{ key: "escape", handler: vi.fn(), scope: "regex-dialog" }]);
      return () => h("div");
    },
  });
  const Overlay = defineComponent({
    setup() {
      useShortcuts([{ key: "escape", handler: vi.fn(), scope: "overlay" }]);
      return () => h("div");
    },
  });
  const LogsPage = defineComponent({
    setup() {
      useShortcuts([{ id: "logsNextRow", handler: logsJ }]);
      return () =>
        h("div", [
          showTrace.value ? h(TraceDetails) : null,
          showDialog.value ? h(RegexDialog) : null,
          showOverlay.value ? h(Overlay) : null,
        ]);
    },
  });

  const pressJ = (repeat = false) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", repeat }));

  beforeEach(() => {
    resetManager();
    logsJ.mockReset();
    spanJ.mockReset();
    showTrace.value = false;
    traceActive.value = true;
    showDialog.value = false;
    showOverlay.value = false;
  });

  it("correlated traces → page crossing on the JSON tab → JSON keeps the logs scope", async () => {
    const wrapper = mount(LogsPage);
    await nextTick();
    const mgr = getManager()!;
    expect(mgr.getScope()).toBe("logs");

    showTrace.value = true;
    await nextTick();
    expect(mgr.getScope()).toBe("trace-detail");
    pressJ();
    expect(spanJ).toHaveBeenCalledOnce();

    traceActive.value = false;
    await nextTick();
    expect(mgr.getScope()).toBe("logs");

    pressJ(true);
    expect(logsJ).toHaveBeenCalledOnce();
    expect(logsJ.mock.calls[0][0].repeat).toBe(true);
    expect(mgr.getScope()).toBe("logs");
    pressJ();
    expect(logsJ).toHaveBeenCalledTimes(2);
    expect(spanJ).toHaveBeenCalledOnce();

    wrapper.unmount();
    expect(mgr.getScope()).toBe("global");
  });

  it("correlated traces → nested dialog → tab left → dialog closed ends on logs", async () => {
    const wrapper = mount(LogsPage);
    showTrace.value = true;
    await nextTick();
    const mgr = getManager()!;

    showDialog.value = true;
    await nextTick();
    expect(mgr.getScope()).toBe("regex-dialog");

    traceActive.value = false;
    await nextTick();
    expect(mgr.getScope()).toBe("regex-dialog");

    showDialog.value = false;
    await nextTick();
    expect(mgr.getScope()).toBe("logs");
    pressJ();
    expect(logsJ).toHaveBeenCalledOnce();
    expect(spanJ).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("TraceDetails unmounting under a newer owner leaves that owner active", async () => {
    const wrapper = mount(LogsPage);
    showTrace.value = true;
    await nextTick();
    showOverlay.value = true;
    await nextTick();
    const mgr = getManager()!;
    expect(mgr.getScope()).toBe("overlay");

    showTrace.value = false;
    await nextTick();
    expect(mgr.getScope()).toBe("overlay");
    expect(mgr.getById("traceNextSpan-0")).toBeUndefined();

    showOverlay.value = false;
    await nextTick();
    expect(mgr.getScope()).toBe("logs");

    wrapper.unmount();
  });
});
