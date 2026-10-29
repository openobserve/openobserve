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

import {
  computed,
  getCurrentInstance,
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { siteURL } from "@/constants/config";
import { featureState } from "@/utils/featureGate";
import type { I18nText } from "@/types/i18n";

export interface FeatureLock {
  locked: Readonly<Ref<boolean>>;
  feature: Readonly<Ref<string | null>>;
}

const FEATURE_LOCK: InjectionKey<FeatureLock> = Symbol("featureLock");

const UNLOCKED: FeatureLock = { locked: computed(() => false), feature: ref(null) };

// Module-level so the license-denial receiver, outside the component tree, can see the page lock.
const activeLock = shallowRef<FeatureLock | null>(null);

/** Locks every O2 primitive below the caller while `lockedFeature` names a feature. */
export const provideFeatureLock = (lockedFeature: Readonly<Ref<string | null>>): FeatureLock => {
  const lock: FeatureLock = {
    feature: lockedFeature,
    locked: computed(() => lockedFeature.value !== null),
  };
  provide(FEATURE_LOCK, lock);
  activeLock.value = lock;
  onScopeDispose(() => {
    if (activeLock.value === lock) activeLock.value = null;
  });
  return lock;
};

export const useFeatureLock = (): FeatureLock => inject(FEATURE_LOCK, UNLOCKED);

/** Marks a container whose controls only navigate, so the page lock leaves them live. */
export const LOCK_EXEMPT_ATTR = "data-feature-lock-exempt";

/** Unlocks the O2 primitives below the caller without releasing the page lock itself. */
export const provideFeatureLockExempt = (): void => provide(FEATURE_LOCK, UNLOCKED);

/** A primitive's effective `disabled`: its own prop, or the page lock. */
export const useLockedDisabled = (disabled: () => boolean | undefined): ComputedRef<boolean> => {
  const { locked } = useFeatureLock();
  return computed(() => Boolean(disabled()) || locked.value);
};

export const isPageLocked = (): boolean => !!activeLock.value?.feature.value;

// Server messages of license denials: catch sites toast `response.data.message`, never the error itself.
const licenseDenialMessages = new Set<string>();

// ponytail: time window, so an unrelated error toast inside it is dropped too; per-error tagging at catch sites lifts that.
const DENIAL_TOAST_WINDOW_MS = 2000;
let lastDenialAt = -Infinity;

/** Remembers a license denial so the catch site's error toast that follows it is dropped. */
export const markLicenseDenial = (error: unknown): void => {
  lastDenialAt = Date.now();
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data
    ?.message;
  if (typeof message === "string" && message) licenseDenialMessages.add(message);
};

/** True for an error toast the top bar already explains: one repeating a denial, or any fired just after one. */
export const isLicenseDenialToast = (message: unknown): boolean =>
  Date.now() - lastDenialAt < DENIAL_TOAST_WINDOW_MS ||
  (typeof message === "string" && licenseDenialMessages.has(message));

/** The upsell actions shared by the locked page and the locked-page banner. */
export const useFeatureLockActions = () => {
  const openContactSales = () => {
    window.open(siteURL.contactSales, "_blank", "noopener");
  };
  return { openContactSales };
};

/** Display names from the build's feature definition (`feature_names` in the org config). */
export const useFeatureNames = () => {
  const store = useStore();
  const featureName = (key: string): string | undefined =>
    store?.state.zoConfig?.feature_names?.[key];
  const featureNames = (keys: readonly string[]): string =>
    keys.map((key) => featureName(key) ?? key).join(", ");
  return { featureName, featureNames };
};

/** License locks of keys known only at runtime, such as a panel's stream type; a null key is never locked. */
export const useLicenseLocks = () => {
  const store = useStore();
  const { featureName } = useFeatureNames();
  // Global `$t`, not a vue-i18n import: toast and http load this module, which would defeat specs' vue-i18n mocks.
  const translate = getCurrentInstance()?.proxy?.$t;
  const isLocked = (key: string | null | undefined): boolean =>
    !!key && featureState(store?.state.zoConfig?.features, key) === "locked";
  const lockedReason = (key: string): I18nText => {
    const feature = featureName(key) ?? key;
    return (translate ? translate("featureLock.headerLocked", { feature }) : feature) as I18nText;
  };
  return { isLocked, lockedReason };
};

/** License lock of one feature, for its controls on a page the license leaves open. */
export const useLicenseLock = (key: string) => {
  const { isLocked, lockedReason } = useLicenseLocks();
  return { locked: computed(() => isLocked(key)), lockedReason: computed(() => lockedReason(key)) };
};
