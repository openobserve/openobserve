<template>
  <span class="flex flex-col gap-0.5" data-test="svcver-service-name-tooltip"
    ><span
      ><b>{{ raw(qualifiedName(name, qualifier)) }}</b
      ><template v-if="sourceKey">{{ raw(" · ") }}{{ t(sourceKey) }}</template></span
    ><span v-if="qualifier" class="opacity-70">{{
      t("serviceVersions.names.qualifierWhy", { qualifier: raw(qualifier), name: raw(name) })
    }}</span
    ><span v-if="detected" class="opacity-70">{{
      t("serviceVersions.names.detectedAs", { name: raw(serviceKey) })
    }}</span
    ><span v-if="detectedFrom" class="opacity-70">{{
      t("serviceVersions.names.detectedFrom", { field: raw(detectedFrom) })
    }}</span
    ><span v-if="placeholder" class="opacity-70">{{
      t("serviceVersions.names.placeholderHint", { attribute: raw("service.name") })
    }}</span
    ><template v-if="showCandidates && candidates.length"
      ><span class="opacity-70">{{
        t(
          "serviceVersions.names.candidatesTitle",
          { name: raw(serviceKey), count: candidates.length },
          candidates.length,
        )
      }}</span
      ><span v-for="candidate in candidates" :key="candidate" class="font-mono opacity-70">{{
        raw(candidate)
      }}</span></template
    ></span
  >
</template>
<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { qualifiedName } from "@/types/serviceRef";
const props = withDefaults(
  defineProps<{
    serviceKey: string;
    name: string;
    qualifier?: string | null;
    displaySource?: string | null;
    detected?: boolean;
    detectedFrom?: string | null;
    placeholder?: boolean;
    candidates?: string[];
    showCandidates?: boolean;
  }>(),
  {
    qualifier: null,
    displaySource: null,
    detected: false,
    detectedFrom: null,
    placeholder: false,
    candidates: () => [],
    showCandidates: false,
  },
);
const { t } = useI18nTyped();
const sourceKeys: Record<string, I18nKey> = {
  trace: "serviceVersions.names.source.trace",
  "alias:rename": "serviceVersions.names.source.rename",
  "alias:rum_service": "serviceVersions.names.source.rumService",
  "alias:k8s_workload": "serviceVersions.names.source.k8sWorkload",
  detection: "serviceVersions.names.source.detection",
  detection_ambiguous: "serviceVersions.names.source.detection",
};
const sourceKey = computed(() =>
  props.displaySource ? (sourceKeys[props.displaySource] ?? null) : null,
);
</script>
