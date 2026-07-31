// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import type { BrowserStep, WireStep } from "@/types/synthetics";
import {
  applyValueToWire,
  buildWireFromStep,
  defaultTimeoutFor,
  journeyToWireSteps,
  mapWireStep,
  mapWireSteps,
} from "./mapRecordedStep";

describe("mapRecordedStep", () => {
  it("should map a navigate wire step using the url as value", () => {
    const wire: WireStep = {
      id: "s1",
      action: "navigate",
      name: "Open login",
      url: "https://app.example.com/login",
      timeout_ms: 10000,
    };
    expect(mapWireStep(wire, { preserveWire: true })).toEqual({
      id: expect.any(String), // mapper assigns a fresh UUID per step
      action: "navigate",
      name: "Open login",
      selector: undefined,
      selectorType: undefined,
      value: "https://app.example.com/login",
      timeout: 10000,
      code: "",
      wire: { ...wire, id: expect.any(String) }, // wire.id is now the step's own UUID
    });
  });

  it("should preserve the original extension step verbatim on wire", () => {
    const wire: WireStep = {
      id: "s4",
      action: "click",
      selector: "#login-btn",
      selector_type: "css",
      name: "Click login",
      timeout_ms: 10000,
      button: "left",
      modifiers: 2,
      position: { x: 12, y: 34 },
      pageAlias: "page",
      framePath: [],
      startTime: 1718700003100,
      code: "await page.locator('#login-btn').click();",
    };
    // wire is spread with the step's own UUID assigned to wire.id. Only the
    // live-capture path preserves it — see MapWireStepOptions.
    expect(mapWireStep(wire, { preserveWire: true }).wire).toEqual({
      ...wire,
      id: expect.any(String),
    });
  });

  describe("buildWireFromStep (reverse mapper for manual steps)", () => {
    const lean = (over: Partial<BrowserStep>): BrowserStep => ({
      id: "m1",
      action: "click",
      timeout: 30000,
      code: "",
      ...over,
    });

    it("should map a manual navigate step to a wire with url", () => {
      const w = buildWireFromStep(lean({ action: "navigate", value: "https://x.test" }));
      expect(w).toMatchObject({
        action: "navigate",
        url: "https://x.test",
        timeout_ms: 30000,
        pageAlias: "page",
        framePath: [],
      });
    });

    it("should map a manual click step preserving selector + selector_type", () => {
      const w = buildWireFromStep(lean({ action: "click", selector: "#go", selectorType: "CSS" }));
      expect(w).toMatchObject({ action: "click", selector: "#go", selector_type: "css" });
    });

    it("should map a manual type step value to wire value", () => {
      expect(
        buildWireFromStep(lean({ action: "type", selector: "#email", value: "a@b.c" })),
      ).toMatchObject({ action: "type", value: "a@b.c" });
    });

    it("should map a manual press step value to key", () => {
      expect(
        buildWireFromStep(lean({ action: "press", selector: "#i", value: "Enter" })),
      ).toMatchObject({ action: "press", key: "Enter" });
    });

    it("should map a manual select step value to a single-item options array", () => {
      expect(
        buildWireFromStep(lean({ action: "select", selector: "#s", value: "opt1" })),
      ).toMatchObject({ action: "select", options: ["opt1"] });
    });

    it("should map a manual assert step with a value to assert text", () => {
      expect(
        buildWireFromStep(lean({ action: "assert", selector: ".h", value: "Welcome" })),
      ).toMatchObject({ action: "assert", text: "Welcome" });
    });

    it.each(["hover", "scroll", "wait", "screenshot"] as const)(
      "should return a valid wire for action %s (previously null)",
      (action) => {
        const wire = buildWireFromStep(lean({ action }));
        expect(wire).not.toBeNull();
        expect(wire!.action).toBe(action);
      },
    );
  });

  it("should include all steps via journeyToWireSteps (including previously filtered actions)", () => {
    // Live-captured, so it carries a `wire` to be preserved verbatim below.
    const recorded = mapWireStep(
      { id: "s1", action: "navigate", url: "https://x.test" },
      { preserveWire: true },
    );
    const manual: BrowserStep = {
      id: "m1",
      action: "click",
      selector: "#go",
      timeout: 30000,
      code: "",
    };
    const waitStep: BrowserStep = { id: "m2", action: "wait", timeout: 30000, code: "" };
    const hoverStep: BrowserStep = {
      id: "m3",
      action: "hover",
      selector: ".el",
      timeout: 30000,
      code: "",
    };

    const wires = journeyToWireSteps([recorded, manual, waitStep, hoverStep]);
    expect(wires).toHaveLength(4); // all steps included — no drop on buildWireFromStep
    expect(wires[0]).toBe(recorded.wire); // recorded preserved verbatim
    expect(wires[2]).toMatchObject({ action: "wait" });
    expect(wires[3]).toMatchObject({ action: "hover", selector: ".el" });
    expect(wires[1]).toMatchObject({ action: "click", selector: "#go" });
  });

  it("should map a type wire step with css selector_type to CSS", () => {
    const wire: WireStep = {
      id: "s2",
      action: "type",
      name: "Fill #email",
      selector: "#email",
      selector_type: "css",
      value: "user@example.com",
      timeout_ms: 10000,
    };
    const mapped = mapWireStep(wire);
    expect(mapped.action).toBe("type");
    expect(mapped.selector).toBe("#email");
    expect(mapped.selectorType).toBe("CSS");
    expect(mapped.value).toBe("user@example.com");
  });

  it("should map a click wire step and map data-test selector_type to TestID", () => {
    const mapped = mapWireStep({
      id: "s3",
      action: "click",
      selector: "submit",
      selector_type: "data-test",
      button: "left",
    });
    expect(mapped.action).toBe("click");
    expect(mapped.selectorType).toBe("TestID");
  });

  it("should map a press wire step using the key as value", () => {
    const mapped = mapWireStep({ id: "s4", action: "press", key: "Enter" });
    expect(mapped.action).toBe("press");
    expect(mapped.value).toBe("Enter");
  });

  it("should map an assert wire step preferring text over value", () => {
    const mapped = mapWireStep({
      id: "s5",
      action: "assert",
      selector: ".dashboard",
      selector_type: "css",
      text: "Welcome",
      value: "ignored",
    });
    expect(mapped.action).toBe("assert");
    expect(mapped.value).toBe("Welcome");
  });

  it("should map waitFor to the wait action", () => {
    expect(mapWireStep({ id: "s6", action: "waitFor" }).action).toBe("wait");
  });

  // A file upload used to be surfaced as a `type` step, which described neither
  // what was recorded nor what would be replayed. It has its own action now.
  it("should map setInputFiles to the upload action", () => {
    expect(mapWireStep({ id: "s7", action: "setInputFiles" }).action).toBe("upload");
  });

  // X-9.3 — a checkbox interaction is no longer collapsed to a click, which used
  // to make the replayed journey depend on the box's starting state.
  it("should keep check and uncheck distinct from click", () => {
    expect(mapWireStep({ id: "s8", action: "check" }).action).toBe("check");
    expect(mapWireStep({ id: "s9", action: "uncheck" }).action).toBe("uncheck");
  });

  it("should carry version-2 evidence through untouched", () => {
    const step = mapWireStep({
      id: "s10",
      action: "click",
      selector: '[data-test="login-sign-in"]',
      locator: {
        candidates: [
          { kind: "test_attribute", value: '[data-test="login-sign-in"]' },
          { kind: "role", value: 'role=button[name="Sign In"]' },
        ],
      },
      settle: {
        navigation: { url_pattern: "**/web/**" },
        responses: [{ url_pattern: "**/auth/login", method: "POST", required: false }],
        observed_duration_ms: 1800,
      },
    });
    expect(step.locator?.candidates).toHaveLength(2);
    expect(step.settle?.navigation?.url_pattern).toBe("**/web/**");
    expect(step.settle?.observed_duration_ms).toBe(1800);
  });

  it("should default unknown actions to click and warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mapped = mapWireStep({ id: "s8", action: "frobnicate" });
    expect(mapped.action).toBe("click");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  // Spec P1.1.2. The mapper must NOT substitute a timeout: absence means "use
  // the runner's per-action-category default". Stamping one here would put the
  // machine's guess back into stored config, which is what the recorder's
  // hardcoded 10000 did — the direct cause of the observed production failures.
  it("should leave timeout undefined when timeout_ms is absent", () => {
    expect(mapWireStep({ id: "s9", action: "click" }).timeout).toBeUndefined();
  });

  it("should preserve an author-set timeout", () => {
    expect(mapWireStep({ id: "s9", action: "click", timeout_ms: 5000 }).timeout).toBe(5000);
  });

  it("exposes the runner's category defaults for display only", () => {
    // 60s for navigate/assert (the slow phases), 30s for interactions.
    expect(defaultTimeoutFor("navigate")).toBe(60000);
    expect(defaultTimeoutFor("assert")).toBe(60000);
    expect(defaultTimeoutFor("click")).toBe(30000);
    expect(defaultTimeoutFor("type")).toBe(30000);
  });

  it("should not carry a timeout into the wire step unless the author set one", () => {
    expect(buildWireFromStep({ id: "s1", action: "click", code: "" })?.timeout_ms).toBeUndefined();
    expect(
      buildWireFromStep({ id: "s1", action: "click", code: "", timeout: 4200 })?.timeout_ms,
    ).toBe(4200);
  });

  it("should generate a compact UUIDv7 id when the wire step has none", () => {
    const mapped = mapWireStep({ id: "", action: "click" });
    expect(mapped.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("should map a list of wire steps preserving order", () => {
    const steps = mapWireSteps([
      { id: "s1", action: "navigate", url: "https://x.test" },
      { id: "s2", action: "click", selector: "#go" },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0].action).toBe("navigate");
    expect(steps[1].action).toBe("click");
  });

  // ── Value round-trip ──────────────────────────────────────────────────────
  // The editor keeps one `value` per step; the wire spreads it across
  // url/key/text/files/options/value by action. Reading and writing must agree,
  // or the editor shows one thing and replay does another.

  it("should surface a recorded select's option as the editor value", () => {
    const mapped = mapWireStep({ id: "s1", action: "select", options: ["India"] });
    expect(mapped.value).toBe("India");
  });

  it.each([
    ["navigate", "url", "https://new.test"],
    ["press", "key", "Tab"],
    ["assert", "text", "Welcome"],
    ["type", "value", "hello"],
  ] as const)("applyValueToWire should write a %s value to wire.%s", (action, field, value) => {
    const wire = applyValueToWire({ id: "s1", action }, action, value);
    expect(wire[field as keyof typeof wire]).toBe(value);
  });

  it("applyValueToWire should write list-valued actions as single-entry lists", () => {
    expect(applyValueToWire({ id: "s1", action: "upload" }, "upload", "/tmp/a.pdf").files).toEqual([
      "/tmp/a.pdf",
    ]);
    expect(applyValueToWire({ id: "s1", action: "select" }, "select", "India").options).toEqual([
      "India",
    ]);
  });

  it("applyValueToWire should clear a list-valued field when the value is cleared", () => {
    expect(
      applyValueToWire({ id: "s1", action: "upload", files: ["/tmp/a.pdf"] }, "upload", "").files,
    ).toEqual([]);
  });

  it("applyValueToWire should preserve the extension metadata it does not own", () => {
    const wire: WireStep = {
      id: "s1",
      action: "navigate",
      url: "https://old.test",
      pageAlias: "page",
      framePath: ["main"],
    };
    const next = applyValueToWire(wire, "navigate", "https://new.test");
    expect(next.pageAlias).toBe("page");
    expect(next.framePath).toEqual(["main"]);
  });

  it("should round-trip an edited navigate URL back out to replay", () => {
    const mapped = mapWireStep({ id: "s1", action: "navigate", url: "https://old.test" });
    const edited: BrowserStep = {
      ...mapped,
      value: "https://new.test",
      wire: applyValueToWire(mapped.wire!, "navigate", "https://new.test"),
    };
    expect(journeyToWireSteps([edited])[0].url).toBe("https://new.test");
  });

  it("should build an assert wire step from the typed assertion's expected value", () => {
    const wire = buildWireFromStep({
      id: "s1",
      action: "assert",
      code: "",
      assertion: { kind: "element_text", expected: "Signed in" },
    });
    expect(wire?.text).toBe("Signed in");
  });
});

// ── preserveWire ──────────────────────────────────────────────────────────
// `wire` means two different things. Fresh from the recorder it carries fields
// the v2 schema has no home for (options, text, modifiers, button, position,
// framePath) and is worth keeping. Rebuilt from a SAVED monitor it is strictly
// poorer than what buildWireFromStep reconstructs — so preserving it there
// shadowed the correct reconstruction. That shadowing is SE-24: the extension
// builds its select action from `options`, a stored v2 select carries only
// `value`, so a reloaded select replayed as selectOption([]) — selecting nothing
// while still reading as a pass, because later steps proceeded.
describe("preserveWire", () => {
  const storedSelect: WireStep = {
    id: "s2",
    action: "select",
    name: "Pick colour",
    value: "Blue",
    locator: { candidates: [{ kind: "css", value: "#colour" }] },
  };

  it("should omit wire by default, so replay is rebuilt from the step", () => {
    const [step] = mapWireSteps([storedSelect]);
    expect(step.wire).toBeUndefined();
  });

  it("should preserve wire when the caller opts in (live capture)", () => {
    const [step] = mapWireSteps([storedSelect], { preserveWire: true });
    expect(step.wire).toBeDefined();
    expect(step.wire?.action).toBe("select");
  });

  it("should replay a reloaded select with options, not an empty array (SE-24)", () => {
    const [step] = mapWireSteps([storedSelect]);
    const [wire] = journeyToWireSteps([step]);
    expect(wire.options).toEqual(["Blue"]);
  });

  it("should still replay a live-captured select correctly", () => {
    // The recorder's own step carries `options`; opting in must not regress it.
    const recorded: WireStep = { ...storedSelect, options: ["Blue"], value: undefined };
    const [step] = mapWireSteps([recorded], { preserveWire: true });
    const [wire] = journeyToWireSteps([step]);
    expect(wire.options).toEqual(["Blue"]);
  });
});
