<template>
  <div class="flex flex-wrap items-center gap-2" data-test="svcver-no-verdict">
    <OTag v-if="reason === 'pre_existing'" type="versionVerdict" value="pre_existing" />
    <span class="text-text-heading text-sm font-semibold" data-test="svcver-verdict-sentence">{{
      sentence
    }}</span>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import { noVerdictSentence, type NoVerdict, type NoVerdictContext } from "./verdictText";
const props = defineProps<{ reason: NoVerdict; context: NoVerdictContext }>();
const { t } = useI18nTyped();
const sentence = computed(() => noVerdictSentence(props.reason, props.context, t));
</script>
