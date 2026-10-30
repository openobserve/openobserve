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
  <section
    class="bg-surface-base border-border-default rounded-surface flex flex-col gap-2 border p-3"
    data-test="downtime-condition"
  >
    <div v-if="!open" class="flex items-center gap-2">
      <OIcon name="tune" size="sm" class="text-text-secondary" />
      <span class="text-text-secondary text-sm">{{ t("alerts.downtimes.condition.none") }}</span>
      <OButton
        class="ms-auto"
        variant="ghost"
        size="sm"
        icon-left="add"
        data-test="downtime-condition-add"
        @click="openSection"
      >
        {{ t("alerts.downtimes.condition.add") }}
      </OButton>
    </div>

    <template v-else>
      <header class="flex items-center gap-2">
        <OIcon name="tune" size="sm" class="text-text-secondary" />
        <span class="text-text-heading text-sm font-semibold">
          {{ t("alerts.downtimes.condition.title") }}
        </span>
        <OTag type="exampleChip" value="dim" :label="t('alerts.downtimes.condition.onePer')" />
        <OButton
          class="ms-auto"
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('alerts.downtimes.condition.remove')"
          data-test="downtime-condition-remove"
          @click="closeSection"
        />
      </header>
      <p class="text-text-secondary text-xs">{{ t("alerts.downtimes.condition.caption") }}</p>

      <FilterBuilder
        ref="builderRef"
        profile="downtime"
        :model-value="formTree"
        :fields="fields"
        :load-values="loadValues"
        :value-hint="valueHint"
        data-test="downtime-condition-builder"
        @update:model-value="onChange"
      />
      <p
        v-if="chipError"
        class="text-input-error-text text-xs"
        role="alert"
        data-test="downtime-condition-error"
      >
        {{ chipError }}
      </p>
      <p
        v-else-if="partial"
        class="text-text-secondary text-xs"
        data-test="downtime-condition-partial"
      >
        {{ t("alerts.downtimes.resources.partial") }}
      </p>

      <DowntimeResourcePicker
        :condition="currentCondition"
        :folder="downtimeFolder"
        @apply="applyRefinement"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { queryClient } from "@/composables/query/queryClient";
import { semanticGroupsQuery } from "@/services/service_streams.queries";
import type { DimensionCondition } from "@/services/downtimes";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { applyResources } from "@/utils/downtimes/conditionBridge";
import { conditionError } from "@/utils/downtimes/conditionRules";
import type { DowntimeFormValues } from "@/utils/downtimes/downtimeForm";
import type { FilterField } from "@/utils/query/filterBar";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import DowntimeResourcePicker from "./DowntimeResourcePicker.vue";
import { useDowntimeValueSuggest } from "@/composables/downtimes/useDowntimeValueSuggest";

withDefaults(
  defineProps<{
    /** Bumped by the page when it loads a saved row; the builder follows the form value itself. */
    resetToken?: number;
  }>(),
  { resetToken: 0 },
);

const { t } = useI18nTyped();
const orgId = useOrgId();
const form = inject(FORM_CONTEXT_KEY, null);

const open = form.useStore((s: { values: DowntimeFormValues }) => s.values.condition_open);
const formTree = form.useStore((s: { values: DowntimeFormValues }) => s.values.condition);
const downtimeFolder = form.useStore((s: { values: DowntimeFormValues }) => s.values.folder_id);
const submissionAttempts = form.useStore(
  (s: { submissionAttempts?: number }) => s.submissionAttempts ?? 0,
);
const builderRef = ref<InstanceType<typeof FilterBuilder> | null>(null);

// The builder states the same rules as the page schema, so a refused save is explained on its chips.
watch(submissionAttempts, () => builderRef.value?.validate());

// Rules the builder marks on a chip get their words here; the others it states itself.
const CHIP_RULES: I18nKey[] = [
  "alerts.downtimes.validation.loneStar",
  "alerts.downtimes.validation.innerStar",
  "alerts.downtimes.validation.pairKey",
  "alerts.downtimes.validation.pairValue",
];
const chipError = computed(() => {
  if (!submissionAttempts.value) return null;
  const key = conditionError(formTree.value ?? null);
  return key && CHIP_RULES.includes(key) ? t(key) : null;
});

const { loadValues, partial, isNotSeen } = useDowntimeValueSuggest(
  queryClient,
  orgId,
  computed(() => downtimeFolder.value || undefined),
  computed(() => formTree.value ?? null),
);

const valueHint = (key: string, values: string[]) =>
  isNotSeen(key, values) ? t("alerts.downtimes.resources.notSeen") : undefined;

const semanticGroups = useQuery(() =>
  Object.assign(semanticGroupsQuery(orgId.value), { enabled: !!orgId.value }),
);
const fields = computed<FilterField[]>(() =>
  (semanticGroups.data.value ?? []).map((g) => ({
    name: g.id,
    label: String(g.display || g.id),
    type: "string",
  })),
);

const onChange = (next: unknown) =>
  form?.setFieldValue("condition", (next as DimensionCondition | null) ?? null);

const currentCondition = computed(() => formTree.value ?? null);

const openSection = () => form?.setFieldValue("condition_open", true);

// The tree stays in the form, so adding the block back restores it.
const closeSection = () => form?.setFieldValue("condition_open", false);

const applyRefinement = (key: string, values: string[]) => {
  form?.setFieldValue("condition", applyResources(currentCondition.value, key, values));
};
</script>
