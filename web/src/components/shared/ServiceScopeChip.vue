<template>
  <span v-if="outside" class="inline-flex max-w-full min-w-0"
    ><ODimensionChip
      :dim-key="facet"
      :key-label="keyLabel"
      :value="shown"
      variant="default-soft"
      muted
      :value-tooltip="false"
      data-test="svcver-where-none" /><OTooltip v-if="reasonTooltip" :content="reason"
  /></span>
  <ODimensionChip
    v-else
    :dim-key="facet"
    :key-label="keyLabel"
    :value="shown"
    :value-tooltip="false"
  />
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { Place } from "@/services/service_versions";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isOutsideK8s, whereOutsideReason, whereText } from "@/utils/serviceVersionsCopy";
const props = withDefaults(
  defineProps<{
    facet: "where" | "version";
    value?: string;
    label?: I18nText;
    // A where chip given its key words itself through the shared where label, so it never prints "default".
    whereKey?: string | null;
    place?: Place | null;
    reasonTooltip?: boolean;
  }>(),
  { value: "", label: undefined, whereKey: undefined, place: undefined, reasonTooltip: true },
);
const { t } = useI18nTyped();
const outside = computed(
  () =>
    props.facet === "where" && props.whereKey != null && isOutsideK8s(props.whereKey, props.place),
);
const shown = computed(() =>
  props.facet === "where" && props.whereKey != null && (outside.value || !props.value)
    ? whereText(props.whereKey, props.place, t)
    : props.value,
);
const reason = computed(() => whereOutsideReason(t));
const keyLabel = computed(
  () =>
    props.label ??
    (props.facet === "where"
      ? t("serviceVersions.compare.whereChip")
      : t("serviceVersions.correlation.versionChip")),
);
</script>
