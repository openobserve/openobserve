// Copyright 2026 OpenObserve Inc.

import { computed, nextTick, ref, type Ref } from "vue";

// Role names cannot establish effective stream grants; only a certain denial disables this route.
export function useNoFtsRecovery(configureDenied?: Readonly<Ref<boolean | undefined>>) {
  const fieldSearchOpen = ref(false);
  let trigger: HTMLElement | null = null;
  const canConfigure = computed(() => configureDenied?.value !== true);
  function openFieldSearch(event: Event) {
    trigger = event.currentTarget as HTMLElement;
    fieldSearchOpen.value = true;
  }
  async function closeFieldSearch() {
    fieldSearchOpen.value = false;
    await nextTick();
    trigger?.focus();
  }
  return { canConfigure, fieldSearchOpen, openFieldSearch, closeFieldSearch };
}
