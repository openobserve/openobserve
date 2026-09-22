// Copyright 2026 OpenObserve Inc.
//
// Real browser history, when there is one, instead of a hand-built push: the
// page's exact prior state (filters, scroll-eligible URL) round-trips exactly
// as the user left it — the same guarantee the browser's own back button
// gives, since it's the same history entry. A hand-built push can only guess.

import { useRouter } from "vue-router";
import type { RouteLocationRaw } from "vue-router";

export default function useSmartBack(fallback: () => RouteLocationRaw) {
  const router = useRouter();

  function goBack() {
    if (window.history.state?.back) {
      router.back();
      return;
    }
    // No history to pop (direct link / reload) — reconstruct a sane landing
    // spot. Evaluated lazily so a fallback reading current route/props state
    // isn't built on every render, only when actually needed.
    router.push(fallback());
  }

  return { goBack };
}
