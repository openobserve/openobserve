<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { useStore } from "vuex";

import {
  decodeHomeReturn,
  HOME_RETURN_QUERY_KEY,
  type HomeReturnState,
} from "@/composables/goto/homeReturn";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

interface Held {
  routeName: unknown;
  state: HomeReturnState;
}

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const held = ref<Held | null>(null);

// In-page query rewrites drop `home_return`, so the bar is held per route name; the stored row belongs to one org.
watch(
  () => [route.name, route.query[HOME_RETURN_QUERY_KEY], org.value] as const,
  ([routeName, value, currentOrg], previous) => {
    // An org resolving on a cold load is not a switch.
    if (previous?.[2] && previous[2] !== currentOrg) {
      held.value = null;
      return;
    }
    const state = routeName === "home" ? null : decodeHomeReturn(value);
    if (state) held.value = { routeName, state };
    else if (held.value && held.value.routeName !== routeName) held.value = null;
  },
  { immediate: true },
);

function back(): void {
  const state = held.value?.state;
  if (!state) return;
  const query: LocationQueryRaw = { home_tab: "overview" };
  if (state.row) query.row = state.row;
  if (state.period) query.period = state.period;
  if (state.from !== undefined) query.from = String(state.from);
  if (state.to !== undefined) query.to = String(state.to);
  if (state.focus) query.focus = state.focus;
  query.org_identifier = org.value;
  held.value = null;
  void router.push({ name: "home", query });
}
</script>

<template>
  <div
    v-if="held"
    class="border-border-default flex shrink-0 items-center gap-2 border-b px-2 py-1"
    data-test="home-return-bar"
  >
    <OButton
      variant="ghost"
      size="sm"
      icon-left="arrow-back"
      data-test="home-return-bar-back"
      @click="back"
    >
      {{ t("overview.goTo.back") }}
    </OButton>
    <OButton
      class="ms-auto"
      variant="ghost-muted"
      size="icon-sm"
      icon-left="close"
      :aria-label="t('overview.goTo.close')"
      data-test="home-return-bar-close"
      @click="held = null"
    />
  </div>
</template>
