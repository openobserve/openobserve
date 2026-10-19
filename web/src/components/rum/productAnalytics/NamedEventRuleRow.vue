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
        <OToggleGroupItem value="error" size="xs">{{
          t("rum.analytics.kind.error")
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
    <OFormSelect
      :name="`rules[${index}].op`"
      :options="opOptions"
      size="sm"
      :data-test="`rum-analytics-named-events-rule-${index}-op`"
    />
    <OFormCombobox
      v-if="kind === 'view' && !pageMeta"
      :name="`rules[${index}].value`"
      :items="pageItems"
      :placeholder="t('rum.analytics.events.pagePlaceholder')"
      size="sm"
      :data-test="`rum-analytics-named-events-rule-${index}-value`"
    />
    <OFormSelect
      v-else-if="kind === 'action' && op === 'in'"
      :name="`rules[${index}].targets`"
      :options="clickItems"
      :placeholder="t('rum.analytics.events.targetsPlaceholder')"
      multiple
      searchable
      creatable
      size="sm"
      :data-test="`rum-analytics-named-events-rule-${index}-targets`"
    />
    <template v-else>
      <OFormInput
        v-if="op === 'param'"
        :name="`rules[${index}].name`"
        :placeholder="t('rum.analytics.events.paramNamePlaceholder')"
        size="sm"
        :data-test="`rum-analytics-named-events-rule-${index}-param-name`"
      />
      <OFormInput
        :name="`rules[${index}].value`"
        :placeholder="valuePlaceholder"
        size="sm"
        :data-test="`rum-analytics-named-events-rule-${index}-value`"
      />
    </template>
    <OFormSelect
      v-if="kind !== 'view' || pageMeta"
      :name="`rules[${index}].onPage`"
      :options="onPageItems"
      :label="t('rum.analytics.events.onPage')"
      size="sm"
      :data-test="`rum-analytics-named-events-rule-${index}-on-page`"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, watch, type Ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  DEFAULT_OP,
  RULE_OPS,
  type NamedEventForm,
  type RuleForm,
  type RuleKind,
  type RuleOp,
} from "@/views/RUM/NamedEventEditor.schema";

interface RuleFormContext {
  useStore: <T>(selector: (s: { values: NamedEventForm }) => T) => Ref<T>;
  setFieldValue: (name: string, value: unknown) => void;
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
const kind = computed<RuleKind>(() => rule.value?.t ?? "view");

const op = computed(() => rule.value?.op ?? DEFAULT_OP[kind.value]);
// URL parameter and referrer rules read the raw view, so they name an optional page instead of matching one.
const pageMeta = computed(() => op.value === "param" || op.value === "ref");

const opLabels = computed<Record<RuleOp, I18nText>>(() => ({
  eq: t("rum.analytics.events.opEq"),
  prefix: t("rum.analytics.events.opPrefix"),
  regex: t("rum.analytics.events.opRegex"),
  param: t("rum.analytics.events.opParam"),
  ref: t("rum.analytics.events.opRef"),
  in: t("rum.analytics.events.opIn"),
  contains: t("rum.analytics.events.opContains"),
}));

const opOptions = computed(() =>
  RULE_OPS[kind.value].map((value) => ({ label: opLabels.value[value], value })),
);

const valuePlaceholder = computed<I18nText>(() => {
  if (kind.value === "error") return t("rum.analytics.events.errorPlaceholder");
  if (kind.value === "action") return t("rum.analytics.events.clickPlaceholder");
  return op.value === "ref"
    ? t("rum.analytics.events.refPlaceholder")
    : t("rum.analytics.events.paramValuePlaceholder");
});

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

// Each kind has its own ops, so switching kind would otherwise keep an op the new kind cannot match.
watch(kind, (k) => {
  if (!RULE_OPS[k].includes(op.value))
    form.setFieldValue(`rules[${props.index}].op`, DEFAULT_OP[k]);
});
</script>
