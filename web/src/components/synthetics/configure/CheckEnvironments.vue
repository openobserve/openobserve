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
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw } from "@/types/i18n";
import type { BrowserCheck, SyntheticsEnvironment } from "@/types/synthetics";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import syntheticsService from "@/services/synthetics";
import { MAX_CHECK_ENVIRONMENTS } from "@/constants/synthetics";

const props = defineProps<{ check: BrowserCheck }>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();
const store = useStore();

const environments = ref<SyntheticsEnvironment[]>([]);
const loaded = ref(false);

async function fetchEnvironments() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.listEnvironments(org);
    environments.value = res.data ?? [];
  } catch {
    environments.value = [];
  }
  loaded.value = true;
}
fetchEnvironments();

const selected = computed(() => props.check.environments ?? []);
const atCap = computed(() => selected.value.length >= MAX_CHECK_ENVIRONMENTS);

/**
 * Stored ids the list does not return — environments this caller cannot read.
 * Shown checked and locked, never hidden: a hidden entry gets dropped from a
 * round-tripped form, silently ending monitoring there. The server re-attaches
 * them on save either way; the lock just makes the truth visible.
 */
const lockedIds = computed(() =>
  selected.value.filter((id) => !environments.value.some((env) => env.id === id)),
);

function toggle(id: string) {
  const next = selected.value.includes(id)
    ? selected.value.filter((entry) => entry !== id)
    : [...selected.value, id];
  emit("update:check", { ...props.check, environments: next });
}
</script>

<template>
  <div
    class="rounded-default border-border-default mb-4 border"
    data-test="synthetics-check-environments"
  >
    <div class="border-border-default flex items-center gap-2 border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-0.5 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.environments.cardTitle") }}
      </h3>
    </div>

    <div class="flex flex-col gap-3 px-3 py-3">
      <p
        v-if="loaded && !environments.length && !lockedIds.length"
        class="text-text-secondary m-0 text-sm"
        data-test="synthetics-check-environments-empty"
      >
        {{ t("synthetics.environments.cardEmpty") }}
      </p>

      <div v-else class="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        <div
          v-for="env in environments"
          :key="env.id"
          class="flex items-center gap-2"
          :data-test="`synthetics-check-environments-row-${env.name}`"
        >
          <OCheckbox
            :model-value="selected.includes(env.id)"
            :label="raw(env.name)"
            :disabled="atCap && !selected.includes(env.id)"
            :data-test="`synthetics-check-environments-checkbox-${env.name}`"
            @update:model-value="toggle(env.id)"
          />
          <span v-if="env.description" class="text-text-secondary truncate text-xs">
            {{ env.description }}
          </span>
        </div>

        <div
          v-for="id in lockedIds"
          :key="id"
          class="flex items-center gap-2"
          data-test="synthetics-check-environments-locked-row"
        >
          <OCheckbox :model-value="true" :label="raw(id)" disabled />
          <OIcon name="lock" size="xs" class="text-text-secondary" />
        </div>
      </div>

      <p
        v-if="lockedIds.length"
        class="text-text-secondary bg-surface-subtle rounded-default m-0 px-3 py-2 text-xs"
        data-test="synthetics-check-environments-locked-note"
      >
        {{ t("synthetics.environments.cardLocked") }}
      </p>
      <p
        v-if="atCap"
        class="text-text-secondary m-0 text-xs"
        data-test="synthetics-check-environments-cap-note"
      >
        {{ t("synthetics.environments.capReached", { cap: MAX_CHECK_ENVIRONMENTS }) }}
      </p>
    </div>
  </div>
</template>
