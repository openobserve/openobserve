// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { useFolderIcons } from "./useFolderIcons";

describe("useFolderIcons", () => {
  const { iconFor } = useFolderIcons();

  it("should return the folder's icon token", () => {
    expect(iconFor({ folderId: "f1", icon: "🚀" })).toBe("🚀");
  });

  it("should return a registry glyph token unchanged", () => {
    // The token is opaque here — OGlyph is what tells an emoji from an "o2:" ref.
    expect(iconFor({ folderId: "f1", icon: "o2:redis" })).toBe("o2:redis");
    expect(iconFor({ folderId: "f1", icon: "o2:ai-anthropic" })).toBe("o2:ai-anthropic");
  });

  it("should return null for a folder with no icon", () => {
    expect(iconFor({ folderId: "f1" })).toBeNull();
    expect(iconFor({ folderId: "f1", icon: null })).toBeNull();
  });

  // The column is nullable, but an older row or a client that sent "" would
  // otherwise reach the rail as a truthy token and render an empty glyph.
  it("should normalise empty and whitespace-only icons to null", () => {
    expect(iconFor({ folderId: "f1", icon: "" })).toBeNull();
    expect(iconFor({ folderId: "f1", icon: "   " })).toBeNull();
  });

  it("should trim surrounding whitespace off a real token", () => {
    expect(iconFor({ folderId: "f1", icon: "  o2:kafka  " })).toBe("o2:kafka");
  });

  it("should tolerate a missing folder rather than throwing", () => {
    // The dropdowns call this with the result of a .find(), which is undefined
    // while the folder list is still loading.
    expect(iconFor(null)).toBeNull();
    expect(iconFor(undefined)).toBeNull();
  });

  it("should not require a folderId, since it only reads the icon", () => {
    expect(iconFor({ icon: "🚀" })).toBe("🚀");
  });
});
