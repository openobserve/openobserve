// Copyright 2026 OpenObserve Inc.

import { defineComponent, inject, provide, toRef, type InjectionKey, type Ref } from "vue";

const FIELD_ROW_LABEL_ID: InjectionKey<Ref<string>> = Symbol("fieldRowLabelId");

/** Hands one list row's label id to the OFieldRow rendered inside it. */
export const FieldRowLabelScope = defineComponent({
  name: "FieldRowLabelScope",
  props: { labelId: { type: String, required: true } },
  setup(props, { slots }) {
    provide(FIELD_ROW_LABEL_ID, toRef(props, "labelId"));
    return () => slots.default?.();
  },
});

export const useFieldRowLabelId = (): Ref<string> | undefined =>
  inject(FIELD_ROW_LABEL_ID, undefined);
