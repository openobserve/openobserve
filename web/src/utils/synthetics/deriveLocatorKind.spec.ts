// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { deriveLocatorKind } from "./deriveLocatorKind";

describe("deriveLocatorKind", () => {
  it("reads the engine prefix on the first segment", () => {
    expect(deriveLocatorKind('internal:testid=[data-qa="submit"]')).toBe("test_attribute");
    expect(deriveLocatorKind("role=button")).toBe("role");
    expect(deriveLocatorKind('role=button[name="Sign In"]')).toBe("role");
    expect(deriveLocatorKind('internal:role=button[name="Save draft"i]')).toBe("role");
    expect(deriveLocatorKind("text=Sign in")).toBe("text");
    expect(deriveLocatorKind('internal:text="Sign in"i')).toBe("text");
    expect(deriveLocatorKind("xpath=//div[@id='a']")).toBe("xpath");
    expect(deriveLocatorKind("//div[@id='a']")).toBe("xpath");
    expect(deriveLocatorKind("(//div)[2]")).toBe("xpath");
  });

  it("falls back to css for anything else", () => {
    expect(deriveLocatorKind("#pinned")).toBe("css");
    expect(deriveLocatorKind(".btn-primary")).toBe("css");
    expect(deriveLocatorKind("button")).toBe("css");
    expect(deriveLocatorKind("")).toBe("css");
  });

  // A bare attribute selector IS css — `[data-qa="x"]` is valid CSS and resolves as
  // such. The recorder labels its own output `test_attribute` because it knows the
  // provenance; a string an author typed carries none, and inferring one would need
  // the monitor's testIdAttr, which is mutable config the editor cannot see (D3).
  it("treats a bare attribute selector as css, not test_attribute", () => {
    expect(deriveLocatorKind('[data-test="sign-in"]')).toBe("css");
    expect(deriveLocatorKind('[data-qa="submit"]')).toBe("css");
  });

  // The rule that earns first-segment matching. A substring search for `text=`
  // would return "text" here, where the recorder stored "css".
  it("matches the first >> segment only, never a substring", () => {
    expect(deriveLocatorKind("div >> internal:has-text=/^Acme$/ >> nth=0")).toBe("css");
    expect(deriveLocatorKind('[data-test="row"] >> nth=1')).toBe("css");
    expect(deriveLocatorKind('role=row >> internal:text="x"')).toBe("role");
  });

  it("tolerates leading whitespace", () => {
    expect(deriveLocatorKind("  role=button")).toBe("role");
    expect(deriveLocatorKind("   //div")).toBe("xpath");
  });

  it("takes no configuration — the same value always derives the same kind", () => {
    // Guards D3's central property: derivation is a pure function of the value, so
    // it cannot change when a monitor's testIdAttr is edited.
    expect(deriveLocatorKind.length).toBe(1);
  });
});
