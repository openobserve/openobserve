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

<!--
  Queue Workbench — the review surface, opened directly by "Review" (no
  intermediate item-list page). Three regions: a left item navigator (the pool +
  progress), the content pane (the reviewed object), and the scoring pane (one
  control per bound Score Config). Per the Phase-2.5 spec: submit is N/N
  all-or-nothing, items are pending|reviewed only, and reviews are append-only
  (a re-review appends; nothing is overwritten).
-->
<template>
  <OPageLayout
    data-test="ai-queue-workbench-page"
    :title="queue?.name ? raw(queue.name) : t('aiObservability.queues.detail.fallbackTitle')"
    :subtitle="
      t('aiObservability.queues.workbench.subtitle', {
        reviewed: reviewedCount,
        total: items.length,
      })
    "
    :back="backTarget"
    bleed
    :scroll="false"
  >
    <template #actions>
      <template v-if="currentItem">
        <span class="text-text-secondary mr-1 text-sm">
          <i18n-t keypath="aiObservability.queues.workbench.itemCounter" tag="span">
            <template #index>
              <span class="text-text-body font-semibold">{{ currentIndex + 1 }}</span>
            </template>
            <template #total>{{ items.length }}</template>
          </i18n-t>
        </span>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="chevron-left"
          :disabled="currentIndex <= 0"
          :aria-label="t('aiObservability.queues.workbench.prev')"
          data-test="ai-queue-workbench-prev"
          @click="selectItem(currentIndex - 1)"
        />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="chevron-right"
          :disabled="currentIndex >= items.length - 1"
          :aria-label="t('aiObservability.queues.workbench.next')"
          data-test="ai-queue-workbench-next"
          @click="selectItem(currentIndex + 1)"
        />
      </template>
    </template>

    <div class="flex h-full min-h-0" data-test="ai-queue-workbench-body">
      <!-- Item navigator (collapsible) -->
      <aside
        v-if="!navCollapsed"
        class="border-border-default flex w-64 shrink-0 flex-col border-r"
      >
        <div class="border-table-row-divider flex flex-col gap-1.5 border-b px-3 py-2.5">
          <div class="flex items-center justify-between gap-2 text-xs tabular-nums">
            <span class="text-text-secondary">
              {{
                t("aiObservability.queues.reviewedCount", {
                  reviewed: reviewedCount,
                  total: items.length,
                })
              }}
            </span>
            <span
              :class="
                cleared ? 'text-status-success-text font-semibold' : 'text-text-body font-semibold'
              "
            >
              {{ percent }}%
            </span>
          </div>
          <OProgressBar :value="fraction" :variant="cleared ? 'success' : 'default'" size="sm" />
        </div>
        <OTabs
          :model-value="String(currentIndex)"
          orientation="vertical"
          dense
          class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
          data-test="ai-queue-workbench-nav"
        >
          <OTab
            v-for="(item, i) in items"
            :key="item.id"
            :name="String(i)"
            class="min-h-6"
            :data-test="`ai-queue-workbench-nav-item-${i}`"
            @click="selectItem(i)"
          >
            <div class="flex w-full min-w-0 items-center gap-1.5 text-xs">
              <OIcon
                :name="item.status === 'reviewed' ? 'check-circle' : 'fiber-manual-record'"
                size="sm"
                class="shrink-0"
                :class="
                  item.status === 'reviewed' ? 'text-status-success-text' : 'text-text-disabled'
                "
              />
              <span class="min-w-0 flex-1 truncate text-left font-mono">{{ item.refId }}</span>
            </div>
          </OTab>
        </OTabs>
      </aside>

      <!-- Review pane -->
      <section class="flex min-w-0 flex-1 flex-col">
        <div
          v-if="loading || detailLoading"
          class="flex flex-1 items-center justify-center"
          data-test="ai-queue-workbench-loading"
        >
          <OSpinner size="lg" />
        </div>

        <div
          v-else-if="!currentItem"
          class="text-text-secondary flex flex-1 flex-col items-center justify-center gap-2 p-8"
          data-test="ai-queue-workbench-empty"
        >
          <OIcon name="check-circle" class="text-status-success-text h-10 w-10" />
          <span class="text-text-heading text-sm font-semibold">
            {{ t("aiObservability.queues.workbench.allReviewedTitle") }}
          </span>
          <span class="text-center text-xs">
            {{ t("aiObservability.queues.workbench.allReviewedBody") }}
          </span>
        </div>

        <template v-else>
          <div class="flex min-h-0 flex-1">
            <!-- content -->
            <div
              class="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4"
              data-test="ai-queue-workbench-content"
            >
              <!-- item header — refId · workflow · model already name the trace,
                   so "Open full trace" lives here as the row action (no separate
                   lineage strip). -->
              <div class="flex shrink-0 flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <OButton
                    variant="outline"
                    size="icon-chip"
                    class="shrink-0"
                    data-test="ai-queue-workbench-nav-toggle"
                    @click="navCollapsed = !navCollapsed"
                  >
                    <OIcon
                      :name="
                        navCollapsed ? 'keyboard-double-arrow-right' : 'keyboard-double-arrow-left'
                      "
                      size="sm"
                    />
                    <OTooltip
                      :content="
                        navCollapsed
                          ? t('aiObservability.queues.workbench.expandNav')
                          : t('aiObservability.queues.workbench.collapseNav')
                      "
                      side="bottom"
                    />
                  </OButton>
                  <OTag variant="blue-soft" shape="rounded" class="shrink-0">{{
                    currentItem.refType
                  }}</OTag>
                  <h2 class="text-text-heading min-w-0 flex-1 truncate text-lg font-semibold">
                    {{ itemTitle }}
                  </h2>
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="open-in-new"
                    class="shrink-0"
                    :disabled="!currentDetail"
                    data-test="ai-queue-workbench-open-trace"
                    @click="openTrace"
                  >
                    {{ t("aiObservability.queues.workbench.openTrace") }}
                  </OButton>
                </div>
                <div
                  class="text-text-secondary flex flex-wrap items-center gap-x-2 font-mono text-xs"
                >
                  <span class="truncate">{{ currentItem.refId }}</span>
                  <span>·</span><span>{{ currentCase.workflow }}</span> <span>·</span
                  ><span>{{ currentCase.model }}</span>
                </div>
              </div>

              <!-- System scores — how the automated evaluators graded this item,
                   surfaced up front for reference. Compact chips that wrap and
                   scroll, so any number of scores stays contained. -->
              <div
                v-if="currentCase.machineScores.length"
                class="flex shrink-0 flex-col gap-1.5"
                data-test="ai-queue-workbench-system-scores"
              >
                <span class="inline-flex items-center gap-2">
                  <span class="text-text-heading text-sm font-bold">
                    {{ t("aiObservability.queues.workbench.systemScores") }}
                  </span>
                  <span class="text-text-disabled text-sm font-normal">
                    ({{ currentCase.machineScores.length }})
                  </span>
                  <span class="text-text-secondary text-2xs">
                    {{ t("aiObservability.queues.workbench.systemScoresHint") }}
                  </span>
                </span>
                <div class="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
                  <span
                    v-for="ms in currentCase.machineScores"
                    :key="ms.name"
                    class="border-border-default bg-surface-subtle rounded-default flex shrink-0 items-center gap-1.5 border px-2 py-1"
                  >
                    <span class="text-text-secondary text-2xs font-mono">{{ ms.name }}</span>
                    <span class="font-mono text-xs font-semibold">{{ ms.value }}</span>
                    <OTooltip side="bottom" :content="ms.source" />
                  </span>
                </div>
              </div>

              <!-- Input / Output side-by-side (like the TraceDetailsSidebar
                   preview), filling the remaining height with internal scroll.
                   Retrieved Context is full-width below. Fullscreen is taken on
                   THIS container, so it keeps both halves of the evidence. -->
              <div
                ref="ioContainer"
                class="[&:fullscreen]:bg-surface-base flex min-h-0 min-w-0 flex-1 flex-col gap-4 md:flex-row md:gap-3 [&:fullscreen]:p-4"
                data-test="ai-queue-workbench-io"
              >
                <ReviewContentBox
                  class="min-w-0 md:flex-1"
                  fill
                  :label="t('aiObservability.queues.workbench.input')"
                  :content="currentCase.input"
                  content-type="input"
                  :instance-id="`${currentItem.id}-input`"
                  :fullscreen="fullscreenEl === ioContainer"
                  @toggle-fullscreen="toggleFullscreen(ioContainer)"
                />
                <ReviewContentBox
                  class="min-w-0 md:flex-1"
                  fill
                  :label="t('aiObservability.queues.workbench.output')"
                  :content="currentCase.output"
                  content-type="output"
                  :instance-id="`${currentItem.id}-output`"
                  :fullscreen="fullscreenEl === ioContainer"
                  @toggle-fullscreen="toggleFullscreen(ioContainer)"
                />
              </div>
              <div
                v-if="currentCase.retrievedContext"
                ref="contextContainer"
                class="[&:fullscreen]:bg-surface-base flex shrink-0 flex-col gap-1.5 [&:fullscreen]:p-4"
              >
                <button
                  type="button"
                  class="text-text-secondary hover:text-text-heading flex w-fit items-center gap-1 text-xs"
                  data-test="ai-queue-workbench-context-toggle"
                  @click="contextExpanded = !contextExpanded"
                >
                  <OIcon :name="contextExpanded ? 'expand-more' : 'chevron-right'" size="sm" />
                  {{
                    contextExpanded
                      ? t("aiObservability.queues.workbench.hideContext")
                      : t("aiObservability.queues.workbench.showContext")
                  }}
                </button>
                <ReviewContentBox
                  v-if="contextExpanded"
                  :label="t('aiObservability.queues.workbench.retrievedContext')"
                  :content="currentCase.retrievedContext"
                  content-type="input"
                  :instance-id="`${currentItem.id}-context`"
                  :fullscreen="fullscreenEl === contextContainer"
                  @toggle-fullscreen="toggleFullscreen(contextContainer)"
                />
              </div>
            </div>

            <!-- scoring — on a distinct elevated surface so it reads as THE work
                 panel (the reviewer's eye should land here). -->
            <aside
              class="border-border-default bg-surface-subtle flex w-96 shrink-0 flex-col border-l"
              data-test="ai-queue-workbench-scoring"
            >
              <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <div class="mb-4 flex flex-col gap-1">
                  <span class="inline-flex items-center gap-2">
                    <span class="text-text-heading text-base font-semibold">
                      {{ t("aiObservability.queues.workbench.scoreTitle") }}
                    </span>
                    <span class="text-text-secondary text-xs">
                      {{
                        t("aiObservability.queues.workbench.dimensionsBound", {
                          count: boundConfigs.length,
                        })
                      }}
                    </span>
                  </span>
                  <span class="text-text-secondary text-2xs">
                    {{ t("aiObservability.queues.workbench.appendOnlyNote") }}
                  </span>
                </div>
                <div class="flex flex-col gap-4">
                  <div
                    v-for="cfg in boundConfigs"
                    :key="cfg.scoreConfigId"
                    class="bg-surface-panel border-border-default rounded-surface flex flex-col gap-2.5 border p-3"
                    :data-test="`ai-queue-workbench-score-${cfg.scoreConfigId}`"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span
                        class="o-input-label text-compact text-input-label-text leading-tight font-medium"
                      >
                        {{ cfg.name }}
                      </span>
                      <OIcon
                        v-if="draft[cfg.scoreConfigId] !== undefined"
                        name="check-circle"
                        size="sm"
                        class="text-status-success-text shrink-0"
                        :data-test="`ai-queue-workbench-scored-${cfg.scoreConfigId}`"
                      />
                    </div>

                    <!-- numeric → slider -->
                    <div v-if="cfg.dataType === 'numeric'" class="flex flex-col gap-1">
                      <div class="flex items-center gap-3">
                        <OSlider
                          :model-value="numericValue(cfg)"
                          :min="cfg.min"
                          :max="cfg.max"
                          :step="cfg.step"
                          class="min-w-0 flex-1"
                          :data-test="`ai-queue-workbench-slider-${cfg.scoreConfigId}`"
                          @update:model-value="(v: number) => setDraftValue(cfg.scoreConfigId, v)"
                        />
                        <span
                          class="shrink-0 text-right tabular-nums"
                          :class="
                            draft[cfg.scoreConfigId] === undefined
                              ? 'text-text-disabled text-2xs'
                              : 'text-text-body text-sm font-semibold'
                          "
                        >
                          {{
                            draft[cfg.scoreConfigId] === undefined
                              ? t("aiObservability.queues.workbench.notScored")
                              : Number(draft[cfg.scoreConfigId]).toFixed(2)
                          }}
                        </span>
                      </div>
                      <span class="text-text-secondary text-2xs">
                        {{ cfg.min }} – {{ cfg.max }}
                        <template v-if="cfg.healthyValue !== undefined">
                          · {{ cfg.healthyDirection === "lte" ? "≤" : "≥" }}
                          {{ cfg.healthyValue }}
                        </template>
                      </span>
                    </div>

                    <!-- categorical → radios -->
                    <ORadioGroup
                      v-else-if="cfg.dataType === 'categorical'"
                      :model-value="(draft[cfg.scoreConfigId] as string) ?? ''"
                      orientation="horizontal"
                      @update:model-value="
                        (v: unknown) => setDraftValue(cfg.scoreConfigId, String(v))
                      "
                    >
                      <ORadio
                        v-for="c in cfg.categories || []"
                        :key="c"
                        :value="c"
                        :label="raw(c)"
                      />
                    </ORadioGroup>

                    <!-- boolean → radios -->
                    <ORadioGroup
                      v-else
                      :model-value="(draft[cfg.scoreConfigId] as string) ?? ''"
                      orientation="horizontal"
                      @update:model-value="
                        (v: unknown) => setDraftValue(cfg.scoreConfigId, String(v))
                      "
                    >
                      <ORadio value="true" :label="t('aiObservability.queues.workbench.true')" />
                      <ORadio value="false" :label="t('aiObservability.queues.workbench.false')" />
                    </ORadioGroup>
                  </div>

                  <!-- Comment (optional) -->
                  <div class="flex flex-col gap-1.5">
                    <span class="inline-flex items-center gap-1">
                      <span
                        class="o-input-label text-compact text-input-label-text leading-tight font-medium"
                      >
                        {{ t("aiObservability.queues.workbench.commentLabel") }}
                      </span>
                      <span class="text-text-secondary text-2xs font-normal">{{
                        t("common.optional")
                      }}</span>
                    </span>
                    <OTextarea
                      v-model="comment"
                      :placeholder="t('aiObservability.queues.workbench.commentPlaceholder')"
                      :rows="3"
                      data-test="ai-queue-workbench-comment"
                      @update:model-value="currentSubmissionId = null"
                    />
                  </div>

                  <!-- Other reviewers' scores — collapsed by default so the
                       reviewer forms their own view first (peer scores anchor).
                       The system's automated scores live above Input/Output. -->
                  <div
                    v-if="currentCase.priorAnnotations.length"
                    class="flex flex-col gap-2"
                    data-test="ai-queue-workbench-prior"
                  >
                    <button
                      type="button"
                      class="text-text-secondary hover:text-text-heading flex items-center gap-1 text-xs font-semibold"
                      data-test="ai-queue-workbench-prior-toggle"
                      @click="priorExpanded = !priorExpanded"
                    >
                      <OIcon :name="priorExpanded ? 'expand-more' : 'chevron-right'" size="sm" />
                      {{ t("aiObservability.queues.workbench.priorScores") }}
                      <span class="text-text-disabled font-normal"
                        >({{ currentCase.priorAnnotations.length }})</span
                      >
                    </button>
                    <span v-if="!priorExpanded" class="text-text-secondary text-2xs pl-5">
                      {{ t("aiObservability.queues.workbench.priorScoresHint") }}
                    </span>

                    <div
                      v-for="(a, ai) in currentCase.priorAnnotations"
                      v-show="priorExpanded"
                      :key="ai"
                      class="border-border-default bg-surface-base rounded-surface flex flex-col gap-1.5 border px-3 py-2.5"
                    >
                      <div class="flex items-center gap-2">
                        <span
                          class="bg-primary/15 text-text-body text-2xs flex h-5 w-5 items-center justify-center rounded-full font-bold"
                        >
                          {{ a.initials }}
                        </span>
                        <span class="text-sm font-medium">{{ a.reviewer }}</span>
                        <span class="text-text-secondary text-2xs ml-auto">{{ a.time }}</span>
                      </div>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <OTag
                          v-for="s in a.scores"
                          :key="s.name"
                          variant="default-soft"
                          class="text-2xs font-mono"
                        >
                          {{ s.name }} {{ s.value }}
                        </OTag>
                      </div>
                      <span class="text-text-secondary text-xs italic">
                        {{ quoted(a.comment) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="border-table-row-divider bg-surface-panel flex flex-col gap-2 border-t px-4 py-3"
              >
                <span
                  class="text-text-secondary text-2xs"
                  data-test="ai-queue-workbench-scored-count"
                >
                  {{
                    t("aiObservability.queues.workbench.dimensionsScored", {
                      scored: scoredCount,
                      total: boundConfigs.length,
                    })
                  }}
                </span>
                <OProgressBar
                  :value="boundConfigs.length ? scoredCount / boundConfigs.length : 0"
                  :variant="scoredCount === boundConfigs.length ? 'success' : 'default'"
                  size="sm"
                />
                <!-- Distill to dataset — the second destination for a human
                     judgment (the first being the score itself). Only a REVIEWED
                     trace/span item can be distilled; the API refuses the rest. -->
                <div
                  class="border-border-default flex items-center gap-2 border-t pt-2"
                  data-test="ai-queue-workbench-distill"
                >
                  <OIcon name="table-chart" size="sm" class="text-text-secondary" />
                  <span class="text-text-body text-xs font-semibold">
                    {{ t("aiObservability.queues.workbench.distill.title") }}
                  </span>
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-right="arrow-forward"
                    class="ml-auto"
                    :disabled="!canDistill"
                    data-test="ai-queue-workbench-distill-btn"
                    @click="openDistill"
                  >
                    {{ t("aiObservability.queues.workbench.distill.action") }}
                    <OTooltip
                      v-if="distillBlockedReason"
                      side="top"
                      :content="distillBlockedReason"
                    />
                  </OButton>
                </div>

                <div class="flex items-center gap-2">
                  <OButton
                    variant="outline"
                    size="sm"
                    class="flex-1"
                    data-test="ai-queue-workbench-skip"
                    @click="skip"
                  >
                    {{ t("aiObservability.queues.workbench.skip") }}
                  </OButton>
                  <OButton
                    variant="primary"
                    size="sm"
                    icon-right="arrow-forward"
                    class="flex-1"
                    :disabled="!canSubmit || submitting"
                    :loading="submitting"
                    data-test="ai-queue-workbench-submit"
                    @click="submit"
                  >
                    {{ t("aiObservability.queues.workbench.submit") }}
                  </OButton>
                </div>
              </div>
            </aside>
          </div>
        </template>
      </section>
    </div>

    <!-- Distill drawer — the golden answer is always typed by a human; the
         server hydrates the input from the item's trace reference. -->
    <ODrawer
      v-model:open="distillOpen"
      side="right"
      size="lg"
      :title="t('aiObservability.queues.workbench.distill.title')"
      :primary-button-label="t('aiObservability.queues.workbench.distill.confirm')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-disabled="!canConfirmDistill"
      :primary-button-loading="distilling"
      data-test="ai-queue-workbench-distill-drawer"
      @click:primary="confirmDistill"
      @click:secondary="distillOpen = false"
    >
      <div class="flex flex-col gap-4">
        <span class="text-text-secondary text-xs">
          {{ t("aiObservability.queues.workbench.distill.hint") }}
        </span>

        <div class="flex flex-col gap-1.5">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.queues.workbench.distill.datasetLabel") }}
          </span>
          <OSelect
            :model-value="distillDatasetId"
            :options="datasetOptions"
            label-key="label"
            value-key="value"
            :loading="datasetsLoading"
            :placeholder="t('aiObservability.queues.workbench.distill.datasetPlaceholder')"
            class="w-full"
            data-test="ai-queue-workbench-distill-dataset"
            @update:model-value="(v: unknown) => (distillDatasetId = v ? String(v) : '')"
          />
          <span
            v-if="!datasetsLoading && !datasetOptions.length"
            class="text-text-secondary text-2xs"
          >
            {{ t("aiObservability.queues.workbench.distill.noDatasets") }}
          </span>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.queues.workbench.distill.expectedLabel") }}
          </span>
          <OTextarea
            v-model="distillExpected"
            :placeholder="t('aiObservability.queues.workbench.distill.expectedPlaceholder')"
            :rows="6"
            data-test="ai-queue-workbench-distill-expected"
          />
          <OButton
            v-if="currentCase.output"
            variant="ghost"
            size="sm"
            class="self-start"
            data-test="ai-queue-workbench-distill-use-output"
            @click="distillExpected = currentCase.output"
          >
            {{ t("aiObservability.queues.workbench.distill.useOutput") }}
          </OButton>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="inline-flex items-center gap-1">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.datasets.create.tagsLabel") }}
            </span>
            <span class="text-text-secondary text-2xs font-normal">
              {{ t("common.optional") }}
            </span>
          </span>
          <OTagInput
            v-model="distillTags"
            :placeholder="t('aiObservability.datasets.create.tagsPlaceholder')"
            data-test="ai-queue-workbench-distill-tags"
          />
        </div>
      </div>
    </ODrawer>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { formatDistanceToNowStrict } from "date-fns";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ReviewContentBox from "./ReviewContentBox.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmQueuesService, {
  type LlmQueue,
  type LlmQueueItem,
  type LlmQueueItemDetail,
  type LlmQueueReview,
  type LlmScoreConfigOption,
  type ScoreConfigDataType,
} from "@/services/llm-queues.service";
import llmDatasetsService from "@/services/llm-datasets.service";
import { toggleFullscreen as domToggleFullscreen } from "@/utils/dom";

defineOptions({ name: "AIQueueWorkbenchPage" });

const { t } = useI18nTyped();

/** Quote marks around a reviewer's comment are typography around server text,
 *  not copy of our own. */
const quoted = (comment: string) => raw(`“${comment}”`);
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const queueId = computed<string>(() => String(route.params.id ?? ""));

const queue = ref<LlmQueue | null>(null);

// Back is the queue this Workbench reviews, not the queue list — the Workbench
// is a mode of that queue.
// Back returns to wherever review was started from. Reviewing straight off the
// Queues list skips the detail page, so sending them "back" to a page they never
// opened would be a detour. Anything else (including a deep link) falls back to
// the queue detail, which is the natural parent.
const cameFromList = computed(() => route.query.from === "queues");

const backTarget = computed(() =>
  cameFromList.value
    ? {
        label: t("aiObservability.nav.queues"),
        to: { name: "aiQueues", query: { org_identifier: orgId.value } },
      }
    : {
        label: queue.value?.name
          ? raw(queue.value.name)
          : t("aiObservability.queues.detail.fallbackTitle"),
        to: {
          name: "aiQueueDetail",
          params: { id: queueId.value },
          query: { org_identifier: orgId.value },
        },
      },
);
const items = ref<LlmQueueItem[]>([]);
const configOptions = ref<LlmScoreConfigOption[]>([]);
const currentDetail = ref<LlmQueueItemDetail | null>(null);
const currentReviews = ref<LlmQueueReview[]>([]);
const loading = ref(false);
const detailLoading = ref(false);
const submitting = ref(false);
const currentIndex = ref(-1);
const navCollapsed = ref(false);
const priorExpanded = ref(false);
const contextExpanded = ref(false);
const currentSubmissionId = ref<string | null>(null);

// Fullscreen is taken on a CONTAINER, not on a single box — the reviewer needs
// Input and Output together. One tracker for whichever element the browser has.
const ioContainer = ref<HTMLElement | null>(null);
const contextContainer = ref<HTMLElement | null>(null);
const fullscreenEl = ref<Element | null>(null);

function toggleFullscreen(element: HTMLElement | null) {
  if (!element) return;
  void domToggleFullscreen(element).catch(() => {
    toast({ variant: "error", message: t("aiObservability.queues.workbench.fullscreenError") });
  });
}

function syncFullscreen() {
  fullscreenEl.value = document.fullscreenElement;
}

type ScoreValue = number | string;
const draft = reactive<Record<string, ScoreValue | undefined>>({});
const comment = ref("");

const currentItem = computed<LlmQueueItem | null>(() => items.value[currentIndex.value] ?? null);
const reviewedCount = computed(
  () => items.value.filter((item) => item.status === "reviewed").length,
);
const fraction = computed(() =>
  items.value.length ? reviewedCount.value / items.value.length : 0,
);
const percent = computed(() => Math.round(fraction.value * 100));
const cleared = computed(() => items.value.length > 0 && reviewedCount.value >= items.value.length);

interface BoundScoreConfig {
  rowId: string;
  scoreConfigId: string;
  name: string;
  dataType: ScoreConfigDataType;
  categories?: string[];
  min: number;
  max: number;
  step: number;
  healthyDirection?: "gte" | "lte";
  healthyValue?: number;
}

const boundConfigs = computed<BoundScoreConfig[]>(() =>
  (queue.value?.scoreConfigs ?? []).map((binding) => {
    const option = configOptions.value.find((candidate) => candidate.id === binding.scoreConfigId);
    const version = option?.versionDetails[binding.version];
    const min = version?.numericRange?.min ?? 0;
    const max = version?.numericRange?.max ?? 1;
    const threshold = version?.healthyThreshold;
    const healthyDirection =
      threshold?.direction === "gte" || threshold?.direction === "lte"
        ? threshold.direction
        : undefined;
    const healthyValue = Number(threshold?.value);
    return {
      rowId: binding.rowId,
      scoreConfigId: binding.scoreConfigId,
      name: binding.name,
      dataType: binding.dataType ?? option?.dataType ?? "numeric",
      categories: version?.categories ?? option?.categories,
      min,
      max,
      step: (max - min) / 20,
      healthyDirection,
      healthyValue: Number.isFinite(healthyValue) ? healthyValue : undefined,
    };
  }),
);

const canSubmit = computed(
  () =>
    Boolean(currentDetail.value?.sourceStream) &&
    boundConfigs.value.length > 0 &&
    boundConfigs.value.every(
      (config) => Boolean(config.rowId) && draft[config.scoreConfigId] !== undefined,
    ),
);

const scoredCount = computed(
  () => boundConfigs.value.filter((config) => draft[config.scoreConfigId] !== undefined).length,
);

function setDraftValue(id: string, value: ScoreValue) {
  draft[id] = value;
  currentSubmissionId.value = null;
}

function numericValue(config: BoundScoreConfig): number {
  const value = draft[config.scoreConfigId];
  return typeof value === "number" ? value : config.min + (config.max - config.min) / 2;
}

function formatContent(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function valueAt(row: Record<string, unknown>, path: string): unknown {
  if (path in row) return row[path];
  let current: unknown = row;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function firstTraceValue(paths: string[]): unknown {
  for (const row of currentDetail.value?.content.trace ?? []) {
    for (const path of paths) {
      const value = valueAt(row, path);
      if (value !== null && value !== undefined && String(value).trim()) return value;
    }
  }
  return undefined;
}

function retrievedContext(): string {
  const outputPaths = [
    "gen_ai_output_messages",
    "gen_ai.output.messages",
    "llm.output",
    "_o2_llm_output",
    "llm_output",
  ];
  const retrievalRow = (currentDetail.value?.content.trace ?? []).find((row) => {
    const operation =
      valueAt(row, "gen_ai_operation_name") ??
      valueAt(row, "gen_ai.operation.name") ??
      valueAt(row, "operation_name");
    return typeof operation === "string" && /retriev|search|rag/i.test(operation);
  });
  if (!retrievalRow) return "";
  for (const path of outputPaths) {
    const value = valueAt(retrievalRow, path);
    if (value !== null && value !== undefined) return formatContent(value);
  }
  return "";
}

function displayScoreValue(value: number | string | boolean | null): string {
  if (value === null) return "—";
  return typeof value === "number" ? String(Number(value.toFixed(4))) : String(value);
}

function reviewerInitials(reviewer: string): string {
  const name = reviewer.split("@")[0];
  const parts = name.split(/[._\-\s]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

function relativeReviewTime(timestampMicros: number): string {
  if (!timestampMicros) return "";
  return formatDistanceToNowStrict(new Date(timestampMicros / 1_000), { addSuffix: true });
}

const currentCase = computed(() => ({
  model: String(
    firstTraceValue([
      "gen_ai_request_model",
      "gen_ai.request.model",
      "gen_ai_response_model",
      "gen_ai.response.model",
    ]) ?? "",
  ),
  workflow: String(
    firstTraceValue(["gen_ai_agent_name", "gen_ai.agent.name", "service_name", "operation_name"]) ??
      "",
  ),
  input: formatContent(currentDetail.value?.content.input),
  output: formatContent(currentDetail.value?.content.output),
  retrievedContext: retrievedContext(),
  machineScores: (currentDetail.value?.machineScores ?? []).map((score) => ({
    name: score.name,
    value: displayScoreValue(score.value),
    source: raw(score.sourceType.replaceAll("_", " ")),
  })),
  priorAnnotations: currentReviews.value.map((review) => {
    const reviewer = review.reviewer || "Unknown reviewer";
    return {
      reviewer,
      initials: reviewerInitials(reviewer),
      time: relativeReviewTime(review.submittedAt),
      scores: review.scores.map((score) => ({
        name: score.name,
        value: displayScoreValue(score.value),
      })),
      comment: review.comments ?? "",
    };
  }),
}));

const itemTitle = computed(() => {
  const preview = currentCase.value.input.replace(/\s+/g, " ").trim();
  if (preview) return preview.length > 72 ? `${preview.slice(0, 72).trimEnd()}…` : preview;
  return currentCase.value.workflow || currentItem.value?.refId || "";
});

function resetDraft() {
  for (const key of Object.keys(draft)) delete draft[key];
  comment.value = "";
  currentSubmissionId.value = null;
  priorExpanded.value = false;
  contextExpanded.value = false;
}

let detailRequest = 0;
async function loadCurrentItem() {
  const item = currentItem.value;
  const request = ++detailRequest;
  currentDetail.value = null;
  currentReviews.value = [];
  if (!item) return;

  detailLoading.value = true;
  try {
    const detail = await llmQueuesService.getItemDetail(orgId.value, queueId.value, item.id);
    if (request !== detailRequest) return;
    currentDetail.value = detail;
    currentReviews.value = detail.reviews;
  } catch {
    if (request !== detailRequest) return;
    toast({ variant: "error", message: t("aiObservability.queues.detail.loadError") });
  } finally {
    if (request === detailRequest) detailLoading.value = false;
  }
}

function selectItem(index: number) {
  if (index < 0 || index >= items.value.length) return;
  currentIndex.value = index;
  resetDraft();
  void loadCurrentItem();
}

function firstPendingIndex(): number {
  return items.value.findIndex((item) => item.status === "pending");
}

// `?item=` comes from the queue detail table: open the row that was clicked,
// including an already-reviewed one, and fall back to the first pending item.
function initialIndex(): number {
  const requested = String(route.query.item ?? "");
  const index = requested ? items.value.findIndex((item) => item.id === requested) : -1;
  return index === -1 ? firstPendingIndex() : index;
}

function advance() {
  const next = items.value.findIndex(
    (item, index) => index > currentIndex.value && item.status === "pending",
  );
  const wrapped = next === -1 ? firstPendingIndex() : next;
  if (wrapped === -1) {
    currentIndex.value = -1;
    currentDetail.value = null;
    currentReviews.value = [];
    resetDraft();
    return;
  }
  selectItem(wrapped);
}

function skip() {
  advance();
}

function generateSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submit() {
  const item = currentItem.value;
  const detail = currentDetail.value;
  if (!canSubmit.value || !item || !detail || submitting.value) return;

  const submissionId = currentSubmissionId.value ?? generateSubmissionId();
  currentSubmissionId.value = submissionId;
  submitting.value = true;
  try {
    await llmQueuesService.submitReview(orgId.value, queueId.value, item.id, {
      submissionId,
      sourceStream: detail.sourceStream,
      scores: boundConfigs.value.map((config) => {
        const value = draft[config.scoreConfigId];
        return {
          scoreConfigRowId: config.rowId,
          value:
            config.dataType === "boolean"
              ? value === "true"
              : config.dataType === "numeric"
                ? Number(value)
                : String(value),
        };
      }),
      comments: comment.value.trim() || null,
    });
    item.status = "reviewed";
    item.reviewedAt = Date.now();
    currentSubmissionId.value = null;
    toast({ variant: "success", message: t("aiObservability.queues.workbench.submitted") });
    advance();
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.workbench.submitError") });
  } finally {
    submitting.value = false;
  }
}

// ── Distill to dataset ──
// The API only accepts a REVIEWED, un-archived trace/span item, and it needs the
// review submission that serves as adjudication evidence — so the gate here
// mirrors those preconditions exactly rather than guessing.
const distillOpen = ref(false);
const distilling = ref(false);
const distillDatasetId = ref("");
const distillExpected = ref("");
const distillTags = ref<string[]>([]);
const datasets = ref<{ id: string; name: string }[]>([]);
const datasetsLoading = ref(false);

const datasetOptions = computed(() =>
  datasets.value.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

/** The submission the golden is attributed to — the most recent one on this item. */
const adjudicationSubmissionId = computed(
  () => currentReviews.value[currentReviews.value.length - 1]?.submissionId ?? "",
);

const distillBlockedReason = computed(() => {
  const item = currentItem.value;
  if (!item) return "";
  if (item.refType === "session")
    return t("aiObservability.queues.workbench.distill.sessionUnsupported");
  if (item.status !== "reviewed" || !adjudicationSubmissionId.value)
    return t("aiObservability.queues.workbench.distill.needsReview");
  return "";
});

const canDistill = computed(() => Boolean(currentItem.value) && !distillBlockedReason.value);

const canConfirmDistill = computed(
  () => Boolean(distillDatasetId.value) && distillExpected.value.trim().length > 0,
);

async function loadDatasets() {
  if (datasets.value.length || datasetsLoading.value || !orgId.value) return;
  datasetsLoading.value = true;
  try {
    datasets.value = await llmDatasetsService.list(orgId.value);
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.workbench.distill.loadError") });
  } finally {
    datasetsLoading.value = false;
  }
}

async function openDistill() {
  if (!canDistill.value) return;
  distillExpected.value = "";
  distillTags.value = [];
  // The queue's target dataset is the default destination when it has one.
  distillDatasetId.value = queue.value?.targetDatasetId ?? "";
  distillOpen.value = true;
  await loadDatasets();
}

async function confirmDistill() {
  const item = currentItem.value;
  if (!item || !canConfirmDistill.value || distilling.value) return;
  distilling.value = true;
  try {
    const result = await llmQueuesService.pushToDataset(orgId.value, queueId.value, item.id, {
      datasetId: distillDatasetId.value,
      reviewSubmissionId: adjudicationSubmissionId.value,
      expectedOutput: distillExpected.value.trim(),
      tags: distillTags.value,
    });
    const datasetId = distillDatasetId.value;
    distillOpen.value = false;
    toast({
      variant: "success",
      message: result.created
        ? t("aiObservability.queues.workbench.distill.success")
        : t("aiObservability.queues.workbench.distill.updated"),
      action: {
        label: t("aiObservability.queues.workbench.distill.openDataset"),
        handler: () =>
          router.push({
            name: "aiDatasetDetail",
            params: { id: datasetId },
            query: { org_identifier: orgId.value },
          }),
      },
    });
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.workbench.distill.error") });
  } finally {
    distilling.value = false;
  }
}

async function refresh() {
  if (!orgId.value || !queueId.value) return;
  loading.value = true;
  try {
    const [queueRow, queueItems, configs] = await Promise.all([
      llmQueuesService.get(orgId.value, queueId.value),
      llmQueuesService.listItems(orgId.value, queueId.value),
      llmQueuesService.listScoreConfigOptions(orgId.value),
    ]);
    queue.value = queueRow;
    items.value = queueItems;
    configOptions.value = configs;
    currentIndex.value = initialIndex();
    resetDraft();
    await loadCurrentItem();
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.detail.loadError") });
  } finally {
    loading.value = false;
  }
}

function openTrace() {
  const item = currentItem.value;
  const detail = currentDetail.value;
  if (!item || !detail) return;
  const query = {
    stream: detail.sourceStream,
    from: item.refTraceStartTime,
    to: Date.now() * 1_000,
    org_identifier: orgId.value,
  };
  if (item.refType === "session") {
    router.push({ name: "sessionDetails", query: { ...query, session_id: item.refId } });
    return;
  }
  const traceId = item.refType === "span" ? item.refTraceId : item.refId;
  if (traceId) router.push({ name: "traceDetails", query: { ...query, trace_id: traceId } });
}

function onKeydown(event: KeyboardEvent) {
  const element = event.target as HTMLElement | null;
  if (element && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return;
  if (event.key === "ArrowLeft") selectItem(currentIndex.value - 1);
  else if (event.key === "ArrowRight") selectItem(currentIndex.value + 1);
  else if (event.key === "Enter" && canSubmit.value) void submit();
}

onMounted(() => {
  void refresh();
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("fullscreenchange", syncFullscreen);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("fullscreenchange", syncFullscreen);
});
</script>
