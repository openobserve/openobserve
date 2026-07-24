<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Form-aware wrapper around the DateTime range picker (@/components/DateTime.vue).
// DateTime is a composite that takes its value via ONCE-READ `default-*` props
// and emits `on:date-change` (it has no reactive v-model), so this wrapper:
//   • seeds default-type / default-absolute-time / default-relative-time from the
//     field's current value,
//   • translates each `on:date-change` into the form's timerange object via
//     `field.handleChange`,
//   • REMOUNTS the inner DateTime (via `:key`) when the field value changes from
//     an EXTERNAL source (form.reset / async edit-prefill) so the picker re-reads
//     the new value — but NOT on the user's own changes (DateTime already
//     reflects those), which would otherwise cause a remount loop.
//
// Errors aren't rendered here: DateTime has no label/required affordance and the
// timerange is validated cross-field in the form schema (surfaced via the step
// jump), mirroring how the other documented composite controls behave.

import { inject, ref, watch } from "vue";
import DateTime from "@/components/DateTime.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { FormDateTimeRangeProps, DateTimeRangeValue } from "./OFormDateTimeRange.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<FormDateTimeRangeProps>();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[OFormDateTimeRange] must be rendered inside <OForm>. No form context found.");
}

// Resolve a possibly-nested/indexed field name (e.g. `dashboards[0].timerange`)
// against the form values. A flat `values[name]` lookup only works for top-level
// names — for the indexed paths this wrapper is used with it would always read
// `undefined` and the remount-on-reset watch below would never fire.
const valueAtName = (values: any, name: string): unknown => {
  const parts = name
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  return parts.reduce((acc: any, key) => (acc == null ? undefined : acc[key]), values);
};

// Remount key — bumped only when the field value changes from outside this
// wrapper (reset/prefill), so DateTime re-reads its once-read `default-*` props.
const renderKey = ref(0);
let lastEmitted = "";

if (form) {
  const fieldValue = form.useStore((s: any) => valueAtName(s.values, props.name));
  watch(
    fieldValue,
    (v: unknown) => {
      const serialized = JSON.stringify(v ?? null);
      if (serialized !== lastEmitted) {
        lastEmitted = serialized;
        renderKey.value++;
      }
    },
    { deep: true },
  );
}

// Translate DateTime's event shape → the form's { type, from, to, period }
// timerange object.
const toTimerange = (dt: any): DateTimeRangeValue => ({
  type: dt.valueType === "relative-custom" ? "relative" : dt.valueType,
  from: dt.startTime,
  to: dt.endTime,
  period: dt.relativeTimePeriod || "30m",
});

const onDateChange = (field: any, dt: any) => {
  const tr = toTimerange(dt);
  // Record our own emit so the value watch above doesn't trigger a remount.
  lastEmitted = JSON.stringify(tr);
  field.handleChange(tr);
};
</script>

<template>
  <component v-if="form" :is="form.Field" :name="props.name">
    <template #default="{ field }">
      <div v-if="props.label || props.description" class="mb-2">
        <div v-if="props.label" class="text-input-label-text text-sm font-bold">
          {{ props.label }}<span v-if="props.required" class="text-input-error-text"> *</span>
        </div>
        <div v-if="props.description" class="text-xs">
          {{ props.description }}
        </div>
      </div>
      <DateTime
        :key="renderKey"
        v-bind="$attrs"
        :default-type="field.state.value?.type ?? 'relative'"
        :default-absolute-time="{
          startTime: field.state.value?.from,
          endTime: field.state.value?.to,
        }"
        :default-relative-time="field.state.value?.period ?? '30m'"
        @on:date-change="(d: any) => onDateChange(field, d)"
      />
    </template>
  </component>
</template>
