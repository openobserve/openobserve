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

import { computed, ref } from "vue";
import { useStore } from "vuex";

import config from "@/aws-exports";
import {
  LOCAL_MANIFEST,
  MAX_HIGHLIGHTS,
  SUPPORTED_FORMAT_VERSION,
  UPDATE_SKIPPED_KEY,
  WHATS_NEW_SEEN_KEY,
  resolveMediaUrl,
} from "@/constants/whatsNew";
import { iconRegistry, type IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw } from "@/types/i18n";
import type {
  Release,
  ReleaseEdition,
  ReleaseHighlight,
  WhatsNewManifest,
  WhatsNewSlide,
  WireHighlight,
  WireManifest,
  WireRelease,
} from "@/types/whatsNew";

/** Shown when a highlight names an icon this build does not ship. */
const FALLBACK_ICON: IconName = "auto-awesome";

// Module scope on purpose: the header chip and the dialog are separate
// components that must agree on one open state and one manifest.
const manifest = ref<WhatsNewManifest | null>(null);
const carouselOpen = ref(false);
const slideIndex = ref(0);
const seenVersion = ref(readStored(WHATS_NEW_SEEN_KEY));
const skippedVersion = ref(readStored(UPDATE_SKIPPED_KEY));

function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // Private mode — treat as nothing acknowledged.
    return "";
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not persisting is survivable; the notes reappear next reload.
  }
}

/**
 * Semver-ish ordering over `major.minor.patch`.
 *
 * Any pre-release suffix is ignored rather than parsed — a nightly tag must not
 * read as newer than the release it precedes.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function normalizeHighlight(wire: WireHighlight): ReleaseHighlight {
  return {
    id: wire.id,
    // Authored per release, so it can never reach the locale catalogue.
    title: raw(wire.title),
    body: raw(wire.body),
    icon: Object.hasOwn(iconRegistry, wire.icon) ? (wire.icon as IconName) : FALLBACK_ICON,
    editions: wire.editions,
    docsUrl: wire.docs_url,
    media: wire.media
      ? {
          light: resolveMediaUrl(wire.media.light),
          dark: resolveMediaUrl(wire.media.dark),
          alt: raw(wire.media.alt),
        }
      : undefined,
  };
}

function normalizeRelease(wire: WireRelease): Release {
  return {
    version: wire.version,
    date: wire.date,
    title: raw(wire.title),
    summary: raw(wire.summary),
    url: wire.url,
    highlights: wire.highlights.map(normalizeHighlight),
  };
}

/** Wire document to render model, newest release first. */
export function normalizeManifest(wire: WireManifest): WhatsNewManifest | null {
  if (wire.format_version !== SUPPORTED_FORMAT_VERSION) return null;

  return {
    formatVersion: wire.format_version,
    latest: wire.latest,
    releases: wire.releases
      .map(normalizeRelease)
      .sort((a, b) => compareVersions(b.version, a.version)),
  };
}

export function useWhatsNew() {
  const store = useStore();

  const runningVersion = computed<string>(() => store.state.zoConfig?.version ?? "");

  /**
   * Which highlights this deployment can act on.
   *
   * Cloud wins over build type: a cloud tenant runs an enterprise build but
   * should never be shown a self-hosted-only note.
   */
  const edition = computed<ReleaseEdition>(() => {
    if (config.isCloud === "true") return "cloud";
    return config.isEnterprise === "true" ? "enterprise" : "oss";
  });

  const isAdmin = computed(() => store.state.currentuser?.role === "admin");

  const releases = computed<Release[]>(() => manifest.value?.releases ?? []);

  const visibleHighlights = (release: Release): ReleaseHighlight[] =>
    release.highlights.filter((h) => h.editions.includes(edition.value));

  const releaseFor = (version: string): Release | undefined =>
    releases.value.find((r) => r.version === version);

  /** Notes for the running build. Absent means this release shipped without any. */
  const currentRelease = computed<Release | undefined>(() => releaseFor(runningVersion.value));

  /**
   * Every release crossed since the notes were last acknowledged, newest first.
   *
   * A first-ever visit has no stored version, which would otherwise span the
   * entire history — anchor it to the running build so the span comes out empty
   * and a brand-new install is not shown notes it has no baseline for.
   */
  const spannedReleases = computed<Release[]>(() => {
    if (!runningVersion.value) return [];
    const from = seenVersion.value || runningVersion.value;

    return releases.value.filter(
      (r) =>
        compareVersions(r.version, from) > 0 &&
        compareVersions(r.version, runningVersion.value) <= 0,
    );
  });

  /**
   * Whether the carousel should open by itself.
   *
   * Both halves matter: something must actually have been crossed, AND notes
   * must exist for the running version. A release nobody wrote notes for ships
   * silently rather than opening an empty dialog — that is what keeps this from
   * rotting. Read `spannedReleases` here and not `slides`, which carries a
   * fallback for the menu and would otherwise fire on a fresh install.
   */
  const hasUnseenRelease = computed(
    () => !!currentRelease.value && spannedReleases.value.length > 0,
  );

  /**
   * Whether to badge the Help menu.
   *
   * Deliberately narrower than {@link updateAvailable}, which is about a version
   * you could install. This is about notes for the version you are ALREADY
   * running and have not opened — so it clears the moment the carousel closes,
   * rather than sitting there permanently for anyone not on latest.
   */
  const hasUnreadNotes = computed(
    () =>
      !!currentRelease.value &&
      !!seenVersion.value &&
      compareVersions(runningVersion.value, seenVersion.value) > 0,
  );

  const latestVersion = computed(() => manifest.value?.latest ?? "");

  /**
   * Cloud is always current and a non-admin cannot act on it, so neither is
   * told. A skipped version stays suppressed until something newer ships.
   */
  const updateAvailable = computed(() => {
    if (edition.value === "cloud" || !isAdmin.value) return false;
    if (!latestVersion.value || !runningVersion.value) return false;
    if (compareVersions(latestVersion.value, runningVersion.value) <= 0) return false;
    return compareVersions(latestVersion.value, skippedVersion.value || "0.0.0") > 0;
  });

  const releasesBehind = computed(
    () => releases.value.filter((r) => compareVersions(r.version, runningVersion.value) > 0).length,
  );

  /**
   * What the open carousel renders.
   *
   * Falls back to the newest published release when nothing was crossed, so
   * opening "What's new" from the menu on an up-to-date build shows the latest
   * notes rather than an empty dialog. The automatic trigger stays gated on
   * {@link spannedReleases} and is unaffected.
   */
  const carouselReleases = computed<Release[]>(() =>
    spannedReleases.value.length ? spannedReleases.value : releases.value.slice(0, 1),
  );

  /** Cover, one slide per highlight, then the closing slide. */
  const slides = computed<WhatsNewSlide[]>(() => {
    const span = carouselReleases.value;
    if (!span.length) return [];

    const items: Array<{ highlight: ReleaseHighlight; version: string }> = [];
    span.forEach((release) => {
      visibleHighlights(release).forEach((highlight) =>
        items.push({ highlight, version: release.version }),
      );
    });

    const newest = span[0];
    return [
      { kind: "cover", release: newest, span, highlightCount: items.length },
      ...items
        .slice(0, MAX_HIGHLIGHTS)
        .map(({ highlight, version }) => ({ kind: "highlight" as const, highlight, version })),
      { kind: "outro", release: newest },
    ];
  });

  const currentSlide = computed<WhatsNewSlide | undefined>(() => slides.value[slideIndex.value]);
  const isFirstSlide = computed(() => slideIndex.value === 0);
  const isLastSlide = computed(() => slideIndex.value >= slides.value.length - 1);

  const goToSlide = (index: number) => {
    slideIndex.value = Math.min(Math.max(index, 0), Math.max(slides.value.length - 1, 0));
  };
  const nextSlide = () => goToSlide(slideIndex.value + 1);
  const previousSlide = () => goToSlide(slideIndex.value - 1);

  /** Loads the manifest. Local for now; the S3 fetch drops in here unchanged. */
  const load = () => {
    if (manifest.value) return;
    manifest.value = normalizeManifest(LOCAL_MANIFEST);
  };

  const openCarousel = () => {
    load();
    slideIndex.value = 0;
    carouselOpen.value = true;
  };

  const acknowledgeRunningVersion = () => {
    if (!runningVersion.value) return;
    seenVersion.value = runningVersion.value;
    writeStored(WHATS_NEW_SEEN_KEY, runningVersion.value);
  };

  /** Marks the running version acknowledged so it does not open again. */
  const closeCarousel = () => {
    carouselOpen.value = false;
    acknowledgeRunningVersion();
  };

  const skipUpdate = () => {
    if (!latestVersion.value) return;
    skippedVersion.value = latestVersion.value;
    writeStored(UPDATE_SKIPPED_KEY, latestVersion.value);
  };

  /**
   * Opens the carousel on first load after an upgrade, and never otherwise.
   *
   * A first-ever visit records the running version without opening — otherwise
   * there is no baseline, and the NEXT upgrade would still look like a first
   * visit and stay silent.
   */
  const openIfUnseen = () => {
    load();
    if (!seenVersion.value) {
      acknowledgeRunningVersion();
      return;
    }
    if (hasUnseenRelease.value) openCarousel();
  };

  return {
    carouselOpen,
    carouselReleases,
    closeCarousel,
    compareVersions,
    currentRelease,
    currentSlide,
    edition,
    goToSlide,
    hasUnreadNotes,
    hasUnseenRelease,
    isFirstSlide,
    isLastSlide,
    latestVersion,
    load,
    nextSlide,
    openCarousel,
    openIfUnseen,
    previousSlide,
    releases,
    releasesBehind,
    runningVersion,
    skipUpdate,
    slideIndex,
    slides,
    spannedReleases,
    updateAvailable,
    visibleHighlights,
  };
}
