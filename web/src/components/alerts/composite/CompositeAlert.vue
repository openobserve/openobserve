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
  <div class="composite-alert flex flex-col gap-4 pt-3" data-test="composite-alert">
    <!-- Info: what a composite alert is + what you can do. Dismissible; re-opened
         from the info icon beside the Simple | Composite toggle (parent). -->
    <div v-if="!infoDismissed" class="relative">
      <span
        class="absolute z-10 cursor-pointer text-text-secondary hover:text-text-primary"
        style="top: 10px; right: 10px"
        data-test="composite-info-dismiss"
        :title="t('alerts.composite.dismiss')"
        @click="$emit('update:infoDismissed', true)"
      >
        <OIcon name="close" size="sm" />
      </span>
      <OBanner variant="info" icon="info" data-test="composite-info-banner">
        <div class="flex flex-col gap-1.5 pr-6">
          <span class="text-sm font-semibold">{{ t("alerts.composite.infoTitle") }}</span>
          <span class="text-xs leading-relaxed">{{ t("alerts.composite.infoBody") }}</span>
          <div class="text-xs leading-relaxed">
            <span class="font-semibold">{{ t("alerts.composite.youCan") }}:</span>
            <ul class="list-disc pl-5 mt-1 flex flex-col gap-0.5">
              <li>{{ t("alerts.composite.infoUse1") }}</li>
              <li>{{ t("alerts.composite.infoUse2") }}</li>
              <li>{{ t("alerts.composite.infoUse3") }}</li>
            </ul>
          </div>
          <span class="text-xs opacity-80">{{ t("alerts.composite.infoExample") }}</span>
        </div>
      </OBanner>
    </div>

    <!-- Terms -->
    <div ref="termsListRef" class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">{{ t("alerts.composite.terms") }}</span>
          <OTag type="default" :value="`${composite.terms.length}/${MAX_TERMS}`" />
        </div>
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          :disabled="composite.terms.length >= MAX_TERMS"
          data-test="composite-add-term-btn"
          @click="addTerm"
        >
          {{ t("alerts.composite.addTerm") }}
        </OButton>
      </div>

      <CompositeTermCard
        v-for="(term, idx) in composite.terms"
        :key="idx"
        :term="term"
        :memberOptions="memberOptions"
        :loadingMembers="loadingMembers"
        :canRemove="composite.terms.length > 2"
        :beingUpdated="beingUpdated"
        @remove="removeTerm(idx)"
        @open-member="openMember"
      />
    </div>

    <!-- Expression -->
    <div class="card-container border border-border-default rounded-md p-3 flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">{{ t("alerts.composite.expression") }} <span class="text-text-primary">*</span></span>
        <OTooltip :content="t('alerts.composite.expressionHelp')" />
      </div>
      <OInput
        v-model="composite.expression"
        data-test="composite-expression-input"
        :placeholder="t('alerts.composite.expressionPlaceholder')"
        class="text-sm"
        :class="expressionResult.valid ? '' : 'field-error'"
      />
      <!-- Term chips (exact aliases; click to insert into the expression) -->
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-xs text-text-secondary">{{ t("alerts.composite.availableTerms") }}:</span>
        <span
          v-for="term in composite.terms"
          :key="term.name"
          class="composite-term-chip cursor-pointer"
          :data-test="`composite-expr-chip-${term.name}`"
          @click="insertTerm(term.name)"
        >{{ term.name || "—" }}</span>
      </div>
      <div
        v-if="!expressionResult.valid && composite.expression"
        class="flex items-center gap-1 text-[13px] font-medium text-negative"
        data-test="composite-expression-error"
      >
        <OIcon name="error-outline" size="xs" />
        {{ expressionResult.error }}
      </div>
    </div>

    <!-- Shared evaluation schedule -->
    <div class="card-container border border-border-default rounded-md p-3 flex flex-col gap-3">
      <span class="text-sm font-semibold">{{ t("alerts.composite.schedule") }}</span>
      <div class="flex items-center gap-4 flex-wrap">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.period") }}</span>
          <OInput
            v-model.number="triggerCondition.period"
            type="number"
            :min="1"
            class="w-[90px] h-[28px]! min-h-[28px]!"
            data-test="composite-period-input"
          />
          <span class="text-xs text-text-secondary">{{ t("alerts.composite.minutes") }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.frequency") }}</span>
          <OInput
            v-model.number="triggerCondition.frequency"
            type="number"
            :min="1"
            class="w-[90px] h-[28px]! min-h-[28px]!"
            data-test="composite-frequency-input"
          />
          <span class="text-xs text-text-secondary">{{ t("alerts.composite.minutes") }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold whitespace-nowrap">{{ t("alerts.composite.silence") }}</span>
          <OInput
            v-model.number="triggerCondition.silence"
            type="number"
            :min="0"
            class="w-[90px] h-[28px]! min-h-[28px]!"
            data-test="composite-silence-input"
          />
          <span class="text-xs text-text-secondary">{{ t("alerts.composite.minutes") }}</span>
        </div>
      </div>
    </div>

    <!-- Notifications -->
    <div class="card-container border border-border-default rounded-md p-3 flex flex-col gap-3">
      <span class="text-sm font-semibold">{{ t("alerts.composite.notifications") }}</span>

      <!-- Composite-level destinations (required) -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs font-semibold whitespace-nowrap min-w-[130px]">
          {{ t("alerts.composite.onComposite") }} <span class="text-text-primary">*</span>
        </span>
        <OSelect
          :model-value="composite.notify.on_composite"
          :options="destinations"
          multiple
          class="min-w-[260px] h-[28px]! min-h-[28px]!"
          data-test="composite-on-composite-select"
          :class="composite.notify.on_composite.length ? '' : 'field-error'"
          @update:model-value="(val) => (composite.notify.on_composite = val)"
        />
        <OButton
          variant="ghost"
          size="xs"
          icon-left="refresh"
          data-test="composite-refresh-destinations"
          @click="$emit('refresh:destinations')"
        />
      </div>

      <!-- Per-term destinations (optional) -->
      <div class="flex flex-col gap-2">
        <span class="text-xs text-text-secondary">{{ t("alerts.composite.onTermHelp") }}</span>
        <div
          v-for="term in composite.terms"
          :key="`onterm-${term.name}`"
          class="flex items-center gap-2 flex-wrap"
        >
          <span class="composite-term-chip">{{ term.name }}</span>
          <OSelect
            :model-value="composite.notify.on_term[term.name] || []"
            :options="destinations"
            multiple
            class="min-w-[260px] h-[28px]! min-h-[28px]!"
            :data-test="`composite-on-term-${term.name}-select`"
            @update:model-value="(val) => setOnTerm(term.name, val)"
          />
        </div>
      </div>

      <!-- On-error policy -->
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold whitespace-nowrap min-w-[130px]">{{ t("alerts.composite.onError") }}</span>
        <OSelect
          :model-value="composite.on_error"
          :options="onErrorOptions"
          :searchable="false"
          class="min-w-[220px] h-[28px]! min-h-[28px]!"
          data-test="composite-on-error-select"
          @update:model-value="(val) => (composite.on_error = val)"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, nextTick, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import CompositeTermCard from "@/components/alerts/composite/CompositeTermCard.vue";
import { validateCompositeExpression } from "@/utils/alerts/compositeExpression";
import alertsService from "@/services/alerts";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

/** Keep in sync with `MAX_TERMS` in the back-end (config composite.rs). */
const MAX_TERMS = 10;

/** The query-builder draft used when creating a member from scratch ("New").
 * Non-query fields (destinations, schedule, name, folder) are inherited from the
 * composite at save time — the user only fills the query + threshold. */
export const makeMemberDraft = () => ({
  stream_type: "logs",
  stream_name: "",
  query_condition: {
    conditions: {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "",
      conditions: [],
    },
    sql: "",
    promql: "",
    type: "custom",
    aggregation: {
      group_by: [],
      function: "avg",
      having: { column: "", operator: ">=", value: 1 },
    },
    promql_condition: null,
    vrl_function: null,
    multi_time_range: [],
  },
  operator: ">=",
  threshold: 1,
});

/**
 * A composite term: an alias + one of two sources. In `existing` mode the user
 * picks an alert the composite re-runs each tick (the referenced alert is never
 * modified or paused). In `new` mode they build a query (`draft`) stored inline
 * on the composite — no separate alert is created.
 */
export const makeCompositeTerm = (name: string) => ({
  name, // alias / expression identifier ([A-Za-z0-9_])
  mode: "existing", // "existing" | "new"
  alert_id: "", // referenced alert id (existing mode)
  member_name: "", // display name of the referenced alert
  draft: makeMemberDraft(), // inline query (new mode)
});

/** The default composite spec attached when switching to composite mode. */
export const makeDefaultComposite = () => ({
  terms: [makeCompositeTerm("A"), makeCompositeTerm("B")],
  expression: "A && B",
  notify: { on_composite: [], on_term: {} },
  on_error: "suppress",
});

export default defineComponent({
  name: "CompositeAlert",
  components: { CompositeTermCard, OSelect, OInput, OButton, OTag, OTooltip, OBanner, OIcon },
  props: {
    /** The reactive composite spec (mutated in place). */
    composite: {
      type: Object as any,
      required: true,
    },
    /** The shared composite schedule (parent trigger_condition). */
    triggerCondition: {
      type: Object as any,
      required: true,
    },
    /** Available destination names. */
    destinations: {
      type: Array as () => string[],
      default: () => [],
    },
    /** The composite's folder id — members must come from this folder (R1.7). */
    folderId: {
      type: String,
      default: "default",
    },
    /** The composite alert's own id (edit mode) — excluded from member options. */
    selfId: {
      type: String,
      default: "",
    },
    beingUpdated: {
      type: Boolean,
      default: false,
    },
    /** Whether the info banner is hidden (controlled by the parent). */
    infoDismissed: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["refresh:destinations", "update:infoDismissed"],
  setup(props) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const termsListRef = ref<HTMLElement | null>(null);

    // Open a member alert's edit form in a new tab (deep-link into the alert
    // list, which loads the alert by id when action=update).
    const openMember = (alertId: string) => {
      if (!alertId) return;
      const href = router.resolve({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          action: "update",
          alert_id: alertId,
          folder: props.folderId || "default",
        },
      }).href;
      window.open(href, "_blank");
    };

    // Alerts in the composite's folder eligible to be referenced: scheduled and
    // not themselves a composite (no nesting). Referenced alerts keep running
    // independently — referencing one has no effect on it.
    const memberOptions = ref<
      Array<{
        label: string;
        value: string;
        queryType: string;
        operator: string;
        threshold: any;
      }>
    >([]);
    const loadingMembers = ref(false);
    const loadMembers = async () => {
      loadingMembers.value = true;
      try {
        const res: any = await alertsService.listByFolderId(
          1,
          1000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier,
          props.folderId || "default",
          "",
          "scheduled",
        );
        const list = res?.data?.list || res?.data || [];
        memberOptions.value = list
          .filter(
            (a: any) =>
              !a.is_composite &&
              !a.composite &&
              (a.alert_id || a.id) !== props.selfId,
          )
          .map((a: any) => ({
            label: a.name,
            value: a.alert_id || a.id,
            queryType: (a.condition?.type || "custom").toUpperCase(),
            operator: a.trigger_condition?.operator || ">=",
            threshold: a.trigger_condition?.threshold ?? 1,
          }));
        // Backfill member_name on existing terms so cards/summary show the name
        // even on edit-load (before the user re-picks).
        const byId: Record<string, string> = {};
        memberOptions.value.forEach((o) => (byId[o.value] = o.label));
        props.composite.terms.forEach((tm: any) => {
          if (tm.alert_id && !tm.member_name && byId[tm.alert_id]) {
            tm.member_name = byId[tm.alert_id];
          }
        });
      } catch {
        memberOptions.value = [];
      } finally {
        loadingMembers.value = false;
      }
    };

    const onErrorOptions = computed(() => [
      { label: t("alerts.composite.onErrorSuppress"), value: "suppress" },
      { label: t("alerts.composite.onErrorNotify"), value: "notify" },
    ]);

    const expressionResult = computed(() =>
      validateCompositeExpression(
        props.composite.expression || "",
        props.composite.terms.map((tm: any) => tm.name),
      ),
    );

    /** Next unused single-letter term name (A, B, C, ...). */
    const nextTermName = (): string => {
      const used = new Set(props.composite.terms.map((tm: any) => tm.name));
      for (let i = 0; i < 26; i++) {
        const name = String.fromCharCode(65 + i);
        if (!used.has(name)) return name;
      }
      return `T${props.composite.terms.length}`;
    };

    const addTerm = () => {
      if (props.composite.terms.length >= MAX_TERMS) return;
      // Mark as added this session so its Existing/New toggle stays editable in
      // update mode (already-saved terms stay locked — see CompositeTermCard).
      props.composite.terms.push({ ...makeCompositeTerm(nextTermName()), _isNew: true });
      // Move focus to the new term so the author sees where it was added.
      nextTick(() => {
        const cards = termsListRef.value?.querySelectorAll(".composite-term-card");
        const last = cards && (cards[cards.length - 1] as HTMLElement | undefined);
        if (last) {
          last.scrollIntoView({ behavior: "smooth", block: "center" });
          // Focus the first focusable control (stream-type select) of the card.
          const focusable = last.querySelector<HTMLElement>(
            "input, select, button, [tabindex]",
          );
          focusable?.focus();
        }
      });
    };

    const removeTerm = (idx: number) => {
      if (props.composite.terms.length <= 2) return;
      const [removed] = props.composite.terms.splice(idx, 1);
      if (removed && props.composite.notify.on_term[removed.name]) {
        delete props.composite.notify.on_term[removed.name];
      }
    };

    const setOnTerm = (name: string, val: string[]) => {
      if (!val || val.length === 0) {
        delete props.composite.notify.on_term[name];
      } else {
        props.composite.notify.on_term[name] = val;
      }
    };

    const insertTerm = (name: string) => {
      const expr = props.composite.expression || "";
      props.composite.expression = expr ? `${expr} ${name}` : name;
    };

    onMounted(loadMembers);
    watch(
      () => props.folderId,
      (val, old) => {
        if (val && val !== old) loadMembers();
      },
    );

    return {
      t,
      MAX_TERMS,
      termsListRef,
      memberOptions,
      loadingMembers,
      openMember,
      onErrorOptions,
      expressionResult,
      addTerm,
      removeTerm,
      setOnTerm,
      insertTerm,
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
  background: color-mix(in srgb, var(--q-primary) 12%, transparent);
  color: var(--q-primary);
  white-space: nowrap;
}
</style>
