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
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import { siteURL } from "@/constants/config";

export interface FeatureLock {
  locked: Readonly<Ref<boolean>>;
  feature: Readonly<Ref<string | null>>;
}

const FEATURE_LOCK: InjectionKey<FeatureLock> = Symbol("featureLock");

const UNLOCKED: FeatureLock = { locked: computed(() => false), feature: ref(null) };

// Module-level so code outside the component tree (toasts, the http interceptor) can see the page lock.
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

/** A primitive's effective `disabled`: its own prop, or the page lock. */
export const useLockedDisabled = (disabled: () => boolean | undefined): ComputedRef<boolean> => {
  const { locked } = useFeatureLock();
  return computed(() => Boolean(disabled()) || locked.value);
};

/** True while a license-locked page is on screen. */
export const isPageFeatureLocked = (): boolean => activeLock.value?.locked.value === true;

/** A license denial whose every missing key is the locked page's own feature. */
export const isLockedFeatureDenial = (features: string[]): boolean => {
  const key = activeLock.value?.feature.value;
  return !!key && features.length > 0 && features.every((feature) => feature === key);
};

// Server messages of tagged denials: catch sites toast `response.data.message`, never the error itself.
const lockedDenialMessages = new Set<string>();

/** Tags a locked-page denial (`error.licenseLocked`) so its toast is dropped and the page keeps its license state. */
export const markLockedDenial = (error: unknown): void => {
  const tagged = error as { licenseLocked?: boolean; response?: { data?: { message?: unknown } } };
  tagged.licenseLocked = true;
  const message = tagged.response?.data?.message;
  if (typeof message === "string" && message) lockedDenialMessages.add(message);
};

/** True for an error toast that only repeats a tagged denial while its page is still locked. */
export const isLockedDenialToast = (message: unknown): boolean =>
  isPageFeatureLocked() && typeof message === "string" && lockedDenialMessages.has(message);

/** The upsell actions shared by the locked page and the locked-page banner. */
export const useFeatureLockActions = () => {
  const openContactSales = () => {
    window.open(siteURL.contactSales, "_blank", "noopener");
  };
  return { openContactSales };
};
