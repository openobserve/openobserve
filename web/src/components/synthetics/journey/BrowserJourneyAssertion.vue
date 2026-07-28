<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * The assertion editor for an `assert` step.
 *
 * A journey that only clicks can click its way through a broken application and
 * still pass. This is where an author turns a sequence of interactions into a
 * statement about an outcome.
 *
 * The kind set is closed and mirrors the server's (spec P5.1): the probe fails
 * an unknown kind rather than passing it, so anything not in this list would
 * surface as every run failing instead of as a validation error at save time.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AssertionKind, StepAssertion } from "@/types/synthetics";
import {
  ASSERTION_KINDS,
  assertionNeedsAttribute,
  assertionNeedsExpected,
} from "@/constants/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

const props = defineProps<{ assertion?: StepAssertion }>();
const emit = defineEmits<{ "update:assertion": [value: StepAssertion] }>();

const { t } = useI18n();

/** An assert step with no typed assertion keeps its original meaning. */
const current = computed<StepAssertion>(() => props.assertion ?? { kind: "element_visible" });

const kindOptions = computed(() =>
  ASSERTION_KINDS.map((kind) => ({
    label: t(`synthetics.journey.assertionKind.${kind}`),
    value: kind,
  })),
);

const kindComputed = computed({
  get: () => current.value.kind,
  set: (v: string | number | boolean | null | undefined) => {
    const kind = (v as AssertionKind) ?? "element_visible";
    // Values that no longer mean anything for the new kind are dropped rather
    // than carried invisibly — a stale `attribute` on a `page_title` assertion
    // would be refused by validation with no visible cause.
    emit("update:assertion", {
      kind,
      ...(assertionNeedsExpected(kind) && { expected: current.value.expected ?? "" }),
      ...(assertionNeedsAttribute(kind) && { attribute: current.value.attribute ?? "" }),
    });
  },
});

const expectedComputed = computed({
  get: () => current.value.expected ?? "",
  set: (v: string) => emit("update:assertion", { ...current.value, expected: v }),
});

const attributeComputed = computed({
  get: () => current.value.attribute ?? "",
  set: (v: string) => emit("update:assertion", { ...current.value, attribute: v }),
});

const showExpected = computed(() => assertionNeedsExpected(current.value.kind));
const showAttribute = computed(() => assertionNeedsAttribute(current.value.kind));

const expectedPlaceholder = computed(() =>
  t(`synthetics.journey.assertionExpectedPlaceholder.${current.value.kind}`),
);
</script>

<template>
  <div class="flex flex-col gap-2" data-test="synthetics-journey-step-assertion">
    <OSelect
      v-model="kindComputed"
      :label="t('synthetics.journey.assertionKindLabel')"
      :options="kindOptions"
      data-test="synthetics-journey-step-assertion-kind-select"
    />

    <OInput
      v-if="showAttribute"
      v-model="attributeComputed"
      :label="t('synthetics.journey.assertionAttributeLabel')"
      placeholder="href"
      data-test="synthetics-journey-step-assertion-attribute-input"
    />

    <OInput
      v-if="showExpected"
      v-model="expectedComputed"
      :label="t('synthetics.journey.assertionExpectedLabel')"
      :placeholder="expectedPlaceholder"
      data-test="synthetics-journey-step-assertion-expected-input"
    />
  </div>
</template>
