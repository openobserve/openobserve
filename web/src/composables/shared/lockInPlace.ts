// Copyright 2026 OpenObserve Inc.

import { computed, defineComponent, h, type Component } from "vue";
import { useStore } from "vuex";
import FeatureLockInline from "@/components/common/FeatureLockInline.vue";
import { gt } from "@/types/i18n";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import type { FeatureKey } from "@/utils/enterpriseFeatures";
import { routeGuard } from "@/utils/zincutils";

/**
 * Gates a route in place: a direct load and in-app navigation both render the feature's
 * lock where the page would be, and unlock live when `zoConfig` arrives.
 */
export function lockInPlace(
  key: FeatureKey,
  route: any,
  guard: (to: any, from: any, next: any) => void = routeGuard,
  isAllowed?: () => boolean,
) {
  const load = route.component;
  const component = async () => {
    const loaded = typeof load === "function" && !load.setup ? await load() : { default: load };
    const Page: Component = loaded.default ?? loaded;
    return defineComponent({
      name: "LockInPlace",
      inheritAttrs: false,
      setup(_, { attrs }) {
        const store = useStore();
        const allowed = computed(
          () => checkFeatureAccess(key, buildFeatureGateContext(store.state.zoConfig)).allowed,
        );
        return () =>
          allowed.value
            ? h(Page, attrs)
            : h(FeatureLockInline, {
                featureKey: key,
                name: gt(
                  route.meta?.lockTitleKey ?? route.meta?.titleKey ?? "featureLock.thisFeature",
                ),
              });
      },
    });
  };
  // A page's own guard may bounce home on a flag that is off when the edition is what is missing.
  const beforeEnter = (to: any, from: any, next: any) =>
    (isAllowed && !isAllowed() ? routeGuard : guard)(to, from, next);
  return { ...route, component, beforeEnter };
}

/** Opens every route gated by `withFeatureGate` in place with its lock, so locked pages never redirect. */
export function lockGatedRoutes(routes: any[]): any[] {
  return routes.map((route) => {
    const gate = route.beforeEnter as any;
    const children = route.children ? lockGatedRoutes(route.children) : undefined;
    const next = children ? { ...route, children } : route;
    if (!gate?.lockKey || !route.component) return next;
    return lockInPlace(gate.lockKey, next, gate.lockGuard, gate.lockAllowed);
  });
}
