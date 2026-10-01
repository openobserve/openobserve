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
  <div
    class="border-border-default rounded-default flex flex-col gap-2 border p-2"
    :data-test="`rum-analytics-named-events-rule-${index}`"
  >
    <div class="flex items-center gap-2">
      <OFormToggleGroup
        :name="`rules[${index}].t`"
        type="single"
        :data-test="`rum-analytics-named-events-rule-${index}-kind`"
      >
        <OToggleGroupItem value="view" size="xs">{{
          t("rum.analytics.kind.page")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="action" size="xs">{{
          t("rum.analytics.kind.click")
        }}</OToggleGroupItem>
      </OFormToggleGroup>
      <OButton
        v-if="removable"
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        class="ms-auto"
        :aria-label="t('rum.analytics.events.removeRule')"
        :data-test="`rum-analytics-named-events-rule-${index}-remove`"
        @click="emit('remove')"
        ><OTooltip :content="t('rum.analytics.events.removeRule')"
      /></OButton>
    </div>
    <template v-if="kind === 'view'">
      <OFormSelect
        :name="`rules[${index}].op`"
        :options="opOptions"
        size="sm"
        :data-test="`rum-analytics-named-events-rule-${index}-op`"
      />
      <OFormCombobox
        :name="`rules[${index}].value`"
        :items="pageItems"
        :placeholder="t('rum.analytics.events.pagePlaceholder')"
        size="sm"
        :data-test="`rum-analytics-named-events-rule-${index}-value`"
      />
    </template>
    <template v-else>
      <OFormSelect
        :name="`rules[${index}].targets`"
        :options="clickItems"
        :placeholder="t('rum.analytics.events.targetsPlaceholder')"
        multiple
        searchable
        creatable
        size="sm"
        :data-test="`rum-analytics-named-events-rule-${index}-targets`"
      />
      <OFormSelect
        :name="`rules[${index}].onPage`"
        :options="onPageItems"
        :label="t('rum.analytics.events.onPage')"
        size="sm"
        :data-test="`rum-analytics-named-events-rule-${index}-on-page`"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { raw, useI18nTyped } from "@/types/i18n";
import type { NamedEventForm, RuleForm } from "@/views/RUM/NamedEventEditor.schema";

interface RuleFormContext {
  useStore: <T>(selector: (s: { values: NamedEventForm }) => T) => Ref<T>;
}

const props = defineProps<{
  index: number;
  pageOptions: string[];
  clickOptions: string[];
  removable: boolean;
}>();
const emit = defineEmits<{ remove: [] }>();
const { t } = useI18nTyped();

const form = inject(FORM_CONTEXT_KEY) as RuleFormContext;
const rule = form.useStore((s) => s.values.rules?.[props.index] as RuleForm | undefined);
const kind = computed(() => rule.value?.t ?? "view");

const opOptions = computed(() => [
  { label: t("rum.analytics.events.opEq"), value: "eq" },
  { label: t("rum.analytics.events.opPrefix"), value: "prefix" },
  { label: t("rum.analytics.events.opRegex"), value: "regex" },
]);

const pageItems = computed(() => props.pageOptions.map((p) => ({ label: raw(p), value: p })));

const clickItems = computed(() => {
  const all = new Set([...props.clickOptions, ...(rule.value?.targets ?? [])]);
  return [...all].map((c) => ({ label: raw(c), value: c }));
});

const onPageItems = computed(() => {
  const pages = new Set([...props.pageOptions, ...(rule.value?.onPage ? [rule.value.onPage] : [])]);
  return [
    { label: t("rum.analytics.events.anyPage"), value: "" },
    ...[...pages].map((p) => ({ label: raw(p), value: p })),
  ];
});
</script>
