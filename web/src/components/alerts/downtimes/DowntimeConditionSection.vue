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

      <!-- The builder owns its own form; its submit must not reach the page form. -->
      <div @submit.stop.prevent>
        <ConditionBuilder
          :key="builderKey"
          ref="builderRef"
          :fields="columns"
          :initial-conditions="initialTree"
          module="alerts"
          :allow-custom-columns="false"
          :operators="DOWNTIME_OPERATORS"
        />
      </div>
      <p
        v-if="conditionError"
        class="text-input-error-text text-xs"
        role="alert"
        data-test="downtime-condition-error"
      >
        {{ conditionError }}
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
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { semanticGroupsQuery } from "@/services/service_streams.queries";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import type { V2Group } from "@/utils/alerts/alertDataTransforms";
import {
  DOWNTIME_OPERATORS,
  applyResources,
  builderToCondition,
  conditionToBuilder,
  connectorsEqual,
  emptyBuilderGroup,
  normalizeConnectors,
} from "@/utils/downtimes/conditionBridge";
import type { DowntimeFormValues } from "@/utils/downtimes/downtimeForm";
import ConditionBuilder from "@/components/flow/forms/ConditionBuilder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import DowntimeResourcePicker from "./DowntimeResourcePicker.vue";

const props = withDefaults(
  defineProps<{
    /** Bumped by the page when it loads a saved row, so the builder remounts on the new tree. */
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
const errors = form.useStore(
  (s: { fieldMeta?: Record<string, { errors?: unknown[] }> }) =>
    s.fieldMeta?.condition?.errors ?? [],
);
const conditionError = computed(() =>
  errors.value.length ? raw(String(firstFieldError(errors.value as never[]))) : null,
);

const semanticGroups = useQuery(() =>
  Object.assign(semanticGroupsQuery(orgId.value), { enabled: !!orgId.value }),
);
const columns = computed(() =>
  (semanticGroups.data.value ?? []).map((g) => ({ label: g.display || g.id, value: g.id })),
);

const builderKey = ref(0);
const initialTree = ref<V2Group>(formTree.value ?? emptyBuilderGroup());
const builderRef = ref<{ conditionGroup: V2Group; form: any } | null>(null);
let lastSeen: V2Group | null = initialTree.value;

const remountWith = (tree: V2Group) => {
  initialTree.value = tree;
  lastSeen = tree;
  builderKey.value += 1;
};

watch(
  () => props.resetToken,
  () => remountWith(formTree.value ?? emptyBuilderGroup()),
);

// Bridge the builder's own form into the page form on every change.
watch(
  () => builderRef.value?.conditionGroup,
  (next) => {
    if (!next) return;
    const normalized = normalizeConnectors(next, lastSeen);
    lastSeen = normalized;
    if (!connectorsEqual(normalized, next)) {
      builderRef.value?.form.setFieldValue("conditions", normalized);
    }
    form?.setFieldValue("condition", normalized);
  },
  { deep: true },
);

const currentCondition = computed(() => builderToCondition(formTree.value));

const openSection = () => {
  const tree = formTree.value ?? emptyBuilderGroup();
  form?.setFieldValue("condition", tree);
  form?.setFieldValue("condition_open", true);
  remountWith(tree);
};

// The tree stays in the form, so adding the block back restores it.
const closeSection = () => form?.setFieldValue("condition_open", false);

const applyRefinement = (key: string, values: string[]) => {
  const tree = conditionToBuilder(applyResources(currentCondition.value, key, values));
  form?.setFieldValue("condition", tree);
  remountWith(tree);
};
</script>
