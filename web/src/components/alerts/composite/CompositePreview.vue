<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="composite-preview flex flex-col gap-3 p-3 h-full overflow-auto" data-test="composite-preview">
    <div class="flex items-center gap-2 flex-wrap">
      <OButton
        variant="primary"
        size="sm"
        icon-left="play-arrow"
        :loading="previewLoading"
        data-test="composite-preview-btn"
        @click="runPreview"
      >
        {{ t("alerts.composite.runPreview") }}
      </OButton>
      <template v-if="previewResult">
        <span class="text-xs text-text-secondary">{{ t("alerts.composite.result") }}:</span>
        <OTag
          :variant="stateTagType(previewResult.result)"
          :value="previewResult.result"
          class="uppercase font-semibold"
        />
      </template>
    </div>

    <!-- Evaluated expression: names → states → result -->
    <div v-if="previewResult" class="text-xs flex flex-col gap-1">
      <span class="text-text-secondary">{{ t("alerts.composite.howItEvaluated") }}:</span>
      <code class="bg-code-bg rounded px-2 py-1 break-all">
        {{ composite.expression }} → {{ substitutedExpression }} = {{ previewResult.result.toUpperCase() }}
      </code>
    </div>

    <div v-if="!previewResult && !previewError" class="text-xs text-text-secondary leading-relaxed">
      {{ t("alerts.composite.previewHelp") }}
    </div>

    <div v-if="previewError" class="text-xs text-negative" data-test="composite-preview-error">
      {{ previewError }}
    </div>

    <!-- Per-term results, each with a plain-English reason -->
    <div v-if="previewResult" class="flex flex-col gap-2">
      <div
        v-for="tp in previewResult.terms"
        :key="`prev-${tp.name}`"
        class="flex flex-col gap-1 border border-border-default rounded px-2 py-1.5"
        :data-test="`composite-preview-term-${tp.name}`"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <span class="composite-term-chip">{{ tp.name }}</span>
          <span v-if="tp.member_name" class="text-xs text-text-secondary">{{ tp.member_name }}</span>
          <OTag :variant="stateTagType(tp.state)" :value="tp.state" class="uppercase" />
        </div>
        <span class="text-xs text-text-secondary leading-relaxed">{{ termExplanation(tp) }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { cloneDeep } from "lodash-es";
import { validateCompositeExpression } from "@/utils/alerts/compositeExpression";
import { b64EncodeUnicode } from "@/utils/zincutils";
import alertsService from "@/services/alerts";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

/** Transforms a scratch term's draft query into the back-end query shape. */
const buildDraftQueryCondition = (draft: any): any => {
  const qc = { ...(draft.query_condition || {}) };
  const type = qc.type || "custom";
  if (type === "custom") {
    qc.conditions = { version: 2, conditions: qc.conditions };
    qc.sql = "";
    qc.promql = "";
    qc.promql_condition = null;
    if (!(qc.aggregation?.group_by || []).filter((g: string) => g?.trim()).length) {
      qc.aggregation = null;
    }
  } else if (type === "sql") {
    qc.conditions = null;
    qc.promql = "";
    qc.promql_condition = null;
    qc.aggregation = null;
  } else if (type === "promql") {
    qc.conditions = null;
    qc.sql = "";
    qc.aggregation = null;
  }
  if (qc.vrl_function) qc.vrl_function = b64EncodeUnicode(String(qc.vrl_function).trim());
  return qc;
};

export default defineComponent({
  name: "CompositePreview",
  components: { OButton, OTag },
  props: {
    /** The reactive composite spec. */
    composite: {
      type: Object as any,
      required: true,
    },
    /** The shared composite schedule (parent trigger_condition). */
    triggerCondition: {
      type: Object as any,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();
    const store = useStore();

    const previewLoading = ref(false);
    const previewError = ref<string | null>(null);
    const previewResult = ref<any | null>(null);

    const stateTagType = (state: string) => {
      if (state === "true") return "success-soft";
      if (state === "error") return "error-soft";
      return "default-soft";
    };

    // The composite expression with each term name replaced by its state, so
    // authors can see exactly how the result was reached, e.g.
    //   A && B  →  TRUE && ERROR
    const substitutedExpression = computed(() => {
      if (!previewResult.value) return "";
      let expr = props.composite.expression || "";
      for (const tp of previewResult.value.terms) {
        // Whole-word replace of the term name with its uppercased state.
        expr = expr.replace(
          new RegExp(`\\b${tp.name}\\b`, "g"),
          tp.state.toUpperCase(),
        );
      }
      return expr;
    });

    // Plain-English reason for a term's tri-state (the member alert owns the
    // threshold, so we report the observed value + verdict).
    const termExplanation = (tp: any): string => {
      if (tp.state === "error") {
        return tp.error
          ? t("alerts.composite.termErrorReason", { error: tp.error })
          : t("alerts.composite.termErrorGeneric");
      }
      const verdict =
        tp.state === "true"
          ? t("alerts.composite.conditionMet")
          : t("alerts.composite.conditionNotMet");
      return `${tp.value} ${t("alerts.composite.matchingRows")} → ${verdict}`;
    };

    const runPreview = async () => {
      const exprCheck = validateCompositeExpression(
        props.composite.expression || "",
        props.composite.terms.map((tm: any) => tm.name),
      );
      if (!exprCheck.valid) {
        previewResult.value = null;
        previewError.value = exprCheck.error;
        return;
      }
      previewLoading.value = true;
      previewError.value = null;
      try {
        // Each term is either an existing member ref (alert_id) or an inline
        // draft query for a not-yet-saved "New" term (R1.5).
        const terms = props.composite.terms.map((tm: any) => {
          if (tm.mode === "new") {
            const draft = cloneDeep(tm.draft);
            return {
              name: tm.name,
              stream_type: draft.stream_type,
              stream_name: draft.stream_name,
              query_condition: buildDraftQueryCondition(draft),
              operator: draft.operator,
              threshold: parseInt(draft.threshold),
            };
          }
          return { name: tm.name, alert_id: tm.alert_id };
        });
        const payload: any = {
          expression: props.composite.expression,
          trigger_condition: cloneDeep(props.triggerCondition),
          terms,
        };
        const res = await alertsService.preview_composite(
          store.state.selectedOrganization.identifier,
          payload,
        );
        previewResult.value = res.data;
      } catch (err: any) {
        previewResult.value = null;
        previewError.value =
          err?.response?.data?.message ||
          err?.response?.data ||
          t("alerts.composite.previewFailed");
      } finally {
        previewLoading.value = false;
      }
    };

    return {
      t,
      previewLoading,
      previewError,
      previewResult,
      stateTagType,
      substitutedExpression,
      termExplanation,
      runPreview,
    };
  },
});
</script>

<style scoped>
/* Exact-alias chip (no case/space transform, unlike OTag's humanised labels). */
.composite-term-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-mono);
  background: var(--color-badge-primary-soft-bg);
  color: var(--color-badge-primary-soft-text);
  white-space: nowrap;
}
</style>
