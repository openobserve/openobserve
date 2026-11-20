<template>
  <span class="text-text-muted" data-test="svcver-not-compared"
    ><span aria-hidden="true">{{ raw("—") }}</span
    ><span class="sr-only">{{ label }}</span
    ><OTooltip :content="label"
  /></span>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(defineProps<{ reason?: string }>(), { reason: "" });
const { t } = useI18nTyped();
const label = computed(() =>
  props.reason ? raw(props.reason) : t("serviceVersions.compare.notCompared"),
);
</script>
