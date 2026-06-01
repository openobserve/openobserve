<template>
  <div
    class="eval-type-dialog"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div class="eval-type-dialog__panel">
      <div class="eval-type-dialog__head">
        <h2>{{ t("onlineEvals.scorerTypeDialog.title") }}</h2>
        <OButton
          icon-left="close"
          variant="ghost"
          size="icon-sm"
          @click="$emit('close')"
        />
      </div>
      <p>{{ t("onlineEvals.scorerTypeDialog.intro") }}</p>
      <div class="eval-type-dialog__cards">
        <button type="button" @click="$emit('select', 'llm_judge')">
          <OIcon name="smart-toy" size="sm" />
          <strong>{{ t("onlineEvals.scorerTypeDialog.llmJudgeTitle") }}</strong>
          <span>{{ t("onlineEvals.scorerTypeDialog.llmJudgeDescription") }}</span>
        </button>
        <button type="button" @click="$emit('select', 'remote')">
          <OIcon name="cloud" size="sm" />
          <strong>{{ t("onlineEvals.scorerTypeDialog.remoteTitle") }}</strong>
          <span>{{ t("onlineEvals.scorerTypeDialog.remoteDescription") }}</span>
        </button>
        <button type="button" disabled>
          <OIcon name="code" size="sm" />
          <strong>{{ t("onlineEvals.scorerTypeDialog.codeTitle") }}</strong>
          <span>{{ t("onlineEvals.scorerTypeDialog.codeDescription") }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ScorerType } from "@/services/online-evals.service";

defineEmits<{
  (e: "close"): void;
  (e: "select", type: ScorerType): void;
}>();

const { t } = useI18n();
</script>
