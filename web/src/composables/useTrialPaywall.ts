// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { isPaywalledDestination } from "@/utils/auth";

const CLOCK_TICK_MS = 60_000;

// One app-lifetime tick: every tile re-evaluates expiry as time passes without Date.now() in a computed.
const clock = ref(Date.now());
let ticking = false;

const startClock = (): void => {
  if (ticking || typeof window === "undefined") return;
  ticking = true;
  window.setInterval(() => {
    clock.value = Date.now();
  }, CLOCK_TICK_MS);
};

export function useTrialPaywall(): { isPaywalled: (to: RouteLocationRaw) => boolean } {
  const router = useRouter();
  const store = useStore();
  startClock();

  const isPaywalled = (to: RouteLocationRaw): boolean => {
    // lib/core components can mount without a store (useStore() is then undefined); nothing is muted there.
    const expiry = store?.state?.organizationData?.organizationSettings?.free_trial_expiry;
    // Only an org with a trial subscribes its render to the minute tick.
    if (expiry == null || expiry === "" || !Number.isFinite(clock.value)) return false;
    try {
      return isPaywalledDestination(expiry, router.resolve(to));
    } catch {
      return false;
    }
  };

  return { isPaywalled };
}
