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

<template>
  <div class="flex flex-col gap-2" data-test="autoobserve-policy-modes">
    <ul
      class="border-border-subtle rounded-surface bg-surface-base divide-border-subtle divide-y border"
    >
      <li
        v-for="action in actions"
        :key="action.id"
        class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
        :data-test="`autoobserve-policy-mode-${action.id}`"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-text-heading text-sm font-medium">{{ t(action.title) }}</span>
          <span class="text-text-secondary text-xs leading-relaxed">{{ t(action.detail) }}</span>
        </div>
        <OToggleGroup
          model-value="suggest"
          :aria-label="t(action.title)"
          :aria-describedby="reasonId"
          disabled
        >
          <OToggleGroupItem value="suggest" size="xs">
            {{ t("autoobserve.policyLive.modes.suggest") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="auto" size="xs">
            {{ t("autoobserve.policyLive.modes.auto") }}
          </OToggleGroupItem>
        </OToggleGroup>
      </li>
    </ul>
    <p
      :id="reasonId"
      class="text-text-secondary flex items-start gap-1.5 text-xs"
      data-test="autoobserve-policy-modes-reason"
    >
      <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
      <span>{{ t("autoobserve.policyLive.modes.locked") }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { PolicyAction } from "./policyActions";

defineProps<{ actions: PolicyAction[] }>();

const { t } = useI18nTyped();
const reasonId = useId();
</script>
