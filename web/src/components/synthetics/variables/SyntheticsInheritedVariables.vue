<!--
Copyright 2026 OpenObserve Inc.

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

Makes inheritance visible in the check editor. Without it, a shared value is
something the author has to already know about - the panel would show only the
check's own variables while the steps reference names from three scopes.
-->

<template>
  <section v-if="inherited.length" class="px-3 pt-3" data-test="synthetics-inherited-variables">
    <div class="mb-2 flex items-center gap-2">
      <h4 class="text-text-heading m-0 text-sm font-semibold">
        {{ t("synthetics.inherited.title") }}
      </h4>
      <OBadge variant="default" size="sm">{{ inherited.length }}</OBadge>
    </div>

    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      <li
        v-for="variable in inherited"
        :key="`${variable.scope}:${variable.name}`"
        class="flex items-center gap-2 text-sm"
        data-test="synthetics-inherited-variable"
      >
        <span
          class="font-mono"
          :class="variable.overridden ? 'text-text-secondary line-through' : ''"
          >{{ variable.name }}</span
        >
        <OBadge variant="secondary" size="sm">{{ variable.scope }}</OBadge>

        <span v-if="variable.kind === 'secret'" class="text-text-secondary font-mono">••••••</span>
        <span v-else-if="variable.example" class="text-text-secondary truncate">{{
          variable.example
        }}</span>

        <OBadge v-if="variable.overridden" variant="warning" size="sm">
          {{ t("synthetics.inherited.overriddenHere") }}
        </OBadge>

        <div class="ml-auto flex items-center gap-1">
          <OButton
            v-if="canOverride(variable)"
            variant="ghost"
            size="xs"
            data-test="synthetics-inherited-override-btn"
            @click="$emit('override', variable.name)"
            >{{ t("synthetics.inherited.override") }}</OButton
          >
          <!-- Overriding a secret would move it into the check tier, where the
               value becomes readable again. Say why rather than hiding it. -->
          <OTooltip
            v-else-if="variable.kind === 'secret'"
            :content="t('synthetics.inherited.overrideSecretBlocked')"
            side="left"
          >
            <OIcon name="lock" size="xs" class="text-text-secondary" />
          </OTooltip>
        </div>
      </li>
    </ul>

    <p
      v-if="unbound.length"
      class="text-warning mt-2 text-xs"
      data-test="synthetics-unbound-placeholders"
    >
      {{ t("synthetics.inherited.unbound", { names: unbound.join(", ") }) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import syntheticsService from "@/services/synthetics";
import type { ResolvedVariable } from "./resolved";
import { canOverride, inheritedVariables, unboundPlaceholders } from "./resolved";

const props = defineProps<{
  /** Empty while the check is unsaved — there is nothing to resolve against yet. */
  checkId: string;
  /** Every `{{NAME}}` the journey references, for the unbound warning. */
  referenced: string[];
}>();
defineEmits<{ override: [name: string] }>();

const { t } = useI18nTyped();
const store = useStore();
const resolved = ref<ResolvedVariable[]>([]);

const inherited = computed(() => inheritedVariables(resolved.value));
const unbound = computed(() => unboundPlaceholders(props.referenced, resolved.value));

async function fetchResolved() {
  if (!props.checkId) {
    resolved.value = [];
    return;
  }
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.resolvedVariables(org, props.checkId);
    resolved.value = res.data ?? [];
  } catch {
    // A failure here costs the author a hint, not their work — the panel and
    // the save path both stand on their own, so it stays silent.
    resolved.value = [];
  }
}

watch(() => props.checkId, fetchResolved, { immediate: true });
</script>
