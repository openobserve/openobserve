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
  <div class="composite-alert flex flex-col gap-3" data-test="composite-alert">
    <!-- Info: what a composite alert is + what you can do. Dismissible; re-opened
         from the info icon beside the Simple | Composite toggle (parent). -->
    <div v-if="!infoDismissed" class="relative">
      <span
        class="absolute z-10 top-2.5 right-2.5 cursor-pointer text-text-secondary hover:text-text-body"
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

    <!-- Terms — each term is a query in this one alert. A horizontal tab strip
         (mirrors the dashboard panel query tabs) with one full editor per term. -->
    <div class="rounded-default bg-surface-overlay border border-border-default overflow-hidden">
      <div class="section-header flex items-center py-2.5 px-3 border-b border-border-default">
        <div class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent" />
        <span class="section-header-title text-compact font-semibold tracking-[0.01em] text-text-heading">{{ t("alerts.composite.terms") }}</span>
        <OTag type="countChip" value="primary" class="ml-2">{{ composite.terms.length }}/{{ MAX_TERMS }}</OTag>
      </div>

      <!-- Query-tab strip: one tab per term (alias), + to add, × on a tab to remove. -->
      <div class="flex items-center gap-1 px-2 pt-1.5 border-b border-border-default">
        <div class="flex-1 min-w-0 overflow-hidden">
          <OTabs
            :model-value="activeTermIndex"
            dense
            mobile-arrows
            data-test="composite-term-tabs"
            @update:model-value="(v) => (activeTermIndex = Number(v))"
          >
            <!-- Fixed names (alert_1…) + an always-visible × to remove, like the
                 dashboard query tabs. Dimmed at the 2-term minimum (can't remove). -->
            <OTab
              v-for="(term, idx) in composite.terms"
              :key="idx"
              :name="idx"
              :data-test="`composite-term-tab-${idx}`"
            >
              <span class="inline-flex items-center gap-1.5">
                <span
                  class="font-semibold text-xs whitespace-nowrap"
                  :data-test="`composite-term-tab-name-${idx}`"
                >{{ termLabel(term.name) }}</span>
                <!-- Icon + tooltip wrapped in a relative span so the tooltip
                     scopes to just the ×, not the whole tab. -->
                <span class="inline-flex items-center relative">
                  <OIcon
                    name="close"
                    size="sm"
                    class="transition-opacity"
                    :class="composite.terms.length > 2
                      ? 'opacity-60 hover:opacity-100 cursor-pointer'
                      : 'opacity-30 cursor-not-allowed'"
                    :data-test="`composite-term-tab-remove-${idx}`"
                    @click.stop.prevent="removeTerm(idx)"
                  />
                  <OTooltip
                    :content="composite.terms.length > 2
                      ? t('alerts.composite.removeTerm')
                      : t('alerts.composite.minTermsError')"
                  />
                </span>
              </span>
            </OTab>
          </OTabs>
        </div>
        <OButton
          variant="ghost"
          size="icon"
          icon-left="add"
          :disabled="composite.terms.length >= MAX_TERMS"
          data-test="composite-add-term-btn"
          @click="addTerm"
        />
      </div>

      <!-- Active term editor (full-width, like a normal alert's query builder). -->
      <div class="px-3 py-3">
        <CompositeTermCard
          v-if="activeTerm"
          :key="activeTermIndex"
          :term="activeTerm"
          :memberOptions="memberOptions"
          :loadingMembers="loadingMembers"
          :beingUpdated="beingUpdated"
          @open-member="openMember"
        />
      </div>
    </div>

    <!-- Fires when — visual boolean builder (pills + AND/OR joiners + groups). -->
    <div class="rounded-default bg-surface-overlay border border-border-default overflow-hidden">
      <div class="section-header flex items-center py-2.5 px-3 border-b border-border-default">
        <div class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent" />
        <span class="section-header-title text-compact font-semibold tracking-[0.01em] text-text-heading">{{ t("alerts.composite.firesWhen") }} <span class="text-text-body">*</span></span>
        <span class="ml-1.5 inline-flex"><OTooltip :content="t('alerts.composite.expressionHelp')" /></span>
      </div>
      <div class="px-3 py-2">
        <CompositeExpressionBuilder
          :expression="composite.expression"
          :terms="composite.terms"
          :error="expressionResult.valid || !composite.expression ? '' : (expressionResult.error || '')"
          @update:expression="setExpression"
        />
      </div>
    </div>

    <!-- Shared evaluation schedule -->
    <div class="rounded-default bg-surface-overlay border border-border-default overflow-hidden">
      <div class="section-header flex items-center py-2.5 px-3 border-b border-border-default">
        <div class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent" />
        <span class="section-header-title text-compact font-semibold tracking-[0.01em] text-text-heading">{{ t("alerts.composite.schedule") }}</span>
      </div>
      <!-- Schedule fields REUSE the form's trigger_condition + the simple-alert
           field styling (label + tooltip + addon unit). Stacked vertically. -->
      <div class="px-3 py-3 flex flex-col gap-4">
        <!-- Period -->
        <div class="flex items-start">
          <div class="font-semibold flex items-center w-47.5 h-7 text-text-heading text-compact">
            {{ t("alerts.period") }} <span class="text-text-body ml-0.5">*</span>
            <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
            <OTooltip :content="t('alerts.alertSettings.periodTooltip')" side="right" />
          </div>
          <div class="flex items-center">
            <div class="w-21.75">
              <OFormInput name="trigger_condition.period" type="number" min="1" data-test="composite-period-input">
                <template #error />
              </OFormInput>
            </div>
            <div class="flex justify-center items-center bg-input-addon-bg text-input-addon-text min-w-22.5 h-8.5 text-compact">
              {{ t("alerts.minutes") }}
            </div>
          </div>
        </div>
        <!-- Check every -->
        <div class="flex items-start">
          <div class="font-semibold flex items-center w-47.5 h-7 text-text-heading text-compact">
            {{ t("alerts.composite.frequency") }}
            <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
            <OTooltip :content="t('alerts.alertSettings.frequencyTooltipMinutes')" side="right" />
          </div>
          <div class="flex items-center">
            <div class="w-21.75">
              <OFormInput name="trigger_condition.frequency" type="number" min="1" data-test="composite-frequency-input">
                <template #error />
              </OFormInput>
            </div>
            <div class="flex justify-center items-center bg-input-addon-bg text-input-addon-text min-w-22.5 h-8.5 text-compact">
              {{ t("alerts.minutes") }}
            </div>
          </div>
        </div>
        <!-- Silence / cooldown -->
        <div class="flex items-start">
          <div class="font-semibold flex items-center w-47.5 h-7 text-text-heading text-compact">
            {{ t("alerts.composite.silence") }} <span class="text-text-body ml-0.5">*</span>
            <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
            <OTooltip :content="t('alerts.alertSettings.cooldownTooltip')" side="right" />
          </div>
          <div class="flex items-center">
            <div class="w-21.75">
              <OFormInput name="trigger_condition.silence" type="number" min="0" data-test="composite-silence-input">
                <template #error />
              </OFormInput>
            </div>
            <div class="flex justify-center items-center bg-input-addon-bg text-input-addon-text min-w-22.5 h-8.5 text-compact">
              {{ t("alerts.minutes") }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Notifications -->
    <div class="rounded-default bg-surface-overlay border border-border-default overflow-hidden">
      <div class="section-header flex items-center py-2.5 px-3 border-b border-border-default">
        <div class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent" />
        <span class="section-header-title text-compact font-semibold tracking-[0.01em] text-text-heading">{{ t("alerts.composite.notifications") }}</span>
      </div>
      <div class="px-3 py-3 flex flex-col gap-4">

      <!-- Composite-level destinations — reuses the simple-alert destination
           picker (inline refresh + add-destination). Side label like the simple
           alert; not reddened until a save is attempted (validateCompositeAlert). -->
      <div class="flex items-start">
        <div class="font-semibold flex items-center w-47.5 h-7 text-text-heading text-compact">
          {{ t("alerts.destination") }} <span class="text-text-body ml-0.5">*</span>
          <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
          <OTooltip :content="t('alerts.alertSettings.destinationsTooltip')" side="right" />
        </div>
        <div class="flex flex-col flex-1 min-w-0">
          <AlertTargetsSelect
            :destinations="composite.notify.on_composite"
            :workflows="[]"
            :destination-options="destinations"
            :workflow-options="[]"
            :workflows-enabled="false"
            @update:destinations="setOnComposite"
            @refresh="$emit('refresh:destinations')"
            @create-destination="onCreateDestination"
          />
        </div>
      </div>

      <!-- On-error policy -->
      <div class="flex items-start">
        <div class="font-semibold flex items-center w-47.5 h-7 text-text-heading text-compact">{{ t("alerts.composite.onError") }}</div>
        <OSelect
          :model-value="composite.on_error"
          :options="onErrorOptions"
          :searchable="false"
          class="w-75! h-7! min-h-7!"
          data-test="composite-on-error-select"
          @update:model-value="setOnError"
        />
      </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import CompositeTermCard from "@/components/alerts/composite/CompositeTermCard.vue";
import CompositeExpressionBuilder from "@/components/alerts/composite/CompositeExpressionBuilder.vue";
import { validateCompositeExpression } from "@/utils/alerts/compositeExpression";
import {
  parseToAst,
  serializeAst,
  addTermAtPath,
  pruneAlias,
} from "@/utils/alerts/compositeExpressionAst";
import alertsService from "@/services/alerts";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import AlertTargetsSelect from "@/components/alerts/AlertTargetsSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";

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
  mode: "new", // "new" (define a query — the goal: multiple queries in one alert) | "existing"
  alert_id: "", // referenced alert id (existing mode)
  member_name: "", // display name of the referenced alert
  draft: makeMemberDraft(), // inline query (new mode)
});

/** The default composite spec attached when switching to composite mode. */
export const makeDefaultComposite = () => ({
  terms: [makeCompositeTerm("alert_1"), makeCompositeTerm("alert_2")],
  expression: "alert_1 && alert_2",
  notify: { on_composite: [], on_term: {} },
  on_error: "suppress",
});

export default defineComponent({
  name: "CompositeAlert",
  components: { CompositeTermCard, CompositeExpressionBuilder, AlertTargetsSelect, OSelect, OFormInput, OButton, OTag, OTooltip, OBanner, OIcon, OTabs, OTab },
  props: {
    /** The reactive composite spec (mutated in place). */
    composite: {
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

    // Alias the parent-owned reactive model props. The parent (useAlertForm)
    // passes a mutable `composite`/`compositeTrigger` it owns one-way; editing
    // through these computed aliases keeps the same reference, so in-place writes
    // propagate exactly as before while satisfying vue/no-mutating-props.
    const composite = computed(() => props.composite);

    // Open the destination create page (reuses the simple-alert affordance).
    const onCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    // Friendly display label derived from the identifier: "alert_1" → "Alert 1".
    // The identifier (term.name) stays the expression token; only display changes.
    const termLabel = (name: string): string =>
      (name || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    // Template write handlers — mutate the parent-owned model via the computed
    // aliases (script mutation), keeping the template free of prop mutations.
    const setExpression = (val: string | number) => {
      composite.value.expression = String(val ?? "");
    };
    const setOnComposite = (val: SelectModelValue) => {
      composite.value.notify.on_composite = Array.isArray(val)
        ? (val as string[])
        : [];
    };
    const setOnError = (val: SelectModelValue) => {
      composite.value.on_error = Array.isArray(val) ? val[0] : val;
    };

    // The term currently open in the tab strip.
    const activeTermIndex = ref(0);
    const activeTerm = computed(
      () => composite.value.terms[activeTermIndex.value] || null,
    );

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
        composite.value.terms.forEach((tm: any) => {
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
        composite.value.expression || "",
        composite.value.terms.map((tm: any) => tm.name),
      ),
    );

    /** Next unused single-letter term name (A, B, C, ...). */
    // Fixed, sequential names (alert_1, alert_2, …) — the expression identifier
    // and the tab label (shown as "Alert 1"), not user-edited.
    const nextTermName = (): string => {
      const used = new Set(composite.value.terms.map((tm: any) => tm.name));
      for (let i = 1; i <= MAX_TERMS + 10; i++) {
        const name = `alert_${i}`;
        if (!used.has(name)) return name;
      }
      return `alert_${composite.value.terms.length + 1}`;
    };

    // Keep the expression in sync with the query list: a new query joins the
    // root group (AND by default); a removed query is pruned from the tree.
    const addAliasToExpression = (name: string) => {
      const expr = (composite.value.expression || "").trim();
      if (!expr) {
        composite.value.expression = name;
        return;
      }
      try {
        const tree = parseToAst(expr);
        addTermAtPath(tree, [], name);
        composite.value.expression = serializeAst(tree);
      } catch {
        composite.value.expression = `${expr} && ${name}`;
      }
    };
    const removeAliasFromExpression = (name: string) => {
      const expr = (composite.value.expression || "").trim();
      if (!expr) return;
      try {
        const tree = parseToAst(expr);
        pruneAlias(tree, name);
        composite.value.expression = serializeAst(tree);
      } catch {
        /* leave an unparseable expression for the author to fix in text mode */
      }
    };

    const addTerm = () => {
      if (composite.value.terms.length >= MAX_TERMS) return;
      // Mark as added this session so its mode/query stays editable in update
      // mode (already-saved terms stay locked — see CompositeTermCard).
      const name = nextTermName();
      composite.value.terms.push({ ...makeCompositeTerm(name), _isNew: true });
      addAliasToExpression(name);
      // Open the new term's tab.
      activeTermIndex.value = composite.value.terms.length - 1;
    };

    const removeTerm = (idx: number | string) => {
      if (composite.value.terms.length <= 2) return;
      const i = Number(idx);
      const [removed] = composite.value.terms.splice(i, 1);
      if (removed && composite.value.notify.on_term[removed.name]) {
        delete composite.value.notify.on_term[removed.name];
      }
      if (removed) removeAliasFromExpression(removed.name);
      // Keep the open tab valid: shift left if a tab before it went away, and
      // clamp if the last tab was the one removed.
      const last = composite.value.terms.length - 1;
      if (activeTermIndex.value > i) activeTermIndex.value -= 1;
      else if (activeTermIndex.value > last) activeTermIndex.value = last;
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
      termLabel,
      onCreateDestination,
      MAX_TERMS,
      activeTermIndex,
      activeTerm,
      memberOptions,
      loadingMembers,
      openMember,
      onErrorOptions,
      expressionResult,
      addTerm,
      removeTerm,
      setExpression,
      setOnComposite,
      setOnError,
    };
  },
});
</script>
