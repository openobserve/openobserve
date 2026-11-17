<template>
  <span :class="subline ? 'inline-flex max-w-full flex-col items-start gap-0.5 py-1' : 'contents'"
    ><span :class="version ? 'inline-flex max-w-full min-w-0 items-center gap-1' : 'contents'"
      ><template v-if="version"
        ><span
          class="text-text-heading min-w-0 truncate font-mono text-xs"
          data-test="svcver-chip-version"
          ><OTooltip overflow-only :content="raw(versionTip || version)" />{{ version }}</span
        ><span class="text-text-muted text-xs">{{ raw("·") }}</span></template
      ><span
        v-if="code === 'pre_existing' || !clickable"
        class="inline-flex shrink-0"
        :data-test="testId"
        ><OTag type="versionVerdict" :value="code" :dot="dot" :icon="icon" /><OTooltip
          v-if="tooltip"
          :content="raw(tooltip)" /></span
      ><OTag
        v-else
        class="shrink-0"
        type="versionVerdict"
        :value="code"
        :dot="dot"
        :icon="icon"
        clickable
        :data-test="testId"
        @click="open" /></span
    ><span v-if="subline" class="text-text-secondary text-2xs" data-test="svcver-verdict-subline">{{
      subline
    }}</span></span
  >
</template>
<script setup lang="ts">
import { computed } from "vue";
import { raw } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { VerdictSummary } from "@/services/service_versions";
import { verdictCode } from "./verdictText";
const props = withDefaults(
  defineProps<{
    verdict: VerdictSummary;
    clickable?: boolean;
    testId?: string;
    subline?: string;
    tooltip?: string;
    /** The verdict's own version, named only when the row shows another one. */
    version?: string;
    /** The whole chip line, shown on hover only when the version is cut. */
    versionTip?: string;
  }>(),
  {
    clickable: true,
    testId: "svcver-verdict",
    subline: "",
    tooltip: "",
    version: "",
    versionTip: "",
  },
);
const emit = defineEmits<{ open: [] }>();
const code = computed(() => verdictCode(props.verdict));
const dot = computed(() =>
  ["ok", "watch", "regressed", "insufficient", "not_serving"].includes(code.value),
);
const icon = computed(() => (code.value.startsWith("rollback_") ? "undo" : undefined));
function open(event: MouseEvent | KeyboardEvent) {
  event.stopPropagation();
  emit("open");
}
</script>
