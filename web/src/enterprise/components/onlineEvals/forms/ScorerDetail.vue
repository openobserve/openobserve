<template>
  <div class="sd-scrim tw:fixed tw:inset-0 tw:bg-[rgba(0,0,0,0.32)] tw:z-[1010] tw:flex tw:justify-end" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="sd tw:w-[1100px] tw:max-w-[96vw] tw:h-full tw:bg-[var(--color-card-bg)] tw:border-l tw:border-[var(--color-dialog-header-border,var(--o2-border))] tw:flex tw:flex-col" @click.stop data-test="scorer-detail">
      <!-- ── Header ── -->
      <header class="tw:flex tw:items-start tw:gap-2.5 tw:px-5 tw:pt-4 tw:pb-3.5 tw:border-b tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0">
        <div class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
            <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.02em] tw:text-text-secondary">{{ t("onlineEvals.scorer.detail.eyebrow") }}</span>
            <span
              v-if="row.name"
              :class="[
                'tw:font-semibold tw:px-2 tw:py-1 tw:rounded-md tw:inline-block',
                store.state.theme === 'dark'
                  ? 'tw:text-blue-400 tw:bg-blue-900/50'
                  : 'tw:text-blue-600 tw:bg-blue-50',
              ]"
            >
              {{ row.name }}
              <OTooltip
                v-if="row.name && row.name.length > 35"
                :content="row.name"
                side="top"
              />
            </span>
          </div>
          <div v-if="row.description" class="sd__produces-line tw:flex tw:items-center tw:gap-[6px] tw:text-xs tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:flex-wrap">
            <template v-if="producesConfig">
              <span class="sd-mono sd__produces-name tw:text-[var(--color-text-primary,currentColor)] tw:font-semibold">{{ producesConfig.name }}</span>
              <span class="sd__sep tw:opacity-50">·</span>
            </template>
            <span class="sd__produces-desc tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ row.description }}</span>
          </div>
          <div v-else-if="producesConfig" class="sd__produces-line tw:flex tw:items-center tw:gap-[6px] tw:text-xs tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:flex-wrap">
            <span class="sd-mono sd__produces-name tw:text-[var(--color-text-primary,currentColor)] tw:font-semibold">{{ producesConfig.name }}</span>
          </div>
        </div>
        <button
          type="button"
          class="sd__close tw:shrink-0 tw:bg-transparent tw:border-0 tw:p-1 tw:rounded tw:cursor-pointer tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]"
          :aria-label="t('onlineEvals.scorer.detail.close')"
          data-test="scorer-detail-close-btn"
          @click="$emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <!-- ── KPI strip ── -->
      <section class="tw:grid tw:grid-cols-4 tw:gap-3 tw:px-5 tw:py-4 tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_4%,var(--color-card-bg))] tw:border-b tw:border-dialog-header-border tw:shrink-0">
        <article class="sd-kpi tw:flex tw:flex-col tw:gap-[2px] tw:p-[10px_12px] tw:bg-[var(--color-card-bg)] tw:border tw:border-[var(--color-dialog-header-border,var(--o2-border))] tw:rounded-md">
          <span class="sd-kpi__title tw:font-semibold tw:text-xs tw:[letter-spacing:0.01em] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.totalRuns") }}</span>
          <span class="sd-kpi__value tw:font-bold tw:text-[22px] tw:[line-height:1.1] tw:[letter-spacing:-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-[var(--color-text-primary,currentColor)]">{{ formatCount(kpis.totalRuns) }}</span>
          <span class="sd-kpi__sub tw:text-[11px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.totalRunsSub") }}</span>
        </article>
        <article class="sd-kpi tw:flex tw:flex-col tw:gap-[2px] tw:p-[10px_12px] tw:bg-[var(--color-card-bg)] tw:border tw:border-[var(--color-dialog-header-border,var(--o2-border))] tw:rounded-md" :class="successRateTone">
          <span class="sd-kpi__title tw:font-semibold tw:text-xs tw:[letter-spacing:0.01em] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.successRate") }}</span>
          <span class="sd-kpi__value tw:font-bold tw:text-[22px] tw:[line-height:1.1] tw:[letter-spacing:-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-[var(--color-text-primary,currentColor)]">{{ formatPercent(kpis.successRate) }}</span>
          <span class="sd-kpi__sub tw:text-[11px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.successRateSub") }}</span>
        </article>
        <article class="sd-kpi tw:flex tw:flex-col tw:gap-[2px] tw:p-[10px_12px] tw:bg-[var(--color-card-bg)] tw:border tw:border-[var(--color-dialog-header-border,var(--o2-border))] tw:rounded-md">
          <span class="sd-kpi__title tw:font-semibold tw:text-xs tw:[letter-spacing:0.01em] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.avgLatency") }}</span>
          <span class="sd-kpi__value tw:font-bold tw:text-[22px] tw:[line-height:1.1] tw:[letter-spacing:-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-[var(--color-text-primary,currentColor)]">{{ formatLatency(kpis.avgLatencyMs) }}</span>
          <span class="sd-kpi__sub tw:text-[11px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.avgLatencySub") }}</span>
        </article>
        <article class="sd-kpi tw:flex tw:flex-col tw:gap-[2px] tw:p-[10px_12px] tw:bg-[var(--color-card-bg)] tw:border tw:border-[var(--color-dialog-header-border,var(--o2-border))] tw:rounded-md">
          <span class="sd-kpi__title tw:font-semibold tw:text-xs tw:[letter-spacing:0.01em] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.kpis.usedBy") }}</span>
          <span class="sd-kpi__value tw:font-bold tw:text-[22px] tw:[line-height:1.1] tw:[letter-spacing:-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-[var(--color-text-primary,currentColor)]">{{ usedByJobs.length }}</span>
          <span class="sd-kpi__sub tw:text-[11px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">
            {{ usedByJobs.length === 1
              ? t("onlineEvals.scorer.detail.kpis.usedBySubSingular")
              : t("onlineEvals.scorer.detail.kpis.usedBySubPlural") }}
          </span>
        </article>
      </section>

      <!-- ── Tab strip ── -->
      <nav class="tw:flex tw:gap-4.5 tw:px-5 tw:border-b tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="sd__tab tw:inline-flex tw:items-center tw:gap-[6px] tw:py-[10px] tw:px-0 tw:bg-transparent tw:border-0 tw:border-b-2 tw:border-b-transparent tw:cursor-pointer tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:font-semibold tw:text-[13px] tw:mb-[-1px]"
          :class="{ 'sd__tab--active': activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :data-test="`scorer-detail-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.count != null" class="sd__tab-count tw:inline-flex tw:items-center tw:px-[6px] tw:min-w-[18px] tw:h-[16px] tw:rounded-full tw:font-semibold tw:text-[10px] tw:[line-height:1] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:justify-center">{{ tab.count }}</span>
        </button>
      </nav>

      <!-- ── Body ── -->
      <div class="tw:flex-1 tw:overflow-auto tw:px-5 tw:py-4.5 tw:flex tw:flex-col tw:gap-4.5 tw:min-h-0 tw:bg-card-bg">
        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <section class="sd-section tw:flex tw:flex-col tw:gap-2">
            <h4 class="sd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:[line-height:1.5] tw:text-[var(--color-text-primary,currentColor)] tw:pb-[6px] tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-[6px]">{{ t("onlineEvals.scorer.detail.configurationSection") }}</h4>
            <dl class="sd-kv tw:grid tw:[grid-template-columns:120px_1fr] tw:gap-[6px_14px] tw:m-0">
              <dt>{{ t("onlineEvals.scorer.detail.scorerTypeLabel") }}</dt>
              <dd>
                <span class="sd-type-chip tw:inline-flex tw:p-[1px_6px] tw:rounded-[3px] tw:text-[11px] tw:font-semibold tw:bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] tw:text-[#4f5bcf]" :class="`sd-type-chip--${scorerType}`">{{ scorerTypeLabel }}</span>
                <span class="sd-version-chip tw:inline-flex tw:ml-[6px] tw:p-[1px_6px] tw:rounded-[3px] tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:text-[11px] tw:font-semibold tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">v{{ row.version }}</span>
              </dd>

              <template v-if="scorerType === 'llm_judge'">
                <dt>{{ t("onlineEvals.scorer.detail.providerLabel") }}</dt>
                <dd>
                  <span v-if="provider" class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ provider.name }}</span>
                  <span v-else class="sd-muted tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:italic">{{ t("onlineEvals.scorer.detail.providerUnknown") }}</span>
                </dd>

                <template v-if="judgeModel">
                  <dt>{{ t("onlineEvals.scorer.detail.modelLabel") }}</dt>
                  <dd class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ judgeModel }}</dd>
                </template>
              </template>

              <template v-if="scorerType === 'remote' && remoteEndpoint">
                <dt>{{ t("onlineEvals.scorer.detail.endpointLabel") }}</dt>
                <dd class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ remoteEndpoint }}</dd>
              </template>
            </dl>
          </section>

          <section class="sd-section tw:flex tw:flex-col tw:gap-2">
            <h4 class="sd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:[line-height:1.5] tw:text-[var(--color-text-primary,currentColor)] tw:pb-[6px] tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-[6px]">{{ t("onlineEvals.scorer.detail.producesSection") }}</h4>
            <div v-if="producesConfig" class="sd-produces tw:flex tw:items-center tw:gap-[6px] tw:p-[10px_12px] tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_8%,transparent)] tw:border tw:border-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_30%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-[var(--color-text-primary,currentColor)]" data-test="scorer-detail-produces">
              <OIcon name="rule" size="xs" />
              <span class="sd-mono sd-produces__name tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:font-bold">{{ producesConfig.name }}</span>
              <span class="sd-produces__version tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:text-[11px]">v{{ producesConfig.version }}</span>
              <span class="sd-produces__sep tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:text-[11px]">·</span>
              <span class="sd-produces__type tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:text-[11px]">{{ dataTypeOf(producesConfig) }}</span>
            </div>
            <div v-else class="sd-empty tw:inline-flex tw:items-center tw:gap-[6px] tw:p-[8px_10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.scorer.detail.producesEmpty") }}</span>
            </div>
          </section>

          <section v-if="row.template" class="sd-section tw:flex tw:flex-col tw:gap-2">
            <h4 class="sd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:[line-height:1.5] tw:text-[var(--color-text-primary,currentColor)] tw:pb-[6px] tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-[6px]">
              {{
                scorerType === "llm_judge"
                  ? t("onlineEvals.scorer.detail.promptSection")
                  : t("onlineEvals.scorer.detail.requestTemplateSection")
              }}
              <span v-if="variables.length" class="sd-section__chip tw:inline-flex tw:items-center tw:px-[5px] tw:rounded-[3px] tw:font-semibold tw:text-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">
                {{ variables.length }} {{ t("onlineEvals.scorer.detail.variablesSuffix") }}
              </span>
            </h4>
            <pre class="sd-code tw:m-0 tw:p-3 tw:bg-[color-mix(in_srgb,var(--color-text-primary)_5%,transparent)] tw:border tw:border-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:rounded-lg tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:text-xs tw:[line-height:1.55] tw:text-[var(--color-text-primary,currentColor)] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:max-h-[280px] tw:overflow-auto" data-test="scorer-detail-template">{{ row.template }}</pre>
          </section>

          <section v-if="outputSchemaPretty" class="sd-section tw:flex tw:flex-col tw:gap-2">
            <h4 class="sd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:[line-height:1.5] tw:text-[var(--color-text-primary,currentColor)] tw:pb-[6px] tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-[6px]">{{ t("onlineEvals.scorer.detail.outputSchemaSection") }}</h4>
            <pre class="sd-code sd-code--mono tw:m-0 tw:p-3 tw:bg-[color-mix(in_srgb,var(--color-text-primary)_5%,transparent)] tw:border tw:border-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:rounded-lg tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:text-xs tw:[line-height:1.55] tw:text-[var(--color-text-primary,currentColor)] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:max-h-[280px] tw:overflow-auto tw:whitespace-pre">{{ outputSchemaPretty }}</pre>
          </section>

          <section class="sd-section tw:flex tw:flex-col tw:gap-2">
            <h4 class="sd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:[line-height:1.5] tw:text-[var(--color-text-primary,currentColor)] tw:pb-[6px] tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-[6px]">{{ t("onlineEvals.scorer.detail.metadataSection") }}</h4>
            <dl class="sd-kv tw:grid tw:[grid-template-columns:120px_1fr] tw:gap-[6px_14px] tw:m-0">
              <dt v-if="createdAt">{{ t("onlineEvals.scorer.detail.createdLabel") }}</dt>
              <dd v-if="createdAt" class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt">{{ t("onlineEvals.scorer.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt" class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- Versions -->
        <template v-else-if="activeTab === 'versions'">
          <p class="sd__tab-intro tw:m-0 tw:text-xs tw:[line-height:1.5] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.versionsIntro") }}</p>
          <ul class="sd-versions tw:list-none tw:m-0 tw:p-0 tw:flex tw:flex-col tw:gap-2">
            <li class="sd-versions__item sd-versions__item--active tw:p-[12px_14px] tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_5%,var(--color-card-bg))] tw:border tw:border-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_30%,transparent)] tw:rounded-lg">
              <div class="sd-versions__head tw:flex tw:items-center tw:gap-2">
                <span class="sd-mono sd-versions__label tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:font-bold tw:text-[13px] tw:text-[var(--color-text-primary,currentColor)]">v{{ row.version }}</span>
                <span class="sd-versions__chip tw:inline-flex tw:p-[1px_7px] tw:rounded-[3px] tw:font-semibold tw:text-[10px] tw:bg-[color-mix(in_srgb,var(--o2-status-success-text,#2e7d32)_14%,transparent)] tw:text-[var(--o2-status-success-text,#2e7d32)]">{{ t("onlineEvals.scorer.detail.activeVersionChip") }}</span>
              </div>
              <div v-if="updatedAt" class="sd-versions__meta tw:mt-[6px] tw:text-[11.5px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">
                {{ t("onlineEvals.scorer.detail.lastUpdated") }}
                <span class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</span>
              </div>
            </li>
          </ul>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <div class="sd__runs-toolbar tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
            <DateTimePickerDashboard
              ref="dateTimePickerRef"
              v-model="selectedDate"
              :auto-apply-dashboard="true"
              class="sd__date-picker tw:shrink-0"
              data-test="scorer-detail-runs-window"
            />
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="isLoadingRuns"
              :title="t('onlineEvals.scorer.detail.refresh')"
              data-test="scorer-detail-runs-refresh"
              @click="refreshRuns"
            />
          </div>

          <OTable
            data-test="scorer-detail-runs-table"
            :data="runs"
            :columns="runColumns"
            row-key="id"
            :loading="isLoadingRuns"
            :show-global-filter="false"
            :show-footer="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 200]"
            width="100%"
            class="tw:w-full"
          >
            <template #cell-timestampMs="{ row }">
              <span class="sd-mono sd-muted-text tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ relativeTime(row.timestampMs) }}</span>
            </template>
            <template #cell-jobId="{ row }">
              <span class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ jobNameFor(row.jobId) }}</span>
            </template>
            <template #cell-target="{ row }">
              <div class="sd-target-cell tw:flex tw:flex-col tw:gap-[2px]">
                <div v-if="row.targetSpanId" class="sd-target-cell__line tw:flex tw:items-baseline tw:gap-[6px] tw:text-[11px] tw:min-w-0">
                  <span class="sd-target-cell__label tw:shrink-0 tw:uppercase tw:[letter-spacing:0.04em] tw:font-semibold tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.runs.spanLabel") }}</span>
                  <span class="sd-mono sd-target-cell__id tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[11.5px] tw:text-[var(--color-text-primary,currentColor)] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:min-w-0" :title="row.targetSpanId">{{ row.targetSpanId }}</span>
                </div>
                <div v-if="row.targetTraceId" class="sd-target-cell__line tw:flex tw:items-baseline tw:gap-[6px] tw:text-[11px] tw:min-w-0">
                  <span class="sd-target-cell__label tw:shrink-0 tw:uppercase tw:[letter-spacing:0.04em] tw:font-semibold tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.runs.traceLabel") }}</span>
                  <span class="sd-mono sd-target-cell__id tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[11.5px] tw:text-[var(--color-text-primary,currentColor)] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:min-w-0" :title="row.targetTraceId">{{ row.targetTraceId }}</span>
                </div>
              </div>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.latencyMs != null ? formatLatency(row.latencyMs) : "—" }}</span>
            </template>
            <template #cell-status="{ row }">
              <span class="sd-status-cell tw:inline-flex tw:items-center tw:gap-[5px] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]" :class="`sd-status-cell--${row.status}`">
                <span class="sd-status-cell__dot tw:w-[6px] tw:h-[6px] tw:rounded-full tw:bg-[var(--color-text-secondary,var(--o2-text-secondary))]" />
                {{ row.status }}
              </span>
            </template>
          </OTable>
        </template>

        <!-- Used by -->
        <template v-else-if="activeTab === 'usedBy'">
          <p class="sd__tab-intro tw:m-0 tw:text-xs tw:[line-height:1.5] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ t("onlineEvals.scorer.detail.usedByIntro") }}</p>
          <div v-if="usedByJobs.length === 0" class="sd-empty tw:inline-flex tw:items-center tw:gap-[6px] tw:p-[8px_10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scorer.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="sd-used-list tw:list-none tw:m-0 tw:p-0 tw:flex tw:flex-col tw:gap-1">
            <li v-for="job in usedByJobs" :key="job.id">
              <OButton
                variant="ghost"
                class="sd-used-list__item tw:w-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_5%,transparent)!important] tw:border tw:border-transparent tw:rounded-[5px] tw:[transition:border-color_0.15s,background_0.15s]"
                :data-test="`scorer-detail-used-by-item-${job.name}`"
                @click="emit('view-job', job)"
              >
                <OIcon name="play-arrow" size="xs" />
                <span class="sd-mono tw:[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ job.name }}</span>
                <span class="sd-used-list__meta tw:ml-auto tw:text-[10px] tw:uppercase tw:[letter-spacing:0.04em] tw:text-[var(--color-text-secondary,var(--o2-text-secondary))]">{{ job.status }}</span>
                <OIcon name="chevron-right" size="xs" class="sd-used-list__chevron tw:text-[var(--color-text-secondary,var(--o2-text-secondary))] tw:opacity-50" />
              </OButton>
            </li>
          </ul>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import type {
  EvalJob,
  Provider,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import { useScorerRuns, type ScorerRunsWindow } from "../composables/useScorerRuns";

const props = defineProps<{
  row: Scorer;
  providers: Provider[];
  scoreConfigs: ScoreConfig[];
  jobs: EvalJob[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-job", row: EvalJob): void;
}>();

const { t } = useI18n();
const store = useStore();

type TabId = "configuration" | "versions" | "runs" | "usedBy";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const scorerType = computed<"llm_judge" | "remote">(() => {
  const raw = valueOf<string>(props.row, "scorerType", "scorer_type") ?? "llm_judge";
  return raw === "remote" ? "remote" : "llm_judge";
});

const scorerTypeLabel = computed(() =>
  scorerType.value === "remote"
    ? t("onlineEvals.scorer.detail.typeRemote")
    : t("onlineEvals.scorer.detail.typeLlmJudge"),
);

const params = computed<Record<string, any>>(() => props.row.params ?? {});

const provider = computed<Provider | null>(() => {
  const providerId = params.value.provider_id ?? params.value.providerId;
  if (!providerId) return null;
  return props.providers.find((p) => p.id === providerId) ?? null;
});

const judgeModel = computed<string>(
  () => params.value.model ?? params.value.judge_model ?? "",
);

const remoteEndpoint = computed<string>(
  () => params.value.endpoint ?? params.value.url ?? "",
);

const producesId = computed(
  () =>
    valueOf<string>(props.row, "producesScoreConfigId", "produces_score_config_id") ??
    null,
);

const producesConfig = computed<ScoreConfig | null>(() => {
  if (!producesId.value) return null;
  return (
    props.scoreConfigs.find((c) => entityId(c) === producesId.value) ?? null
  );
});

const variables = computed<string[]>(() => props.row.variables ?? []);

const outputSchemaPretty = computed<string>(() => {
  const schema = valueOf<any>(props.row, "outputSchema", "output_schema");
  if (!schema) return "";
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return "";
  }
});

const usedByJobs = computed<EvalJob[]>(() => {
  const myId = entityId(props.row);
  return props.jobs.filter((job) => {
    if (!Array.isArray(job.scorers)) return false;
    return job.scorers.some((ref) => {
      if (typeof ref === "string") return ref === myId;
      return ref?.id === myId;
    });
  });
});

const createdAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "createdAt", "created_at");
  return typeof v === "number" ? v : null;
});

const updatedAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "updatedAt", "updated_at");
  return typeof v === "number" ? v : null;
});

// — Tabs — no badge counts on Runs (the KPI strip already shows totalRuns).
const tabs = computed(() => [
  {
    id: "configuration" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.configuration"),
    count: null as number | null,
  },
  {
    id: "versions" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.versions"),
    count: 1,
  },
  {
    id: "runs" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.runs"),
    count: null as number | null,
  },
  {
    id: "usedBy" as TabId,
    label: t("onlineEvals.scorer.detail.tabs.usedBy"),
    count: usedByJobs.value.length,
  },
]);

// — Runs window — backed by DateTimePickerDashboard.
const dateTimePickerRef = ref<{
  getConsumableDateTime: () => { startTime: number; endTime: number };
} | null>(null);
const selectedDate = ref<any>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "24h",
});

const dateWindow = ref<ScorerRunsWindow>({
  startUs: (Date.now() - 24 * 60 * 60 * 1000) * 1000,
  endUs: Date.now() * 1000,
});

function syncDateWindow() {
  const picker = dateTimePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  if (dt && typeof dt.startTime === "number" && typeof dt.endTime === "number") {
    dateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

watch(selectedDate, () => syncDateWindow(), { deep: true });

const runsEnabled = computed(() => activeTab.value === "runs");
// `_evaluator.attributes_scorer_id` stores the per-version row `id`, not
// `entity_id`. Using entityId here returns 0 runs even when runs exist.
const scorerIdRef = computed(() => String(props.row.id));

const { kpis, runs, isLoadingRuns, refresh: refreshRunsData } = useScorerRuns(
  scorerIdRef,
  dateWindow,
  runsEnabled,
);

async function refreshRuns() {
  syncDateWindow();
  await refreshRunsData();
}

// — OTable column definitions —
const runColumns = computed(() => [
  {
    id: "timestampMs",
    header: t("onlineEvals.scorer.detail.runs.col.time"),
    accessorKey: "timestampMs",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "jobId",
    header: t("onlineEvals.scorer.detail.runs.col.job"),
    accessorKey: "jobId",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "target",
    header: t("onlineEvals.scorer.detail.runs.col.target"),
    sortable: false,
    size: 360,
    meta: { align: "left" },
  },
  {
    id: "scoreDisplay",
    header: t("onlineEvals.scorer.detail.runs.col.score"),
    accessorKey: "scoreDisplay",
    sortable: false,
    size: 200,
    meta: { align: "left" },
  },
  {
    id: "latencyMs",
    header: t("onlineEvals.scorer.detail.runs.col.latency"),
    accessorKey: "latencyMs",
    sortable: true,
    size: 110,
    meta: { align: "right" },
  },
  {
    id: "status",
    header: t("onlineEvals.scorer.detail.runs.col.status"),
    accessorKey: "status",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
]);

// — KPI tone —
const successRateTone = computed(() => {
  const r = kpis.value.successRate;
  if (r == null) return "";
  if (r >= 95) return "sd-kpi--good";
  if (r >= 80) return "sd-kpi--warn";
  return "sd-kpi--bad";
});

// — Helpers —
function jobNameFor(jobId: string): string {
  if (!jobId) return t("onlineEvals.scorer.detail.runs.jobUnknown");
  const job = props.jobs.find((j) => String(j.id) === jobId);
  return job?.name ?? jobId;
}

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

function formatPercent(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
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

<style>
@keyframes sd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

.sd-scrim { animation: sd-fade 0.18s ease-out; }

@keyframes sd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.sd { animation: sd-slide 0.22s ease-out; }

.sd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

.sd-kpi--good { background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 4%, var(--color-card-bg)); }
.sd-kpi--warn { background: color-mix(in srgb, #f59e0b 5%, var(--color-card-bg)); }
.sd-kpi--bad  { background: color-mix(in srgb, var(--o2-status-error-text, #c62828) 4%, var(--color-card-bg)); }

.sd-kpi--good .sd-kpi__value { color: var(--o2-status-success-text, #2e7d32); }
.sd-kpi--warn .sd-kpi__value { color: #b45309; }
.sd-kpi--bad  .sd-kpi__value { color: var(--o2-status-error-text, #c62828); }

.sd__tab:hover { color: var(--color-text-primary, currentColor); }

.sd__tab--active {
  color: var(--color-primary-600, #3F7994);
  border-bottom-color: var(--color-primary-600, #3F7994);
}

.sd__tab--active .sd__tab-count {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 18%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.sd-type-chip--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.sd-kv dt {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
}

.sd-status-cell--success { color: var(--o2-status-success-text, #2e7d32); }
.sd-status-cell--success .sd-status-cell__dot { background: var(--o2-status-success-text, #2e7d32); }

.sd-status-cell--error,
.sd-status-cell--timeout { color: var(--o2-status-error-text, #c62828); }
.sd-status-cell--error .sd-status-cell__dot,
.sd-status-cell--timeout .sd-status-cell__dot { background: var(--o2-status-error-text, #c62828); }

.sd-status-cell--skipped .sd-status-cell__dot {
  background: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
}

.sd-used-list__item:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent) !important;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, transparent) !important;
}

.sd-used-list__item button {
  height: auto !important;
  padding: 8px 10px !important;
  gap: 8px;
  font-size: 12px;
  justify-content: flex-start;
  text-align: left;
}

.sd-used-list__item:hover .sd-used-list__chevron {
  color: var(--color-primary-600, #3F7994);
  opacity: 1;
}
</style>
