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

import { computed, onScopeDispose, ref, watch } from "vue";
import { useStore } from "vuex";

import config from "@/aws-exports";
import announcements from "@/services/announcements";
import { raw, type I18nText } from "@/types/i18n";
import { orderBanners, type BannerVariantName } from "@/utils/announcementOrder";

export type BannerVariant = BannerVariantName;

export interface BannerCta {
  text: I18nText;
  url: string;
}

export interface Banner {
  id: string;
  /** Operator-authored, so it is not translatable — rendered as plain text. */
  message: I18nText;
  variant: BannerVariant;
  /** Microseconds. Absent means "already showing" / "until removed". */
  starts_at?: number;
  ends_at?: number;
  dismissible: boolean;
  cta?: BannerCta;
}

/** The banner as it arrives from the API, before its copy is branded via `raw()`. */
interface WireBanner extends Omit<Banner, "message" | "cta"> {
  message: string;
  cta?: { text: string; url: string };
}

/** Poll cadence. The server reads these from an in-memory cache, so this is cheap. */
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * `setTimeout` saturates past ~24.8 days and background tabs throttle long timers,
 * so a boundary further out than this is left to the next poll to pick up.
 */
const MAX_TIMER_MS = 60 * 60 * 1000;

const DISMISSED_STORAGE_KEY = "o2_dismissed_announcements";

function readDismissed(): string[] {
  try {
    const stored = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    // Private mode or a corrupted entry — treat as nothing dismissed.
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Dismissal not persisting is survivable; the banner reappears next reload.
  }
}

/**
 * Active announcement banners for the current org.
 *
 * Three pieces of timing care, all of which matter for a banner scheduled to the
 * minute:
 * - the server's clock is authoritative, so a viewer whose laptop is minutes off
 *   still flips the banner at the right instant;
 * - a timer is armed on the next boundary rather than waiting out the poll, so a
 *   banner set for 02:00 appears at 02:00 and not somewhere in the next 3 minutes;
 * - polling continues regardless, so a banner published mid-session shows up on a
 *   tab that has been open since yesterday.
 */
export function useAnnouncementBanners() {
  const store = useStore();

  const banners = ref<Banner[]>([]);
  const dismissedIds = ref<string[]>(readDismissed());

  /** Server time minus browser time, in ms. */
  const clockSkewMs = ref(0);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

  const isEnterprise = computed(() => config.isEnterprise === "true");
  const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

  const serverNowMicros = () => (Date.now() + clockSkewMs.value) * 1000;

  const isActive = (banner: Banner, nowMicros: number) => {
    if (banner.starts_at != null && nowMicros < banner.starts_at) return false;
    if (banner.ends_at != null && nowMicros >= banner.ends_at) return false;
    return true;
  };

  /**
   * The server already filtered by org and window, but it did so at fetch time.
   * Re-checking here is what lets the boundary timer flip a banner in place
   * without a round-trip.
   */
  const visibleBanners = computed(() => {
    const nowMicros = serverNowMicros();
    return banners.value.filter(
      (banner) => isActive(banner, nowMicros) && !dismissedIds.value.includes(banner.id),
    );
  });

  /** Same resolver the settings preview uses, so the two always agree. */
  const renderedBanners = computed(() => orderBanners(visibleBanners.value));

  const clearBoundaryTimer = () => {
    if (boundaryTimer) {
      clearTimeout(boundaryTimer);
      boundaryTimer = undefined;
    }
  };

  /**
   * Wake exactly when the next banner appears or disappears.
   *
   * Re-armed on every fetch rather than scheduled once far ahead, which keeps it
   * clear of the timer clamp and of background-tab throttling.
   */
  const armBoundaryTimer = (nextBoundaryMicros?: number) => {
    clearBoundaryTimer();
    if (nextBoundaryMicros == null) return;

    const delayMs = nextBoundaryMicros / 1000 - (Date.now() + clockSkewMs.value);
    if (delayMs <= 0 || delayMs > MAX_TIMER_MS) return;

    // +1s of slack so the refetch lands just past the boundary rather than
    // racing it.
    boundaryTimer = setTimeout(() => void fetchBanners(), delayMs + 1000);
  };

  const fetchBanners = async () => {
    const org = orgIdentifier.value;

    if (!org || !isEnterprise.value) {
      banners.value = [];
      return;
    }

    try {
      const response = await announcements.getActive(org);
      const data = response?.data ?? {};

      if (typeof data.now === "number") {
        clockSkewMs.value = data.now / 1000 - Date.now();
      }

      // Operator-authored copy is not translatable, but it still has to satisfy
      // the text brand to reach a template.
      const authored: Banner[] = Array.isArray(data.banners)
        ? data.banners.map((banner: WireBanner) => ({
            ...banner,
            message: raw(banner.message),
            cta: banner.cta ? { text: raw(banner.cta.text), url: banner.cta.url } : undefined,
          }))
        : [];

      // Already most-severe-first from the server; the order is kept as-is so
      // every node and every tab agrees on which banner sits on top.
      banners.value = authored;

      armBoundaryTimer(data.next_boundary ?? undefined);
    } catch {
      // A banner is decoration on top of the app — a failed fetch must never
      // surface an error to the user. Keep whatever is already on screen.
    }
  };

  const dismiss = (id: string) => {
    if (dismissedIds.value.includes(id)) return;
    dismissedIds.value = [...dismissedIds.value, id];
    writeDismissed(dismissedIds.value);
  };

  const start = () => {
    void fetchBanners();
    pollTimer = setInterval(() => void fetchBanners(), POLL_INTERVAL_MS);
  };

  // Switching orgs changes which banners apply, so refetch rather than carrying
  // the previous org's set across.
  watch(orgIdentifier, () => void fetchBanners());

  onScopeDispose(() => {
    if (pollTimer) clearInterval(pollTimer);
    clearBoundaryTimer();
  });

  return {
    banners: renderedBanners,
    dismiss,
    start,
    refresh: fetchBanners,
  };
}
