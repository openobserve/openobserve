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
  <aside
    class="border-border-default bg-surface-page w-72 shrink-0 overflow-y-auto border-s p-3 text-sm"
    data-test="profiles-function-details"
    @click.stop
  >
    <div class="mb-2 flex items-center gap-2">
      <span class="text-text-body font-semibold">{{ t("profiles.functionDetails") }}</span>
      <OButton
        class="ms-auto"
        size="icon-xs"
        variant="ghost"
        icon-left="close"
        :aria-label="t('common.close')"
        data-test="profiles-function-details-close"
        @click="emit('close')"
      />
    </div>
    <dl class="flex flex-col gap-3">
      <div>
        <dt class="text-text-secondary mb-0.5 text-xs">{{ t("profiles.detailFunctionName") }}</dt>
        <dd class="font-mono text-xs break-all">{{ target.name }}</dd>
      </div>
      <div class="border-border-default grid grid-cols-2 gap-2 border-t pt-3">
        <div>
          <dt class="text-text-secondary mb-0.5 text-xs">{{ t("profiles.self") }}</dt>
          <dd class="text-text-body text-xs tabular-nums">{{ formatValue(target.self) }}</dd>
        </div>
        <div>
          <dt class="text-text-secondary mb-0.5 text-xs">{{ t("profiles.total") }}</dt>
          <dd class="text-text-body text-xs tabular-nums">{{ formatValue(target.total) }}</dd>
        </div>
      </div>
    </dl>
  </aside>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

export type ProfileFunctionDetailsTarget = {
  name: string;
  self: number;
  total: number;
};

defineProps<{
  target: ProfileFunctionDetailsTarget;
  formatValue: (value: number) => string;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18nTyped();
</script>
