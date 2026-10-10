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

import { computed, onScopeDispose, readonly, ref, watch } from "vue";
import { useStore } from "vuex";

import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import announcements from "@/services/announcements";
import { announcementKeys } from "@/services/announcements.querykeys";
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
  /** Per-module counts, set only on the generated downtime banners (D19). */
  counts?: { module: string; count: number }[];
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

/** True when one of a write's invalidation scopes is a prefix of `target`. */
function coversKey(
  scopes: readonly (readonly unknown[])[] | undefined,
  target: readonly unknown[],
) {
  return (scopes ?? []).some((scope) => scope.every((part, i) => part === target[i]));
}

/** Server time minus browser time, in ms; module scope so every chip counts on the banner's clock. */
const clockSkewMs = ref(0);

/** Bumped each time a banner boundary passes, so other views can refetch on it. */
const boundaryTick = ref(0);

/** Browser clock corrected by the skew the last `/announcements` response measured. */
export const serverNowMs = () => Date.now() + clockSkewMs.value;

/** Increments on every banner boundary (a downtime window opening or closing). */
export const bannerBoundaryTick = readonly(boundaryTick);

/** Reactive server-minus-browser skew in ms, so a timer armed on `serverNowMs` can re-arm when it changes. */
export const serverClockSkewMs = readonly(clockSkewMs);

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

  /** Re-evaluates the window filter when a boundary passes, since `Date.now()` is not reactive. */
  const nowTick = ref(0);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

  const isEnterprise = computed(() => config.isEnterprise === "true");
  const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

  const serverNowMicros = () => serverNowMs() * 1000;

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
    void nowTick.value;
    const nowMicros = serverNowMicros();
    return banners.value.filter(
      (banner) => isActive(banner, nowMicros) && !dismissedIds.value.includes(banner.id),
    );
  });

  /** Same resolver the settings preview uses, so the two always agree. */
  const renderedBanners = computed<Banner[]>(() => orderBanners(visibleBanners.value));

  const clearBoundaryTimer = () => {
    if (boundaryTimer) {
      clearTimeout(boundaryTimer);
      boundaryTimer = undefined;
    }
  };

  /** The nearest future instant at which the server's next boundary or a loaded banner's own window flips. */
  const nextFlipMicros = (serverBoundary?: number) => {
    const nowMicros = serverNowMicros();
    const edges = banners.value.flatMap((b) => [b.starts_at, b.ends_at]);
    const future = [serverBoundary, ...edges].filter(
      (at): at is number => typeof at === "number" && at > nowMicros,
    );
    return future.length ? Math.min(...future) : undefined;
  };

  /**
   * Wake exactly when the next banner appears or disappears.
   *
   * Re-armed on every fetch rather than scheduled once far ahead, which keeps it
   * clear of the timer clamp and of background-tab throttling.
   */
  const armBoundaryTimer = (nextBoundaryMicros?: number) => {
    clearBoundaryTimer();
    const at = nextFlipMicros(nextBoundaryMicros);
    if (at == null) return;

    const delayMs = at / 1000 - serverNowMs();
    if (delayMs > MAX_TIMER_MS) return;

    // +1s of slack so the refetch lands just past the boundary rather than
    // racing it.
    boundaryTimer = setTimeout(
      () => {
        boundaryTimer = undefined;
        nowTick.value += 1;
        boundaryTick.value += 1;
        void fetchBanners();
      },
      Math.max(0, delayMs) + 1000,
    );
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
      if (!boundaryTimer) armBoundaryTimer();
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

  // Banners live outside the query cache, so a write that invalidates their scope refetches here.
  const unsubscribeWrites = queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const org = orgIdentifier.value;
    if (org && coversKey(event.mutation.meta?.invalidates, announcementKeys.active(org))) {
      void fetchBanners();
    }
  });

  onScopeDispose(() => {
    if (pollTimer) clearInterval(pollTimer);
    clearBoundaryTimer();
    unsubscribeWrites();
  });

  return {
    banners: renderedBanners,
    dismiss,
    start,
    refresh: fetchBanners,
    serverNowMs,
  };
}
