<template><div>x</div></template>
<script lang="ts" setup>
import { ref } from "vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { makeAssociateFunctionSchema, type AssociateFunctionForm } from "@/components/pipeline/NodeForm/AssociateFunction.schema";

const validated = ref<AssociateFunctionForm | null>(null);
const form = useOForm<AssociateFunctionForm>({
  defaultValues: { selectedFunction: "", afterFlattening: true },
  schema: makeAssociateFunctionSchema((k)=>k, ()=>[], ()=>false),
  onSubmit: (values) => { validated.value = values; },
});
const submit = async () => {
  validated.value = null;
  await form.handleSubmit();
  const values: AssociateFunctionForm | null = validated.value;
  if (!values?.selectedFunction) return null;
  return { name: values.selectedFunction, after_flatten: !!values.afterFlattening };
};
void form;
defineExpose({ submit });
</script>
