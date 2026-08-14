// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";

const store = { state: { selectedOrganization: { identifier: "org-a" } } };
vi.mock("vuex", () => ({ useStore: () => store }));

import { useFolderIcons, __resetFolderIconCache } from "./useFolderIcons";

describe("useFolderIcons", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetFolderIconCache();
    store.state.selectedOrganization.identifier = "org-a";
  });

  it("should return null for a folder with no icon anywhere", () => {
    const { iconFor } = useFolderIcons("alerts");
    expect(iconFor({ folderId: "f1" })).toBeNull();
  });

  it("should prefer a server-provided icon over the local one", () => {
    const { iconFor, setIcon } = useFolderIcons("alerts");
    setIcon("f1", "📁");
    expect(iconFor({ folderId: "f1", icon: "🚀" })).toBe("🚀");
  });

  it("should fall back to the locally stored icon", () => {
    const { iconFor, setIcon } = useFolderIcons("alerts");
    setIcon("f1", "🔒");
    expect(iconFor({ folderId: "f1" })).toBe("🔒");
    expect(iconFor({ folderId: "f1", icon: null })).toBe("🔒");
    expect(iconFor({ folderId: "f1", icon: "   " })).toBe("🔒");
  });

  it("should persist to localStorage under an org- and type-scoped key", () => {
    const { setIcon } = useFolderIcons("alerts");
    setIcon("f1", "🚨");
    const stored = window.localStorage.getItem("o2:folder-icons:org-a:alerts");
    expect(JSON.parse(stored!)).toEqual({ f1: "🚨" });
  });

  it("should not leak icons across folder types", () => {
    useFolderIcons("alerts").setIcon("f1", "🚨");
    expect(useFolderIcons("dashboards").iconFor({ folderId: "f1" })).toBeNull();
  });

  it("should not leak icons across organizations", () => {
    useFolderIcons("alerts").setIcon("f1", "🚨");
    store.state.selectedOrganization.identifier = "org-b";
    expect(useFolderIcons("alerts").iconFor({ folderId: "f1" })).toBeNull();
  });

  it("should remove an icon when passed null or empty", () => {
    const { iconFor, setIcon, removeIcon } = useFolderIcons("alerts");
    setIcon("f1", "🚨");
    setIcon("f1", null);
    expect(iconFor({ folderId: "f1" })).toBeNull();

    setIcon("f1", "🚨");
    setIcon("f1", "   ");
    expect(iconFor({ folderId: "f1" })).toBeNull();

    setIcon("f1", "🚨");
    removeIcon("f1");
    expect(iconFor({ folderId: "f1" })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("o2:folder-icons:org-a:alerts")!)).toEqual({});
  });

  it("should read back icons written by an earlier session", () => {
    window.localStorage.setItem("o2:folder-icons:org-a:alerts", JSON.stringify({ f9: "🦉" }));
    expect(useFolderIcons("alerts").iconFor({ folderId: "f9" })).toBe("🦉");
  });

  it("should survive corrupt stored data instead of throwing", () => {
    window.localStorage.setItem("o2:folder-icons:org-a:alerts", "{not json");
    const { iconFor, setIcon } = useFolderIcons("alerts");
    expect(iconFor({ folderId: "f1" })).toBeNull();
    expect(() => setIcon("f1", "🚀")).not.toThrow();
    expect(iconFor({ folderId: "f1" })).toBe("🚀");
  });

  it("should ignore a folder with no id", () => {
    const { iconFor, setIcon } = useFolderIcons("alerts");
    expect(iconFor(null)).toBeNull();
    expect(iconFor(undefined)).toBeNull();
    expect(() => setIcon("", "🚀")).not.toThrow();
    expect(window.localStorage.getItem("o2:folder-icons:org-a:alerts")).toBeNull();
  });

  it("should follow a reactive type source, as call sites pass () => props.type", () => {
    const type = ref("alerts");
    const { iconFor, setIcon } = useFolderIcons(() => type.value);
    setIcon("f1", "🚨");
    expect(iconFor({ folderId: "f1" })).toBe("🚨");
    type.value = "reports";
    expect(iconFor({ folderId: "f1" })).toBeNull();
  });
});
