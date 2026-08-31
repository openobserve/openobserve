// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { suggestFolderIcon } from "./folderIcons";
import { ALL_EMOJIS } from "@/lib/forms/EmojiPicker/emojiCatalog";

describe("suggestFolderIcon", () => {
  it("should return null for an empty or whitespace-only name", () => {
    expect(suggestFolderIcon("")).toBeNull();
    expect(suggestFolderIcon("   ")).toBeNull();
  });

  it("should match an exact keyword", () => {
    expect(suggestFolderIcon("production")).toBe("🚀");
    expect(suggestFolderIcon("security")).toBe("🔒");
    expect(suggestFolderIcon("database")).toBe("🗄️");
  });

  it("should match a keyword inside a multi-word name", () => {
    expect(suggestFolderIcon("Payments Database")).toBe("🗄️");
    expect(suggestFolderIcon("Prod Alerts")).toBe("🚀");
  });

  it("should be case and punctuation insensitive", () => {
    expect(suggestFolderIcon("PRODUCTION")).toBe("🚀");
    expect(suggestFolderIcon("prod-us-east")).toBe("🚀");
    expect(suggestFolderIcon("  Security_Reviews  ")).toBe("🔒");
  });

  it("should ignore stop words rather than matching on them", () => {
    // "the"/"and" carry no signal, so this falls through to the neutral pool
    // instead of matching something arbitrary.
    const result = suggestFolderIcon("the and for");
    expect(result).not.toBeNull();
    expect(suggestFolderIcon("the and for")).toBe(result);
  });

  it("should fall back to a neutral emoji when nothing matches", () => {
    const result = suggestFolderIcon("Zyxwv Qqq");
    expect(result).not.toBeNull();
    expect(["📁", "🗂️", "🗃️", "📦", "🧩", "🏷️", "📌", "🧰", "📐", "💼"]).toContain(result);
  });

  it("should be deterministic — the same name always gives the same emoji", () => {
    const names = ["Prod", "Zyxwv Qqq", "team notes", "checkout-service", "q"];
    for (const name of names) {
      expect(suggestFolderIcon(name)).toBe(suggestFolderIcon(name));
    }
  });

  it("should only ever return an emoji from the catalog", () => {
    const catalog = new Set(ALL_EMOJIS.map((option) => option.token));
    const names = ["prod", "bugs", "nothing matches here", "K8s", "billing", "x"];
    for (const name of names) {
      const result = suggestFolderIcon(name);
      expect(result).not.toBeNull();
      expect(catalog.has(result!)).toBe(true);
    }
  });

  it("should not match a one or two letter token by prefix", () => {
    // "db" is a real keyword, but a 2-char token must match it exactly rather
    // than prefix-matching half the catalog.
    expect(suggestFolderIcon("db")).toBe("🗄️");
    // "p" matches nothing, so the neutral pool answers.
    expect(["📁", "🗂️", "🗃️", "📦", "🧩", "🏷️", "📌", "🧰", "📐", "💼"]).toContain(
      suggestFolderIcon("p"),
    );
  });

  it("should map a product name to its real brand mark, not an emoji stand-in", () => {
    // A generic package box for Docker was the original bug; a whale is only a
    // stand-in. These resolve to registry glyphs — the actual logos.
    expect(suggestFolderIcon("docker")).toBe("o2:docker");
    expect(suggestFolderIcon("kubernetes")).toBe("o2:kubernetes");
    expect(suggestFolderIcon("k8s")).toBe("o2:kubernetes");
    expect(suggestFolderIcon("postgres")).toBe("o2:postgresql");
    expect(suggestFolderIcon("mysql")).toBe("o2:mysql");
    expect(suggestFolderIcon("mongodb")).toBe("o2:mongodb");
    expect(suggestFolderIcon("python")).toBe("o2:python");
    expect(suggestFolderIcon("linux")).toBe("o2:linux");
    expect(suggestFolderIcon("github")).toBe("o2:github");
    // The whole point of the registry: things Unicode has no symbol for at all.
    expect(suggestFolderIcon("redis")).toBe("o2:redis");
    expect(suggestFolderIcon("kafka")).toBe("o2:kafka");
    expect(suggestFolderIcon("terraform")).toBe("o2:terraform");
    expect(suggestFolderIcon("prometheus")).toBe("o2:prometheus");
    expect(suggestFolderIcon("nginx")).toBe("o2:nginx");
    expect(suggestFolderIcon("grafana")).toBe("o2:grafana");
  });

  it("should keep the creature emoji reachable by its creature name", () => {
    // Brands took the product words, so the animals keep the animal words —
    // nothing became unreachable.
    expect(suggestFolderIcon("whale")).toBe("🐳");
    expect(suggestFolderIcon("elephant")).toBe("🐘");
    expect(suggestFolderIcon("penguin")).toBe("🐧");
    expect(suggestFolderIcon("coffee")).toBe("☕");
  });

  it("should keep generic terms on the generic emoji", () => {
    expect(suggestFolderIcon("packages")).toBe("📦");
    expect(suggestFolderIcon("containers")).toBe("o2:docker");
    expect(suggestFolderIcon("database")).toBe("🗄️");
  });

  it("should resolve a brand inside a longer folder name", () => {
    // Two hits on Kubernetes (kubernetes + cluster) beat one hit on 🚨 (alerts).
    expect(suggestFolderIcon("Kubernetes Cluster Alerts")).toBe("o2:kubernetes");
    expect(suggestFolderIcon("prod postgres")).toBe("🚀");
    expect(suggestFolderIcon("Payments MySQL")).toBe("o2:mysql");
  });

  it("should let a brand win a tie against a generic infra word", () => {
    // "Docker Hosts" scores Docker and 🖥️ equally; the brands group sits ahead
    // of infra precisely so the specific mark wins.
    expect(suggestFolderIcon("Docker Hosts")).toBe("o2:docker");
    expect(suggestFolderIcon("Linux Hosts")).toBe("o2:linux");
    expect(suggestFolderIcon("Go Services")).toBe("o2:go");
  });

  it("should prefer a stronger match over a weaker one", () => {
    // "alerts" is an exact keyword on 🚨; "alert" only prefix-matches it.
    expect(suggestFolderIcon("alerts")).toBe("🚨");
    expect(suggestFolderIcon("alert")).toBe("🚨");
  });
});
