<template>
  <ODrawer
    bleed
    :open="open"
    side="right"
    :width="70"
    :title="row?.name"
    :title-data-test="'eval-job-detail-name-badge'"
    :sub-title="t('onlineEvals.job.detail.eyebrow')"
    data-test="eval-job-detail"
    @update:open="handleOpenChange"
  >
    <!-- Body: the KPI strip + tab bar stay pinned; only the tab content scrolls. -->
    <div class="flex flex-col h-full min-h-0">
      <!-- ── Global window control ── -->
      <!-- A single date picker drives the WHOLE detail view — the KPI strip
           and both the Runs and Failures tables share this one window. Placed
           above the cards (right-aligned) so it reads as a page-level control,
           not a per-tab filter. Refresh re-queries everything. -->
      <div
        class="flex items-center justify-end gap-2 px-5 pt-3"
      >
        <DateTimePickerDashboard
          ref="dateTimePickerRef"
          v-model="selectedDate"
          :auto-apply-dashboard="true"
          class="flex-none"
          data-test="eval-job-detail-window"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isLoadingKpis || isLoadingRuns"
          :title="t('onlineEvals.job.detail.refresh')"
          data-test="eval-job-detail-refresh"
          @click="refreshAll"
        />
      </div>

      <!-- ── KPI strip ── -->
      <!-- KPI strip — identical card layout + text styles to the LLM
           Sessions detail page (SessionDetails.vue) so the AI module stays
           consistent. Pinned band (shrink-0) with a bottom divider; the cards
           below carry their own chrome via Tailwind. -->
      <section
        class="flex-shrink-0 grid grid-cols-4 gap-2.5 px-5 py-4 border-b border-b-dialog-header-border"
      >
        <!-- While the KPI query is in flight, show skeleton tiles in place of
             the cards (matches the LLM Insights dashboard pattern). -->
        <KpiCardsSkeleton v-if="isLoadingKpis" :count="4" />
        <div
          v-for="card in kpiCards"
          v-else
          :key="card.label"
          class="rounded-default flex flex-col px-3.5 pt-2.5 pb-2.5 gap-1 bg-surface-base border border-border-default transition-shadow duration-200 hover:shadow-[0_0.0625rem_0.375rem_color-mix(in_srgb,var(--color-black)_8%,transparent)]"
        >
          <div
            class="kpi-label text-2xs leading-normal font-semibold mb-1 text-text-secondary"
          >
            {{ card.label }}
          </div>
          <div class="flex items-baseline gap-[0.2rem]">
            <span
              class="text-2xl font-bold leading-none text-text-secondary"
            >
              {{ card.value }}
            </span>
            <span
              v-if="card.unit"
              class="text-compact font-semibold text-text-secondary"
            >
              {{ card.unit }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── Tab strip ── -->
      <OTabs
        :model-value="activeTab"
        bordered
        class="flex-shrink-0 px-5"
        data-test="eval-job-detail-tabs"
        @update:model-value="activeTab = $event as TabId"
      >
        <OTab
          v-for="tab in tabs"
          :key="tab.id"
          :name="tab.id"
          :label="tab.label"
          :data-test="`eval-job-detail-tab-${tab.id}`"
        />
      </OTabs>

      <!-- ── Body ── -->
      <!-- Horizontal padding lives on the children (sections + toolbar), not
           the body, so the Runs/Failures table sits full-bleed with
           edge-to-edge column headers. Bottom padding is opt-in for the
           Configuration (form) tab; the table tabs stay flush to the bottom. -->
      <div
        class="flex-1 overflow-auto flex flex-col gap-[1.125rem] min-h-0 pt-[1.125rem]"
        :class="{ 'pb-[1.125rem]': activeTab === 'configuration' }"
      >
        <!-- Shared Runs/Failures filter row — agent filter (both tabs),
             right-aligned. The date picker + refresh live in the global
             toolbar above the cards, so they're not duplicated here. Rendered
             once with v-show (not v-if) so it never remounts on tab switch. -->
        <div
          v-show="tableEnabled"
          class="flex items-center justify-end gap-2 flex-wrap px-5"
        >
          <div class="w-56 flex-shrink-0">
            <OSelect
              v-model="agentKey"
              :options="agentOptions"
              labelKey="label"
              valueKey="value"
              class="w-full rounded-default"
              data-test="eval-job-detail-runs-agent-filter"
            />
          </div>
        </div>

        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <!-- Target -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-1.5 inline-flex items-center gap-1.5 text-compact font-semibold leading-[1.5] text-text-heading border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.targetSection") }}
            </h4>
            <dl class="grid grid-cols-[8.125rem_1fr] gap-x-3.5 gap-y-1.5 m-0">
              <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.streamLabel") }}</dt>
              <dd class="m-0 text-compact text-text-body wrap-break-word">{{ row.stream }}</dd>

              <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.streamTypeLabel") }}</dt>
              <dd class="m-0 text-compact text-text-body wrap-break-word">{{ streamType }}</dd>

              <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.targetScopeLabel") }}</dt>
              <dd class="m-0 text-compact text-text-body wrap-break-word">{{ targetScopeLabel }}</dd>

              <template v-if="completionWindow">
                <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.idleWindowLabel") }}</dt>
                <dd class="m-0 text-compact text-text-body wrap-break-word">{{ completionWindow.idleWindowSecs }}{{ t('onlineEvals.job.detail.secondsSuffix') }}</dd>

                <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.maxAgeLabel") }}</dt>
                <dd class="m-0 text-compact text-text-body wrap-break-word">{{ completionWindow.maxAgeSecs }}{{ t('onlineEvals.job.detail.secondsSuffix') }}</dd>
              </template>
            </dl>

            <!-- Filter rendered as a code block with a header bar + copy action,
                 matching the Alert History condition view. -->
            <div
              class="border border-dialog-header-border rounded-default overflow-hidden bg-[color-mix(in_srgb,var(--color-text-secondary)_4%,var(--color-card-bg))]"
              data-test="eval-job-detail-filter"
            >
              <div
                class="flex items-center justify-between px-2.5 py-1.5 border-b border-b-dialog-header-border bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,var(--color-card-bg))]"
              >
                <span class="text-2xs font-medium text-text-secondary">{{
                  t("onlineEvals.job.detail.filterLabel")
                }}</span>
                <OButton
                  v-if="filterText"
                  variant="ghost-muted"
                  size="icon-xs-sq"
                  data-test="eval-job-detail-filter-copy-btn"
                  @click="
                    copyToClipboard(filterText, {
                      successMessage: t('common.copySuccess'),
                    })
                  "
                >
                  <OIcon name="content-copy" size="sm" />
                  <OTooltip :content="t('common.copy')" />
                </OButton>
              </div>
              <!-- Hard cap the filter condition height; longer conditions scroll. -->
              <pre
                class="m-0 px-3.5 py-2.5 font-mono text-compact leading-[1.6] text-text-body whitespace-pre-wrap overflow-x-auto max-h-50 overflow-y-auto"
              >{{
                filterText || t("onlineEvals.job.detail.filterEmpty")
              }}</pre>
            </div>
          </section>

          <!-- Scorers -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-1.5 inline-flex items-center gap-1.5 text-compact font-semibold leading-[1.5] text-text-heading border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.scorersSection") }}
              <OTag type="fieldTag" value="soft">{{
                resolvedScorers.length
              }}</OTag>
            </h4>
            <OEmptyState
              v-if="resolvedScorers.length === 0"
              size="inline"
              :title="t('onlineEvals.job.detail.scorersEmpty')"
              data-test="eval-job-detail-scorers-empty"
            />
            <!-- Show ~3 scorer cards; the rest scroll. The small extra lets the
                 4th card peek as a scroll affordance. padding-right keeps the
                 scrollbar off the card edges. -->
            <ul
              v-else
              class="list-none m-0 p-0 flex flex-col gap-2.5 max-h-100 overflow-y-auto pr-1 pt-2.5"
            >
              <li v-for="item in resolvedScorers" :key="item.id">
                <!-- `group` drives the card's hover affordances on the CTA /
                     chevron below. The chain is hover-AND-enabled, so the group
                     variant carries :not(:disabled) with it — a disabled card
                     must not light up on hover. -->
                <button
                  type="button"
                  class="group w-full flex items-center gap-3.5 px-4 py-3.5 bg-card-bg border border-[color-mix(in_srgb,var(--color-text-secondary)_16%,transparent)] rounded-default text-left cursor-pointer transition-[border-color,background,box-shadow,transform] duration-150 enabled:hover:border-[color-mix(in_srgb,var(--color-primary-600)_45%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))] enabled:hover:shadow-[0_0.0625rem_0.1875rem_color-mix(in_srgb,var(--color-primary-600)_12%,transparent)] enabled:hover:-translate-y-px disabled:opacity-55 disabled:cursor-not-allowed"
                  :data-test="`eval-job-detail-scorer-item-${item.name}`"
                  :disabled="!findScorerById(item.id)"
                  @click="onScorerClick(item.id)"
                >
                  <span
                    class="shrink-0 inline-flex items-center justify-center size-8.5 rounded-default"
                    :class="{
                      'bg-badge-indigo-soft-bg text-badge-indigo-soft-text': item.scorerType === 'llm_judge',
                      'bg-badge-orange-soft-bg text-badge-orange-soft-text': item.scorerType === 'remote',
                      'bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] text-text-secondary': item.scorerType === 'unknown',
                    }"
                  >
                    <OIcon
                      :name="
                        item.scorerType === 'remote' ? 'cloud' : 'smart-toy'
                      "
                      size="sm"
                    />
                  </span>
                  <div class="flex-1 min-w-0 flex flex-col gap-1.25">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-bold text-sm text-text-heading">{{
                        item.name
                      }}</span>
                      <OTag
                        v-if="item.scorerTypeLabel"
                        type="scorerType"
                        :value="item.scorerType"
                      />
                      <span class="text-2xs text-text-secondary"
                        >{{ t('onlineEvals.job.detail.versionPrefix') }}{{ item.version }}</span
                      >
                    </div>
                    <div
                      v-if="item.scoreConfigName"
                      class="flex items-center gap-1.5 text-xs text-text-secondary flex-wrap"
                    >
                      <OIcon
                        name="rule"
                        size="xs"
                        class="shrink-0 text-text-secondary opacity-70"
                      />
                      <span class="font-medium">
                        {{ t("onlineEvals.job.detail.producesPrefix") }}
                      </span>
                      <span class="text-text-body font-bold">{{
                        item.scoreConfigName
                      }}</span>
                      <template v-if="item.scoreConfigDataType">
                        <span class="text-text-secondary opacity-50">·</span>
                        <span class="text-text-secondary">
                          {{ item.scoreConfigDataType }}
                        </span>
                      </template>
                      <template v-if="item.scoreConfigRangeText">
                        <span class="text-text-secondary opacity-50">·</span>
                        <span class="text-text-secondary">
                          {{ item.scoreConfigRangeText }}
                        </span>
                      </template>
                    </div>
                  </div>
                  <span
                    class="shrink-0 inline-flex items-center gap-1 text-text-secondary text-2xs font-semibold group-[:hover:not(:disabled)]:text-accent"
                  >
                    <span class="opacity-0 transition-opacity duration-150 group-[:hover:not(:disabled)]:opacity-100">
                      {{ t("onlineEvals.job.detail.viewScorerHint") }}
                    </span>
                    <OIcon
                      name="chevron-right"
                      size="sm"
                      class="shrink-0 opacity-50 transition-[opacity,transform] duration-150 group-[:hover:not(:disabled)]:opacity-100 group-[:hover:not(:disabled)]:translate-x-0.5"
                    />
                  </span>
                </button>
              </li>
            </ul>
          </section>

          <!-- Sampling -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-1.5 inline-flex items-center gap-1.5 text-compact font-semibold leading-[1.5] text-text-heading border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.samplingSection") }}
            </h4>
            <dl class="grid grid-cols-[8.125rem_1fr] gap-x-3.5 gap-y-1.5 m-0">
              <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.samplingModeLabel") }}</dt>
              <dd class="m-0 text-compact text-text-body wrap-break-word">{{ samplingModeLabel }}</dd>

              <dt v-if="samplingValue != null" class="text-xs font-semibold text-text-secondary">
                {{ t("onlineEvals.job.detail.samplingValueLabel") }}
              </dt>
              <dd v-if="samplingValue != null" class="m-0 text-compact text-text-body wrap-break-word">
                {{ samplingValue }}
              </dd>
            </dl>
          </section>

          <!-- Manual evaluation -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-[0.375rem] inline-flex items-center gap-[0.375rem] text-compact font-semibold leading-[1.5] text-text-heading border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.manualSection") }}
            </h4>
            <p class="m-0 text-xs text-text-secondary">
              {{ t("onlineEvals.job.detail.manualHelp") }}
            </p>
            <OForm
              :form="manualEvalForm"
              class="flex flex-col gap-3"
              v-slot="{ isSubmitting }"
            >
              <div class="grid grid-cols-2 gap-3 max-[45rem]:grid-cols-1">
                <OFormInput
                  name="targetId"
                  :label="t('onlineEvals.job.detail.manualTargetIdLabel')"
                  size="sm"
                  :placeholder="manualTargetPlaceholder"
                  required
                  data-test="eval-job-manual-target-id-input"
                />
                <OFormInput
                  v-if="targetScope === 'span'"
                  name="spanId"
                  :label="t('onlineEvals.job.detail.manualSpanIdLabel')"
                  size="sm"
                  :placeholder="
                    manualFormValues.targetId ||
                    t('onlineEvals.job.detail.manualSpanIdPlaceholder')
                  "
                  data-test="eval-job-manual-span-id-input"
                />
                <OFormInput
                  name="traceId"
                  :label="t('onlineEvals.job.detail.manualTraceIdLabel')"
                  size="sm"
                  :placeholder="
                    targetScope === 'trace'
                      ? manualFormValues.targetId ||
                        t('onlineEvals.job.detail.manualTraceIdPlaceholder')
                      : t('onlineEvals.job.detail.manualTraceIdPlaceholder')
                  "
                  data-test="eval-job-manual-trace-id-input"
                />
                <OFormInput
                  v-if="targetScope !== 'trace'"
                  name="sessionId"
                  :label="t('onlineEvals.job.detail.manualSessionIdLabel')"
                  size="sm"
                  :placeholder="
                    targetScope === 'session'
                      ? manualFormValues.targetId ||
                        t('onlineEvals.job.detail.manualSessionIdPlaceholder')
                      : t('onlineEvals.job.detail.manualSessionIdPlaceholder')
                  "
                  data-test="eval-job-manual-session-id-input"
                />
                <OFormInput
                  name="reason"
                  :label="t('onlineEvals.job.detail.manualReasonLabel')"
                  size="sm"
                  :placeholder="
                    t('onlineEvals.job.detail.manualReasonPlaceholder')
                  "
                  class="col-span-2 max-[45rem]:col-span-1"
                  data-test="eval-job-manual-reason-input"
                />
                <OFormTextarea
                  name="variablesJson"
                  :label="t('onlineEvals.job.detail.manualVariablesLabel')"
                  size="sm"
                  :rows="4"
                  class="col-span-2 max-[45rem]:col-span-1"
                  data-test="eval-job-manual-variables-input"
                />
              </div>
              <div class="flex justify-end">
                <OButton
                  type="submit"
                  variant="primary"
                  size="sm-action"
                  :loading="isSubmitting"
                  data-test="eval-job-manual-submit-btn"
                >
                  {{ t("onlineEvals.job.detail.manualSubmit") }}
                </OButton>
              </div>
            </OForm>
          </section>

          <!-- Metadata -->
          <section class="flex flex-col gap-2 px-5">
            <h4
              class="m-0 pb-1.5 inline-flex items-center gap-1.5 text-compact font-semibold leading-[1.5] text-text-heading border-b border-b-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)]"
            >
              {{ t("onlineEvals.job.detail.metadataSection") }}
            </h4>
            <dl class="grid grid-cols-[8.125rem_1fr] gap-x-3.5 gap-y-1.5 m-0">
              <dt class="text-xs font-semibold text-text-secondary">{{ t("onlineEvals.job.detail.versionLabel") }}</dt>
              <dd class="m-0 text-compact text-text-body wrap-break-word">{{ t('onlineEvals.job.detail.versionPrefix') }}{{ row.version }}</dd>
              <dt v-if="pipelineId" class="text-xs font-semibold text-text-secondary">
                {{ t("onlineEvals.job.detail.pipelineLabel") }}
              </dt>
              <dd v-if="pipelineId" class="m-0 text-compact text-text-body wrap-break-word">{{ pipelineId }}</dd>
              <dt v-if="createdAt" class="text-xs font-semibold text-text-secondary">
                {{ t("onlineEvals.job.detail.createdLabel") }}
              </dt>
              <dd v-if="createdAt" class="m-0 text-compact text-text-body wrap-break-word">
                {{ formatTimestamp(createdAt) }}
              </dd>
              <dt v-if="updatedAt" class="text-xs font-semibold text-text-secondary">
                {{ t("onlineEvals.job.detail.updatedLabel") }}
              </dt>
              <dd v-if="updatedAt" class="m-0 text-compact text-text-body wrap-break-word">
                {{ formatTimestamp(updatedAt) }}
              </dd>
            </dl>
          </section>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <OTable
            data-test="eval-job-detail-runs-table"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="eval-job-runs"
            :data="runs"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :empty-message="t('onlineEvals.job.detail.runs.empty')"
            :footer-title="t('onlineEvals.job.detail.tabs.runs')"
            show-index
            width="100%"
            class="w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="text-text-secondary">{{
                relativeTime(row.timestampMs)
              }}</span>
            </template>
            <template #cell-scorerId="{ row }">
              <span>{{ scorerNameFor(row.scorerId) }}</span>
            </template>
            <template #cell-targetSpanId="{ row }">
              <span
                v-if="row.targetSpanId"
                class="block truncate"
                :title="row.targetSpanId"
                >{{ row.targetSpanId }}</span
              >
              <span v-else class="text-text-secondary">—</span>
            </template>
            <template #cell-targetTraceId="{ row }">
              <span
                v-if="row.targetTraceId"
                class="block truncate"
                :title="row.targetTraceId"
                >{{ row.targetTraceId }}</span
              >
              <span v-else class="text-text-secondary">—</span>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span>{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span>{{
                row.latencyMs != null ? formatLatency(row.latencyMs) : "—"
              }}</span>
            </template>
            <template #cell-status="{ row }">
              <OTag type="evalRunStatus" :value="row.status" />
            </template>
          </OTable>
        </template>

        <!-- Failures -->
        <template v-else-if="activeTab === 'failures'">
          <!-- Single failures table — filterable by agent. -->
          <OTable
            data-test="eval-job-detail-failures-table"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="eval-job-failures"
            :data="failures"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            :empty-message="t('onlineEvals.job.detail.failures.recentEmpty')"
            :footer-title="t('onlineEvals.job.detail.tabs.failures')"
            show-index
            width="100%"
            class="w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="text-text-secondary">{{
                relativeTime(row.timestampMs)
              }}</span>
            </template>
            <template #cell-scorerId="{ row }">
              <span>{{ scorerNameFor(row.scorerId) }}</span>
            </template>
            <template #cell-targetSpanId="{ row }">
              <span
                v-if="row.targetSpanId"
                class="block truncate"
                :title="row.targetSpanId"
                >{{ row.targetSpanId }}</span
              >
              <span v-else class="text-text-secondary">—</span>
            </template>
            <template #cell-targetTraceId="{ row }">
              <span
                v-if="row.targetTraceId"
                class="block truncate"
                :title="row.targetTraceId"
                >{{ row.targetTraceId }}</span
              >
              <span v-else class="text-text-secondary">—</span>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span>{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span>{{
                row.latencyMs != null ? formatLatency(row.latencyMs) : "—"
              }}</span>
            </template>
            <template #cell-status="{ row }">
              <OTag type="evalRunStatus" :value="row.status" />
            </template>
          </OTable>
        </template>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import KpiCardsSkeleton from "./KpiCardsSkeleton.vue";
import { copyToClipboard } from "@/utils/clipboard";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import onlineEvalsService from "@/services/online-evals.service";
import { toast } from "@/lib/feedback/Toast/useToast";
import { showError } from "../utils/evalFormat";
import type {
  EvalJob,
  EvalTargetScope,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { entityId, targetScopeOf } from "../utils/evalEntity";
import { normalizeJobFilterCondition } from "../utils/jobFilter";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import {
  useEvalJobRuns,
  type JobRunRow,
  type JobRunsWindow,
} from "../composables/useEvalJobRuns";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  ALL_AGENTS_VALUE,
  agentFilterKey,
  agentFilterLabel,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";
import {
  makeManualEvalSchema,
  type ManualEvalForm,
} from "./EvalJobDetail.schema";

const props = defineProps<{
  row: EvalJob;
  scorers: Scorer[];
  scoreConfigs: ScoreConfig[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-scorer", row: Scorer): void;
}>();

// Drawer open state — starts open (the parent mounts this only when a job is
// selected). Any dismiss path (× button, Escape, overlay click) flows through
// ODrawer's update:open(false) → we forward `close` to the parent, which
// unmounts us.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("close");
}

const { t } = useI18n();
const store = useStore();
const orgId = computed(
  () => store.state.selectedOrganization?.identifier ?? "default",
);

type TabId = "configuration" | "runs" | "failures";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(
  row: any,
  camel: string,
  snake: string,
): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const streamType = computed<string>(
  () => valueOf<string>(props.row, "streamType", "stream_type") ?? "traces",
);

const targetScope = computed<EvalTargetScope>(() => targetScopeOf(props.row));
const targetScopeLabel = computed(() =>
  t(`onlineEvals.job.targetScopes.${targetScope.value}`),
);

const completionWindow = computed<{
  idleWindowSecs: number;
  maxAgeSecs: number;
} | null>(() => {
  const cfg =
    targetScope.value === "trace"
      ? valueOf<any>(props.row, "traceConfig", "trace_config")
      : targetScope.value === "session"
        ? valueOf<any>(props.row, "sessionConfig", "session_config")
        : null;
  if (!cfg) return null;
  return {
    idleWindowSecs: Number(
      valueOf<any>(cfg, "idleWindowSecs", "idle_window_secs") ?? 0,
    ),
    maxAgeSecs: Number(valueOf<any>(cfg, "maxAgeSecs", "max_age_secs") ?? 0),
  };
});

const manualEvalDefaults = (): ManualEvalForm => ({
  targetId: "",
  spanId: "",
  traceId: "",
  sessionId: "",
  reason: "",
  variablesJson: "{}",
});
const manualEvalForm = useOForm<ManualEvalForm>({
  defaultValues: manualEvalDefaults(),
  schema: makeManualEvalSchema(t),
  onSubmit: submitManualEval,
});
const manualFormValues = manualEvalForm.useStore(
  (state: any) => state.values as ManualEvalForm,
);

const manualTargetPlaceholder = computed(() => {
  if (targetScope.value === "trace") {
    return t("onlineEvals.job.detail.manualTraceIdPlaceholder");
  }
  if (targetScope.value === "session") {
    return t("onlineEvals.job.detail.manualSessionIdPlaceholder");
  }
  return t("onlineEvals.job.detail.manualSpanIdPlaceholder");
});

function resetManualForm() {
  manualEvalForm.reset(manualEvalDefaults());
}

async function submitManualEval(value: ManualEvalForm) {
  const targetId = value.targetId.trim();
  try {
    const variables = value.variablesJson.trim()
      ? JSON.parse(value.variablesJson)
      : {};
    const payload = {
      targetId,
      spanId:
        targetScope.value === "span" ? value.spanId.trim() || targetId : null,
      traceId:
        targetScope.value === "trace"
          ? value.traceId.trim() || targetId
          : value.traceId.trim() || null,
      sessionId:
        targetScope.value === "session"
          ? value.sessionId.trim() || targetId
          : value.sessionId.trim() || null,
      variables,
      reason: value.reason.trim() || null,
    };
    const result = await onlineEvalsService.jobs.manualEval(
      orgId.value,
      String(props.row.id),
      payload,
    );
    toast({
      variant: "success",
      message: t("onlineEvals.job.detail.manualSuccess", {
        count: result.tasksCreated,
      }),
    });
    resetManualForm();
    await refreshRunsData();
  } catch (err: any) {
    showError(err, t("onlineEvals.job.detail.manualError"));
  }
}

watch(() => props.row.id, resetManualForm);

const normalizedFilter = computed(() => {
  const raw = valueOf<any>(props.row, "filterCondition", "filter_condition");
  return normalizeJobFilterCondition(raw);
});

const filterCondition = computed(() => normalizedFilter.value);

// Render the filter with the SAME formatter the alert UI uses, so a job's
// filter reads identically to an alert condition: a single inline expression
// with lowercase operators and nested groups in parentheses (no custom
// per-level layout). The job's `filter_condition` is the same V2 group
// structure alerts use, so it feeds straight into `buildConditionsString`.
const filterText = computed<string>(() => {
  const cond = filterCondition.value;
  if (!cond) return "";
  const body = buildConditionsString(cond, {
    sqlMode: false,
    addWherePrefix: false,
    formatValues: false,
  });
  return body ? `if ${body}` : "";
});

const samplingMode = computed(
  () => valueOf<string>(props.row, "samplingMode", "sampling_mode") ?? "all",
);

const samplingValue = computed(() =>
  valueOf<any>(props.row, "samplingValue", "sampling_value"),
);

const samplingModeLabel = computed(() => {
  if (samplingMode.value === "rate")
    return t("onlineEvals.job.detail.samplingRate");
  if (samplingMode.value === "count")
    return t("onlineEvals.job.detail.samplingCount");
  return t("onlineEvals.job.detail.samplingAll");
});

interface ResolvedScorer {
  id: string;
  name: string;
  version: number;
  scoreConfigName: string;
  scoreConfigDataType: string;
  scoreConfigRangeText: string;
  scorerType: "llm_judge" | "remote" | "unknown";
  scorerTypeLabel: string;
}

function describeScoreConfig(cfg: ScoreConfig | null): {
  dataType: string;
  rangeText: string;
} {
  if (!cfg) return { dataType: "", rangeText: "" };
  const dataType = String(valueOf<string>(cfg, "dataType", "data_type") ?? "");
  if (dataType === "numeric") {
    const range: any = valueOf<any>(cfg, "numericRange", "numeric_range") ?? {};
    if (range && range.min != null && range.max != null) {
      return { dataType, rangeText: `${range.min}–${range.max}` };
    }
    return { dataType, rangeText: "" };
  }
  if (dataType === "categorical") {
    const cats: string[] = Array.isArray((cfg as any).categories)
      ? (cfg as any).categories
      : [];
    const text =
      cats.length > 0
        ? cats.length <= 3
          ? cats.join(" · ")
          : `${cats.slice(0, 3).join(" · ")} +${cats.length - 3}`
        : "";
    return { dataType, rangeText: text };
  }
  if (dataType === "boolean") {
    return { dataType, rangeText: "true / false" };
  }
  return { dataType, rangeText: "" };
}

const resolvedScorers = computed<ResolvedScorer[]>(() => {
  if (!Array.isArray(props.row.scorers)) return [];
  return props.row.scorers.map((ref): ResolvedScorer => {
    const refId = typeof ref === "string" ? ref : (ref?.id ?? "");
    const refVersion = typeof ref === "object" ? (ref?.version ?? null) : null;
    const found = props.scorers.find((s) => entityId(s) === refId);
    if (!found) {
      return {
        id: refId,
        name: refId || t("onlineEvals.job.detail.scorerUnknown"),
        version: refVersion ?? 0,
        scoreConfigName: "",
        scoreConfigDataType: "",
        scoreConfigRangeText: "",
        scorerType: "unknown",
        scorerTypeLabel: "",
      };
    }
    const cfgId = valueOf<string>(
      found,
      "producesScoreConfigId",
      "produces_score_config_id",
    );
    const cfg = cfgId
      ? (props.scoreConfigs.find((c) => entityId(c) === cfgId) ?? null)
      : null;
    const cfgMeta = describeScoreConfig(cfg);
    const rawType =
      valueOf<string>(found, "scorerType", "scorer_type") ?? "llm_judge";
    const scorerType: ResolvedScorer["scorerType"] =
      rawType === "remote" ? "remote" : "llm_judge";
    return {
      // Use the resolved scorer's stable entity_id so downstream lookups
      // (findScorerById, onScorerClick) consistently match against
      // `entityId(s)`. Using the raw `found.id` here breaks when entity_id
      // differs from id (the common case for versioned rows).
      id: entityId(found),
      name: found.name,
      version: refVersion ?? found.version,
      scoreConfigName: cfg?.name ?? "",
      scoreConfigDataType: cfgMeta.dataType,
      scoreConfigRangeText: cfgMeta.rangeText,
      scorerType,
      scorerTypeLabel:
        scorerType === "remote"
          ? t("onlineEvals.job.detail.scorerTypeRemote")
          : t("onlineEvals.job.detail.scorerTypeLlmJudge"),
    };
  });
});

// `_evaluator.attributes_scorer_id` stores the scorer's stable `entity_id`
// (the cross-version identifier), NOT the per-version row `id`. Match on
// `entityId(s)` so the lookup resolves to the scorer name — matching `s.id`
// fails whenever entity_id differs from id (the common versioned case), which
// left the Runs table showing the raw id instead of the scorer name.
function scorerNameFor(refId: string): string {
  if (!refId) return t("onlineEvals.job.detail.runs.scorerUnknown");
  const found = props.scorers.find((s) => entityId(s) === refId);
  return found?.name ?? refId;
}

// Config-tab scorer cards key off `resolvedScorers[].id`, which is the scorer's
// stable `entity_id` (see resolvedScorers). Match on `entityId(s)` here too —
// matching the per-version row `id` instead leaves the card disabled whenever
// entity_id differs from id (the common case for versioned scorers).
function findScorerById(refId: string): Scorer | null {
  return props.scorers.find((s) => entityId(s) === refId) ?? null;
}

function onScorerClick(refId: string) {
  const scorer = findScorerById(refId);
  if (scorer) emit("view-scorer", scorer);
}

const pipelineId = computed<string>(
  () => valueOf<string>(props.row, "pipelineId", "pipeline_id") ?? "",
);

const createdAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "createdAt", "created_at");
  return typeof v === "number" ? v : null;
});

const updatedAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "updatedAt", "updated_at");
  return typeof v === "number" ? v : null;
});

// — Tabs — no badge counts on Runs / Failures (the KPI strip already shows
// these numbers at the top of every tab in eval job list).
const tabs = computed(() => [
  {
    id: "configuration" as TabId,
    label: t("onlineEvals.job.detail.tabs.configuration"),
  },
  { id: "runs" as TabId, label: t("onlineEvals.job.detail.tabs.runs") },
  { id: "failures" as TabId, label: t("onlineEvals.job.detail.tabs.failures") },
]);

// — Runs / Failures window — backed by DateTimePickerDashboard.
const dateTimePickerRef = ref<{
  getConsumableDateTime: () => { startTime: number; endTime: number };
} | null>(null);
const selectedDate = ref<any>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "24h",
});

const dateWindow = ref<JobRunsWindow>({
  startUs: (Date.now() - 24 * 60 * 60 * 1000) * 1000,
  endUs: Date.now() * 1000,
});
const agents = ref<AgentFilterSelection[]>([]);
const agentKey = ref(ALL_AGENTS_VALUE);

const agentOptions = computed(() => [
  { label: "All Agents", value: ALL_AGENTS_VALUE },
  ...agents.value.map((agent) => ({
    label: agentFilterLabel(agent),
    value: agentFilterKey(agent),
  })),
]);

const selectedAgent = computed<AgentFilterSelection | null>(() => {
  if (agentKey.value === ALL_AGENTS_VALUE) return null;
  return (
    agents.value.find((agent) => agentFilterKey(agent) === agentKey.value) ??
    null
  );
});

async function loadAgents() {
  const { startUs, endUs } = dateWindow.value;
  try {
    const response = await genAiAgentMappingService.listAgents(
      orgId.value,
      startUs,
      endUs,
    );
    agents.value = response.agents;
    if (
      agentKey.value !== ALL_AGENTS_VALUE &&
      !agents.value.some((agent) => agentFilterKey(agent) === agentKey.value)
    ) {
      agentKey.value = ALL_AGENTS_VALUE;
    }
  } catch (err) {
    console.warn("Failed to load GenAI agents", err);
    agents.value = [];
    agentKey.value = ALL_AGENTS_VALUE;
  }
}

function syncDateWindow() {
  const picker = dateTimePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  if (
    dt &&
    typeof dt.startTime === "number" &&
    typeof dt.endTime === "number"
  ) {
    dateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

// The DateTimePicker emits `update:modelValue` on apply; sync the resolved
// window on every change so the queries refire.
watch(selectedDate, () => syncDateWindow(), { deep: true });
watch(
  dateWindow,
  () => {
    void loadAgents();
  },
  { immediate: true },
);
watch(orgId, () => {
  agentKey.value = ALL_AGENTS_VALUE;
  void loadAgents();
});

const tableEnabled = computed(
  () => activeTab.value === "runs" || activeTab.value === "failures",
);
const jobIdRef = computed(() => String(props.row.id ?? ""));

const {
  kpis,
  runs,
  failures,
  isLoadingKpis,
  isLoading: isLoadingRuns,
  refresh: refreshRunsData,
} = useEvalJobRuns(jobIdRef, dateWindow, tableEnabled, selectedAgent);

// Global refresh — re-syncs the shared window then re-queries everything
// (KPI strip + Runs + Failures), since one picker drives the whole view.
async function refreshAll() {
  syncDateWindow();
  await refreshRunsData();
}

// — KPI strip cards —
// value/unit split mirrors the SessionDetails KPI cards (big value + small
// trailing unit) so the AI module's detail pages read identically.
const kpiCards = computed<{ label: string; value: string; unit: string }[]>(
  () => {
    const k = kpis.value;
    return [
      {
        label: t("onlineEvals.job.detail.kpis.totalRuns"),
        value: formatCount(k.totalRuns),
        unit: "",
      },
      {
        label: t("onlineEvals.job.detail.kpis.successRate"),
        value: k.successRate == null ? "—" : k.successRate.toFixed(1),
        unit: k.successRate == null ? "" : "%",
      },
      {
        label: t("onlineEvals.job.detail.kpis.avgLatency"),
        ...splitLatency(k.avgLatencyMs),
      },
      {
        label: t("onlineEvals.job.detail.kpis.scorers"),
        value: String(resolvedScorers.value.length),
        unit: "",
      },
    ];
  },
);

// — OTable column definitions —
const runColumns = computed<OTableColumnDef<JobRunRow>[]>(() => [
  {
    id: "timestampMs",
    header: t("onlineEvals.job.detail.runs.col.time"),
    accessorKey: "timestampMs",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "scorerId",
    header: t("onlineEvals.job.detail.runs.col.scorer"),
    accessorKey: "scorerId",
    sortable: true,
    // Numeric size + `flex`: this column fills the leftover width AND stays
    // resizable. `size: "auto"` is not a valid size — it broke column-width
    // computation (header/body misalignment) and the resize grips.
    size: 220,
    meta: { align: "left", flex: true },
  },
  {
    id: "targetSpanId",
    header: t("onlineEvals.job.detail.runs.col.spanId"),
    accessorKey: "targetSpanId",
    sortable: true,
    size: 190,
    meta: { align: "left" },
  },
  {
    id: "targetTraceId",
    header: t("onlineEvals.job.detail.runs.col.traceId"),
    accessorKey: "targetTraceId",
    sortable: true,
    size: 230,
    meta: { align: "left" },
  },
  {
    id: "scoreDisplay",
    header: t("onlineEvals.job.detail.runs.col.score"),
    accessorKey: "scoreDisplay",
    sortable: false,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "latencyMs",
    header: t("onlineEvals.job.detail.runs.col.latency"),
    accessorKey: "latencyMs",
    sortable: true,
    size: 110,
    // Left-aligned to match the rest of the columns. A sortable header can't
    // right-align (its flex-1 sort wrapper overrides justify-end), so a
    // right-aligned cell would never line up under the header label.
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("onlineEvals.job.detail.runs.col.status"),
    accessorKey: "status",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
]);

// — Helpers —
function formatTimestamp(microsOrMs: number): string {
  const ms = microsOrMs > 1e14 ? Math.round(microsOrMs / 1000) : microsOrMs;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(microsOrMs);
  }
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Split latency into a bare value + trailing unit so the KPI card can render
 * the unit in the smaller, secondary type (matches SessionDetails). */
function splitLatency(ms: number | null): { value: string; unit: string } {
  if (ms == null) return { value: "—", unit: "" };
  if (ms >= 1000) return { value: (ms / 1000).toFixed(1), unit: "s" };
  return { value: String(Math.round(ms)), unit: "ms" };
}

function relativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  if (diff < 0 || !Number.isFinite(diff)) return "—";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
</script>
