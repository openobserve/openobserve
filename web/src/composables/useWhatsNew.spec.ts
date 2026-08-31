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

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable so a case can flip the build edition.
const mockConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: mockConfig }));

const mockStore = vi.hoisted(() => ({
  state: {
    zoConfig: { version: "0.93.0" } as { version: string },
    currentuser: { role: "admin" } as { role: string },
  },
}));
vi.mock("vuex", () => ({ useStore: () => mockStore }));

import { WHATS_NEW_SEEN_KEY, UPDATE_SKIPPED_KEY } from "@/constants/whatsNew";

import { compareVersions } from "./useWhatsNew";

/**
 * The composable keeps its manifest at module scope so the header chip and the
 * dialog agree — which means the module must be re-imported to reset it.
 */
async function freshComposable() {
  vi.resetModules();
  const mod = await import("./useWhatsNew");
  const api = mod.useWhatsNew();
  api.load();
  return api;
}

beforeEach(() => {
  window.localStorage.clear();
  mockConfig.isEnterprise = "false";
  mockConfig.isCloud = "false";
  mockStore.state.zoConfig = { version: "0.93.0" };
  mockStore.state.currentuser = { role: "admin" };
});

describe("compareVersions", () => {
  it("orders by each numeric segment", () => {
    expect(compareVersions("0.93.0", "0.92.0")).toBeGreaterThan(0);
    expect(compareVersions("0.92.0", "0.93.0")).toBeLessThan(0);
    expect(compareVersions("0.93.0", "0.93.0")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("tolerates a v prefix and missing segments", () => {
    expect(compareVersions("v0.93.0", "0.93.0")).toBe(0);
    expect(compareVersions("0.93", "0.93.0")).toBe(0);
  });

  // A nightly must not read as newer than the release it precedes.
  it("ignores a pre-release suffix", () => {
    expect(compareVersions("0.93.0-rc1", "0.93.0")).toBe(0);
  });
});

describe("edition filtering", () => {
  it("hides enterprise-only highlights from an OSS build", async () => {
    const { currentRelease, visibleHighlights } = await freshComposable();
    const shown = visibleHighlights(currentRelease.value!);

    expect(shown.length).toBeLessThan(currentRelease.value!.highlights.length);
    expect(shown.every((h) => h.editions.includes("oss"))).toBe(true);
  });

  it("shows enterprise-only highlights on an enterprise build", async () => {
    mockConfig.isEnterprise = "true";
    const { currentRelease, visibleHighlights } = await freshComposable();

    expect(visibleHighlights(currentRelease.value!)).toHaveLength(
      currentRelease.value!.highlights.length,
    );
  });
});

describe("update indicator", () => {
  it("is shown to a self-hosted admin running behind latest", async () => {
    mockStore.state.zoConfig = { version: "0.91.0" };
    const { updateAvailable, releasesBehind } = await freshComposable();

    expect(updateAvailable.value).toBe(true);
    expect(releasesBehind.value).toBe(2);
  });

  it("is hidden on cloud, which is always current", async () => {
    mockConfig.isCloud = "true";
    mockStore.state.zoConfig = { version: "0.91.0" };
    const { updateAvailable } = await freshComposable();

    expect(updateAvailable.value).toBe(false);
  });

  it("is hidden from a non-admin, who cannot act on it", async () => {
    mockStore.state.currentuser = { role: "member" };
    mockStore.state.zoConfig = { version: "0.91.0" };
    const { updateAvailable } = await freshComposable();

    expect(updateAvailable.value).toBe(false);
  });

  it("stays suppressed once the version is skipped", async () => {
    mockStore.state.zoConfig = { version: "0.91.0" };
    const { updateAvailable, skipUpdate } = await freshComposable();

    expect(updateAvailable.value).toBe(true);
    skipUpdate();
    expect(updateAvailable.value).toBe(false);
    expect(window.localStorage.getItem(UPDATE_SKIPPED_KEY)).toBe("0.93.0");
  });
});

describe("first-open trigger", () => {
  it("stays closed on a first-ever visit rather than replaying all history", async () => {
    const { openIfUnseen, carouselOpen, spannedReleases } = await freshComposable();
    openIfUnseen();

    expect(spannedReleases.value).toHaveLength(0);
    expect(carouselOpen.value).toBe(false);
  });

  // Without this the next upgrade still looks like a first visit and stays silent.
  it("records a baseline on a first-ever visit so the next upgrade fires", async () => {
    mockStore.state.zoConfig = { version: "0.91.0" };
    const first = await freshComposable();
    first.openIfUnseen();

    expect(first.carouselOpen.value).toBe(false);
    expect(window.localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe("0.91.0");

    mockStore.state.zoConfig = { version: "0.93.0" };
    const next = await freshComposable();
    next.openIfUnseen();

    expect(next.spannedReleases.value.map((r) => r.version)).toEqual(["0.93.0", "0.92.0"]);
    expect(next.carouselOpen.value).toBe(true);
  });

  it("opens after an upgrade and acknowledges the version on close", async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, "0.92.0");
    const { openIfUnseen, carouselOpen, closeCarousel } = await freshComposable();

    openIfUnseen();
    expect(carouselOpen.value).toBe(true);

    closeCarousel();
    expect(carouselOpen.value).toBe(false);
    expect(window.localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe("0.93.0");
  });

  it("stays closed when the running version has no notes", async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, "0.92.0");
    mockStore.state.zoConfig = { version: "0.94.0" };
    const { openIfUnseen, carouselOpen } = await freshComposable();

    openIfUnseen();
    expect(carouselOpen.value).toBe(false);
  });

  // A multi-version jump is one carousel, not three in a row.
  it("merges every crossed release into a single run of slides", async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, "0.90.0");
    const { openIfUnseen, spannedReleases, slides } = await freshComposable();
    openIfUnseen();

    expect(spannedReleases.value.map((r) => r.version)).toEqual(["0.93.0", "0.92.0", "0.91.0"]);

    const cover = slides.value[0];
    expect(cover.kind).toBe("cover");
    if (cover.kind === "cover") expect(cover.span).toHaveLength(3);
  });
});

describe("slides", () => {
  it("wraps the highlights in a cover and an outro", async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, "0.92.0");
    const { openIfUnseen, slides } = await freshComposable();
    openIfUnseen();

    expect(slides.value.at(0)?.kind).toBe("cover");
    expect(slides.value.at(-1)?.kind).toBe("outro");
    expect(slides.value.filter((s) => s.kind === "highlight").length).toBeGreaterThan(0);
  });

  it("caps the reel at six highlights", async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, "0.90.0");
    mockConfig.isEnterprise = "true";
    const { openIfUnseen, slides } = await freshComposable();
    openIfUnseen();

    expect(slides.value.filter((s) => s.kind === "highlight")).toHaveLength(6);
  });

  // Opening from the Help menu must never land on an empty dialog.
  it("falls back to the newest release when nothing was crossed", async () => {
    const { openCarousel, carouselOpen, slides } = await freshComposable();
    openCarousel();

    expect(carouselOpen.value).toBe(true);
    expect(slides.value.length).toBeGreaterThan(1);
  });
});

describe("media", () => {
  it("resolves a light and dark pair, and leaves media-less highlights bare", async () => {
    mockConfig.isEnterprise = "true";
    const { currentRelease } = await freshComposable();
    const highlights = currentRelease.value!.highlights;

    const withMedia = highlights.find((h) => h.id === "slo");
    expect(withMedia?.media?.light).toContain("sample-slo-light.svg");
    expect(withMedia?.media?.dark).toContain("sample-slo-dark.svg");
    expect(withMedia?.media?.alt).toBeTruthy();

    expect(highlights.find((h) => h.id === "terraform")?.media).toBeUndefined();
  });
});
