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
  <div
    data-test="composite-alert-summary"
    class="composite-summary h-full overflow-y-auto p-4 text-[0.8125rem] flex flex-col gap-4"
  >
    <!-- Plain-English sentence -->
    <div
      class="summary-sentence italic leading-[1.6] border-l-2 border-[var(--q-primary)] bg-[color-mix(in_srgb,var(--q-primary)_6%,transparent)] rounded-r px-3 py-2"
    >
      {{ sentence }}
    </div>

    <!-- Checklist -->
    <div class="flex flex-col gap-2">
      <div class="flex items-start gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] mt-1 shrink-0" />
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="font-semibold">{{ t("alerts.composite.firesWhen") }}:</span>
          <code class="summary-chip">{{ composite.expression || "—" }}</code>
        </div>
      </div>

      <div class="flex items-start gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] mt-1 shrink-0" />
        <div class="flex flex-col gap-1 min-w-0">
          <span class="font-semibold">{{ t("alerts.composite.terms") }} ({{ composite.terms.length }})</span>
          <div
            v-for="term in composite.terms"
            :key="`sum-${term.name}`"
            class="flex items-start gap-1.5"
          >
            <span class="summary-chip shrink-0">{{ term.name }}</span>
            <span
              class="leading-relaxed break-all"
              :class="termSummary(term).muted ? 'text-text-secondary italic opacity-70' : 'text-text-secondary'"
            >{{ termSummary(term).text }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] shrink-0" />
        <span class="font-semibold">{{ t("alerts.composite.monitors") }}:</span>
        <span class="summary-chip">{{ triggerCondition.period }} {{ t("alerts.composite.minutes") }}</span>
      </div>

      <div class="flex items-center gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] shrink-0" />
        <span class="font-semibold">{{ t("alerts.composite.checksEvery") }}:</span>
        <span class="summary-chip">{{ triggerCondition.frequency }} {{ t("alerts.composite.minutes") }}</span>
      </div>

      <div class="flex items-start gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] mt-1 shrink-0" />
        <div class="flex flex-wrap items-center gap-1.5 min-w-0">
          <span class="font-semibold">{{ t("alerts.composite.notifies") }}:</span>
          <template v-if="onCompositeDests.length">
            <span v-for="d in onCompositeDests" :key="`d-${d}`" class="summary-chip">{{ d }}</span>
          </template>
          <span v-else class="flex items-center gap-1 text-[var(--o2-warning,#b45309)]">
            {{ t("alerts.composite.noDestination") }}
            <OIcon name="warning" size="xs" />
          </span>
        </div>
      </div>

      <div
        v-for="(dests, name) in onTermEntries"
        :key="`sum-onterm-${name}`"
        class="flex items-start gap-2 pl-6"
      >
        <span class="text-text-secondary">{{ t("alerts.composite.term") }} <span class="summary-chip">{{ name }}</span> →</span>
        <span class="break-all">{{ dests.join(", ") }}</span>
      </div>

      <div class="flex items-center gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] shrink-0" />
        <span class="font-semibold">{{ t("alerts.composite.onError") }}:</span>
        <span class="summary-chip">{{ onErrorSummary }}</span>
      </div>

      <div class="flex items-center gap-2">
        <OIcon name="check" size="xs" class="text-[var(--o2-positive)] shrink-0" />
        <span class="font-semibold">{{ t("alerts.composite.cooldown") }}:</span>
        <span class="summary-chip">{{ triggerCondition.silence }} {{ t("alerts.composite.minutes") }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "CompositeSummary",
  components: { OIcon },
  props: {
    name: {
      type: String,
      default: "",
    },
    composite: {
      type: Object as any,
      required: true,
    },
    triggerCondition: {
      type: Object as any,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();

    const sentence = computed(() =>
      t("alerts.composite.summarySentence", {
        expression: props.composite.expression || "—",
        count: props.composite.terms.length,
        period: props.triggerCondition.period,
        frequency: props.triggerCondition.frequency,
      }),
    );

    // One-line description of a term. Avoid echoing the alias back: only show
    // the member alert name when it differs from the alias, otherwise a muted
    // descriptor. New (scratch) terms describe their draft stream.
    const termSummary = (term: any): { text: string; muted: boolean } => {
      if (term.mode === "new") {
        const d = term.draft || {};
        return d.stream_name
          ? { text: `${d.stream_type} / ${d.stream_name}`, muted: false }
          : { text: t("alerts.composite.newMemberShort"), muted: true };
      }
      const member = term.member_name || "";
      if (member && member.toLowerCase() !== (term.name || "").toLowerCase()) {
        return { text: member, muted: false };
      }
      return {
        text: member ? t("alerts.composite.existingAlert") : "—",
        muted: true,
      };
    };

    const onCompositeDests = computed<string[]>(
      () => props.composite?.notify?.on_composite || [],
    );

    const onTermEntries = computed<Record<string, string[]>>(() => {
      const map = props.composite?.notify?.on_term || {};
      const out: Record<string, string[]> = {};
      Object.keys(map).forEach((k) => {
        if ((map[k] || []).length) out[k] = map[k];
      });
      return out;
    });

    const onErrorSummary = computed(() =>
      props.composite?.on_error === "notify"
        ? t("alerts.composite.onErrorNotify")
        : t("alerts.composite.onErrorSuppress"),
    );

    return {
      t,
      sentence,
      termSummary,
      onCompositeDests,
      onTermEntries,
      onErrorSummary,
    };
  },
});
</script>

<style scoped>
.summary-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.75rem;
  font-weight: 500;
  background: color-mix(in srgb, var(--q-primary) 12%, transparent);
  color: var(--q-primary);
  white-space: nowrap;
}
</style>
