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
  <div class="flex flex-col gap-2" data-test="autoobserve-paging">
    <div class="flex items-start justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span :id="labelId" class="text-text-heading text-sm font-medium">
          {{ t("autoobserveLive.paging.label") }}
        </span>
        <span class="text-text-secondary text-xs leading-relaxed">
          {{ t("autoobserveLive.paging.description") }}
        </span>
      </div>
      <OSwitch
        :model-value="paging.checked.value"
        :disabled="locked"
        :aria-labelledby="labelId"
        :aria-busy="paging.saving.value || paging.loading.value"
        data-test="autoobserve-paging-switch"
        @update:model-value="(v) => paging.set(v === true)"
      />
    </div>
    <OButton
      variant="ghost-primary"
      size="sm"
      class="-ms-3 self-start"
      data-test="autoobserve-paging-routing"
      @click="openRouting"
    >
      {{ t("autoobserveLive.paging.routing") }}
    </OButton>
    <p
      class="flex min-h-8 items-start gap-1.5 text-xs leading-4"
      :class="status?.tone === 'error' ? 'text-status-error-text' : 'text-text-secondary'"
      :role="status?.tone === 'error' ? 'alert' : undefined"
      data-test="autoobserve-paging-status"
    >
      <template v-if="status">
        <OIcon :name="status.icon" size="xs" class="mt-0.5 shrink-0" />
        <span>{{ status.text }}</span>
      </template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { pagingWriteErrorText, usePagingSetting } from "./usePagingSetting";

const { t } = useI18nTyped();
const router = useRouter();
const paging = usePagingSetting();
const labelId = useId();

const locked = computed(
  () =>
    paging.saving.value ||
    paging.loading.value ||
    paging.loadFailed.value ||
    !paging.available.value,
);

// One reserved line holds the lock reason or a failure, so nothing below moves.
const status = computed<{ tone: "neutral" | "error"; icon: string; text: I18nText } | null>(() => {
  if (paging.writeError.value)
    return {
      tone: "error",
      icon: "warning",
      text: pagingWriteErrorText(t, paging.writeError.value),
    };
  if (paging.loadFailed.value)
    return { tone: "error", icon: "warning", text: t("autoobserveLive.paging.loadFailed") };
  if (paging.settings.value && !paging.available.value)
    return { tone: "neutral", icon: "lock", text: t("autoobserveLive.paging.unavailable") };
  return null;
});

const openRouting = () =>
  router.push({ name: "onCallRouting", query: { org_identifier: paging.orgId.value } });
</script>
