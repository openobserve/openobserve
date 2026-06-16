<template>
  <div
    class="tw:fixed tw:inset-0 tw:bg-black/[0.32] tw:z-[1010] tw:flex tw:justify-end tw:[animation:jd-fade_0.18s_ease-out] jd-scrim"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <aside
      class="tw:w-[1100px] tw:max-w-[96vw] tw:h-full tw:bg-(--color-card-bg) tw:border-l tw:border-(--color-dialog-header-border) tw:flex tw:flex-col tw:[animation:jd-slide_0.22s_ease-out] jd"
      @click.stop
      data-test="eval-job-detail"
    >
      <!-- ── Header ── -->
      <header class="tw:flex tw:items-start tw:gap-2.5 tw:px-5 tw:pt-4 tw:pb-3.5 tw:border-b tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0">
        <div class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
            <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.02em] tw:text-text-secondary">{{ t("onlineEvals.job.detail.eyebrow") }}</span>
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
          <div v-if="row.description" class="tw:text-xs tw:text-text-secondary">
            {{ row.description }}
          </div>
        </div>
        <button
          type="button"
          class="tw:shrink-0 tw:bg-transparent tw:border-0 tw:p-1 tw:rounded tw:cursor-pointer tw:text-(--color-text-secondary) tw:hover:bg-[color-mix(in_srgb,var(--color-text-primary)_8%,transparent)] tw:hover:text-(--color-text-primary)"
          :aria-label="t('onlineEvals.job.detail.close')"
          data-test="eval-job-detail-close-btn"
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
        <article class="tw:flex tw:flex-col tw:gap-0.5 tw:py-[10px] tw:px-3 tw:bg-(--color-card-bg) tw:border tw:border-(--color-dialog-header-border) tw:rounded-md jd-kpi">
          <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.01em] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.totalRuns") }}</span>
          <span class="tw:font-bold tw:text-[22px] tw:leading-[1.1] tw:tracking-[-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-(--color-text-primary)">{{ formatCount(kpis.totalRuns) }}</span>
          <span class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.totalRunsSub") }}</span>
        </article>
        <article class="tw:flex tw:flex-col tw:gap-0.5 tw:py-[10px] tw:px-3 tw:bg-(--color-card-bg) tw:border tw:border-(--color-dialog-header-border) tw:rounded-md jd-kpi" :class="successRateTone">
          <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.01em] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.successRate") }}</span>
          <span class="tw:font-bold tw:text-[22px] tw:leading-[1.1] tw:tracking-[-0.01em] tw:[font-variant-numeric:tabular-nums] jd-kpi__value">{{ formatPercent(kpis.successRate) }}</span>
          <span class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.successRateSub") }}</span>
        </article>
        <article class="tw:flex tw:flex-col tw:gap-0.5 tw:py-[10px] tw:px-3 tw:bg-(--color-card-bg) tw:border tw:border-(--color-dialog-header-border) tw:rounded-md jd-kpi">
          <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.01em] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.avgLatency") }}</span>
          <span class="tw:font-bold tw:text-[22px] tw:leading-[1.1] tw:tracking-[-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-(--color-text-primary)">{{ formatLatency(kpis.avgLatencyMs) }}</span>
          <span class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.avgLatencySub") }}</span>
        </article>
        <article class="tw:flex tw:flex-col tw:gap-0.5 tw:py-[10px] tw:px-3 tw:bg-(--color-card-bg) tw:border tw:border-(--color-dialog-header-border) tw:rounded-md jd-kpi">
          <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.01em] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.kpis.scorers") }}</span>
          <span class="tw:font-bold tw:text-[22px] tw:leading-[1.1] tw:tracking-[-0.01em] tw:[font-variant-numeric:tabular-nums] tw:text-(--color-text-primary)">{{ resolvedScorers.length }}</span>
          <span class="tw:text-[11px] tw:text-(--color-text-secondary)">
            {{ resolvedScorers.length === 1
              ? t("onlineEvals.job.detail.kpis.scorersSubSingular")
              : t("onlineEvals.job.detail.kpis.scorersSubPlural") }}
          </span>
        </article>
      </section>

      <!-- ── Tab strip ── -->
      <nav class="tw:flex tw:gap-4.5 tw:px-5 tw:border-b tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-[10px] tw:px-0 tw:bg-transparent tw:border-0 tw:border-b-2 tw:border-b-transparent tw:cursor-pointer tw:text-(--color-text-secondary) tw:font-semibold tw:text-[13px] tw:-mb-px tw:hover:text-(--color-text-primary) jd__tab"
          :class="{ 'jd__tab--active': activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :data-test="`eval-job-detail-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.count != null"
            class="tw:inline-flex tw:items-center tw:justify-center tw:px-1.5 tw:min-w-[18px] tw:h-4 tw:rounded-full tw:font-semibold tw:text-[10px] tw:leading-none tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:text-(--color-text-secondary) jd__tab-count"
          >{{ tab.count }}</span>
        </button>
      </nav>

      <!-- ── Body ── -->
      <div class="tw:flex-1 tw:overflow-auto tw:px-5 tw:py-4.5 tw:flex tw:flex-col tw:gap-4.5 tw:min-h-0 tw:bg-card-bg">
        <!-- Configuration -->
        <template v-if="activeTab === 'configuration'">
          <!-- Target -->
          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-[1.5] tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">{{ t("onlineEvals.job.detail.targetSection") }}</h4>
            <dl class="tw:grid tw:grid-cols-[130px_1fr] tw:gap-y-1.5 tw:gap-x-3.5 tw:m-0">
              <dt class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.streamLabel") }}</dt>
              <dd class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.stream }}</dd>

              <dt class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.streamTypeLabel") }}</dt>
              <dd class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ streamType }}</dd>

              <dt class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.filterLabel") }}</dt>
              <dd class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words">
                <pre
                  v-if="filterClauses.length > 0"
                  class="tw:m-0 tw:py-3 tw:px-3.5 tw:bg-[color-mix(in_srgb,#6b76e3_6%,var(--color-card-bg))] tw:border tw:border-[color-mix(in_srgb,#6b76e3_22%,transparent)] tw:rounded-md tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:text-[13px] tw:leading-[1.85] tw:text-(--color-text-primary) tw:max-h-[240px] tw:overflow-auto tw:whitespace-pre"
                  data-test="eval-job-detail-filter"
                ><div
                    v-for="(clause, idx) in filterClauses"
                    :key="idx"
                    class="tw:block tw:whitespace-pre"
                    :style="{ paddingLeft: `${clause.depth * 16}px` }"
                  ><span class="tw:inline-block tw:w-[38px] tw:mr-2 tw:text-[#7c3aed] tw:font-bold">{{ clause.keyword }}</span><span class="tw:text-[#1d4ed8] tw:mr-1.5">{{ clause.column }}</span><span class="tw:text-(--color-text-secondary) tw:mr-1.5">{{ clause.operator }}</span><span
                      class="tw:text-(--color-text-primary)"
                      :class="{ 'tw:text-[#b25400]': clause.valueIsString }"
                    >{{ clause.valueText }}</span></div></pre>
                <span v-else class="tw:text-(--color-text-secondary) tw:italic">{{ t("onlineEvals.job.detail.filterEmpty") }}</span>
              </dd>
            </dl>
          </section>

          <!-- Scorers -->
          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-[1.5] tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">
              {{ t("onlineEvals.job.detail.scorersSection") }}
              <span class="tw:inline-flex tw:items-center tw:px-[5px] tw:rounded-[3px] tw:font-semibold tw:text-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary)">{{ resolvedScorers.length }}</span>
            </h4>
            <div v-if="resolvedScorers.length === 0" class="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-2 tw:px-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-(--color-text-secondary)">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.job.detail.scorersEmpty") }}</span>
            </div>
            <ul v-else class="tw:list-none tw:m-0 tw:p-0 tw:flex tw:flex-col tw:gap-[10px]">
              <li v-for="item in resolvedScorers" :key="item.id">
                <button
                  type="button"
                  class="tw:w-full tw:flex tw:items-center tw:gap-3.5 tw:py-3.5 tw:px-4 tw:bg-(--color-card-bg) tw:border tw:border-[color-mix(in_srgb,var(--color-text-secondary)_16%,transparent)] tw:rounded-lg tw:text-left tw:cursor-pointer tw:transition-[border-color,background,box-shadow,transform] tw:duration-[150ms] jd-scorers__card"
                  :data-test="`eval-job-detail-scorer-item-${item.name}`"
                  :disabled="!findScorerById(item.id)"
                  @click="onScorerClick(item.id)"
                >
                  <span
                    class="tw:shrink-0 tw:inline-flex tw:items-center tw:justify-center tw:w-[34px] tw:h-[34px] tw:rounded-lg tw:bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] tw:text-[#4f5bcf]"
                    :class="{
                      'tw:bg-[color-mix(in_srgb,#b25400_14%,transparent)]! tw:text-[#b25400]!': item.scorerType === 'remote',
                      'tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)]! tw:text-(--color-text-secondary)!': item.scorerType === 'unknown',
                    }"
                  >
                    <OIcon
                      :name="item.scorerType === 'remote' ? 'cloud' : 'smart-toy'"
                      size="sm"
                    />
                  </span>
                  <div class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-[5px]">
                    <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                      <span class="tw:font-bold tw:text-sm tw:text-(--color-text-primary) tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ item.name }}</span>
                      <span
                        v-if="item.scorerTypeLabel"
                        class="tw:inline-flex tw:py-px tw:px-[7px] tw:rounded-[3px] tw:font-semibold tw:text-[10px] tw:leading-[1.5] tw:bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] tw:text-[#4f5bcf]"
                        :class="{
                          'tw:bg-[color-mix(in_srgb,#b25400_14%,transparent)]! tw:text-[#b25400]!': item.scorerType === 'remote',
                        }"
                      >
                        {{ item.scorerTypeLabel }}
                      </span>
                      <span class="tw:text-[11px] tw:text-(--color-text-secondary) tw:[font-variant-numeric:tabular-nums]">v{{ item.version }}</span>
                    </div>
                    <div v-if="item.scoreConfigName" class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-(--color-text-secondary) tw:flex-wrap">
                      <OIcon name="rule" size="xs" class="tw:shrink-0 tw:text-(--color-text-secondary) tw:opacity-70" />
                      <span class="tw:font-medium">
                        {{ t("onlineEvals.job.detail.producesPrefix") }}
                      </span>
                      <span class="tw:text-(--color-text-primary) tw:font-bold tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ item.scoreConfigName }}</span>
                      <template v-if="item.scoreConfigDataType">
                        <span class="tw:text-(--color-text-secondary) tw:opacity-50">·</span>
                        <span class="tw:text-(--color-text-secondary) tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">
                          {{ item.scoreConfigDataType }}
                        </span>
                      </template>
                      <template v-if="item.scoreConfigRangeText">
                        <span class="tw:text-(--color-text-secondary) tw:opacity-50">·</span>
                        <span class="tw:text-(--color-text-secondary) tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">
                          {{ item.scoreConfigRangeText }}
                        </span>
                      </template>
                    </div>
                  </div>
                  <span class="tw:shrink-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-(--color-text-secondary) tw:font-semibold tw:text-[11px] jd-scorers__cta">
                    <span class="tw:opacity-0 tw:transition-opacity tw:duration-[150ms] jd-scorers__cta-label">
                      {{ t("onlineEvals.job.detail.viewScorerHint") }}
                    </span>
                    <OIcon name="chevron-right" size="sm" class="tw:shrink-0 tw:opacity-50 tw:transition-[opacity,transform] tw:duration-[150ms] jd-scorers__chevron" />
                  </span>
                </button>
              </li>
            </ul>
          </section>


          <!-- Sampling -->
          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-[1.5] tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">{{ t("onlineEvals.job.detail.samplingSection") }}</h4>
            <dl class="tw:grid tw:grid-cols-[130px_1fr] tw:gap-y-1.5 tw:gap-x-3.5 tw:m-0">
              <dt class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.samplingModeLabel") }}</dt>
              <dd class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words">{{ samplingModeLabel }}</dd>

              <dt v-if="samplingValue != null" class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.samplingValueLabel") }}</dt>
              <dd v-if="samplingValue != null" class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ samplingValue }}</dd>
            </dl>
          </section>

          <!-- Metadata -->
          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-[1.5] tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">{{ t("onlineEvals.job.detail.metadataSection") }}</h4>
            <dl class="tw:grid tw:grid-cols-[130px_1fr] tw:gap-y-1.5 tw:gap-x-3.5 tw:m-0">
              <dt class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.versionLabel") }}</dt>
              <dd class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">v{{ row.version }}</dd>
              <dt v-if="pipelineId" class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.pipelineLabel") }}</dt>
              <dd v-if="pipelineId" class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ pipelineId }}</dd>
              <dt v-if="createdAt" class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.createdLabel") }}</dt>
              <dd v-if="createdAt" class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt" class="tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt" class="tw:m-0 tw:text-[13px] tw:text-(--color-text-primary) tw:break-words tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- Runs -->
        <template v-else-if="activeTab === 'runs'">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
            <DateTimePickerDashboard
              ref="dateTimePickerRef"
              v-model="selectedDate"
              :auto-apply-dashboard="true"
              class="tw:shrink-0"
              data-test="eval-job-detail-runs-window"
            />
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="isLoadingRuns"
              :title="t('onlineEvals.job.detail.refresh')"
              data-test="eval-job-detail-runs-refresh"
              @click="refreshRuns"
            />
          </div>

          <OTable
            data-test="eval-job-detail-runs-table"
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
              <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-(--color-text-secondary)">{{ relativeTime(row.timestampMs) }}</span>
            </template>
            <template #cell-scorerId="{ row }">
              <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ scorerNameFor(row.scorerId) }}</span>
            </template>
            <template #cell-target="{ row }">
              <div class="tw:flex tw:flex-col tw:gap-0.5">
                <div v-if="row.targetSpanId" class="tw:flex tw:items-baseline tw:gap-1.5 tw:text-[11px] tw:min-w-0">
                  <span class="tw:shrink-0 tw:uppercase tw:tracking-[0.04em] tw:font-semibold tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.runs.spanLabel") }}</span>
                  <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[11.5px] tw:text-(--color-text-primary) tw:truncate tw:min-w-0" :title="row.targetSpanId">{{ row.targetSpanId }}</span>
                </div>
                <div v-if="row.targetTraceId" class="tw:flex tw:items-baseline tw:gap-1.5 tw:text-[11px] tw:min-w-0">
                  <span class="tw:shrink-0 tw:uppercase tw:tracking-[0.04em] tw:font-semibold tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.runs.traceLabel") }}</span>
                  <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[11.5px] tw:text-(--color-text-primary) tw:truncate tw:min-w-0" :title="row.targetTraceId">{{ row.targetTraceId }}</span>
                </div>
              </div>
            </template>
            <template #cell-scoreDisplay="{ row }">
              <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.scoreDisplay }}</span>
            </template>
            <template #cell-latencyMs="{ row }">
              <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.latencyMs != null ? formatLatency(row.latencyMs) : "—" }}</span>
            </template>
            <template #cell-status="{ row }">
              <span class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-(--color-text-secondary) jd-status-cell" :class="`jd-status-cell--${row.status}`">
                <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-(--color-text-secondary) jd-status-cell__dot" />
                {{ row.status }}
              </span>
            </template>
          </OTable>
        </template>

        <!-- Failures -->
        <template v-else-if="activeTab === 'failures'">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
            <DateTimePickerDashboard
              ref="dateTimePickerRef"
              v-model="selectedDate"
              :auto-apply-dashboard="true"
              class="tw:shrink-0"
              data-test="eval-job-detail-failures-window"
            />
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="isLoadingRuns"
              :title="t('onlineEvals.job.detail.refresh')"
              data-test="eval-job-detail-failures-refresh"
              @click="refreshRuns"
            />
          </div>

          <!-- Failures-by-scorer rollup -->
          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-[1.5] tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">
              {{ t("onlineEvals.job.detail.failures.byScorerTitle") }}
              <span class="tw:inline-flex tw:items-center tw:px-[5px] tw:rounded-[3px] tw:font-semibold tw:text-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary)">{{ failureRows.length }}</span>
            </h4>
            <div v-if="failureRows.length === 0" class="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-2 tw:px-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-(--color-text-secondary)">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.job.detail.failures.byScorerEmpty") }}</span>
            </div>
            <OTable
              v-else
              data-test="eval-job-detail-failures-by-scorer-table"
              :data="failureRows"
              :columns="failureByScorerColumns"
              row-key="scorerId"
              :show-global-filter="false"
              :show-footer="false"
              :show-pagination="false"
              width="100%"
              class="tw:w-full"
            >
              <template #cell-scorerId="{ row }">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ scorerNameFor(row.scorerId) }}</span>
              </template>
              <template #cell-failureRate="{ row }">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]" :class="failTone(row.failureRate)">
                  {{ formatPercent(row.failureRate) }}
                </span>
              </template>
              <template #cell-failures="{ row }">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">
                  <strong>{{ row.failures }}</strong>
                  / {{ row.totalRuns }}
                </span>
              </template>
            </OTable>
          </section>

          <!-- Recent failures -->
          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-[1.5] tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">
              {{ t("onlineEvals.job.detail.failures.recentTitle") }}
              <span class="tw:inline-flex tw:items-center tw:px-[5px] tw:rounded-[3px] tw:font-semibold tw:text-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary)">{{ failedRuns.length }}</span>
            </h4>
            <div v-if="failedRuns.length === 0 && !isLoadingRuns" class="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-2 tw:px-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-(--color-text-secondary)">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.job.detail.failures.recentEmpty") }}</span>
            </div>
            <OTable
              v-else
              data-test="eval-job-detail-failures-table"
              :data="failedRuns"
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
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-(--color-text-secondary)">{{ relativeTime(row.timestampMs) }}</span>
              </template>
              <template #cell-scorerId="{ row }">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ scorerNameFor(row.scorerId) }}</span>
              </template>
              <template #cell-target="{ row }">
                <div class="tw:flex tw:flex-col tw:gap-0.5">
                  <div v-if="row.targetSpanId" class="tw:flex tw:items-baseline tw:gap-1.5 tw:text-[11px] tw:min-w-0">
                    <span class="tw:shrink-0 tw:uppercase tw:tracking-[0.04em] tw:font-semibold tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.runs.spanLabel") }}</span>
                    <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[11.5px] tw:text-(--color-text-primary) tw:truncate tw:min-w-0" :title="row.targetSpanId">{{ row.targetSpanId }}</span>
                  </div>
                  <div v-if="row.targetTraceId" class="tw:flex tw:items-baseline tw:gap-1.5 tw:text-[11px] tw:min-w-0">
                    <span class="tw:shrink-0 tw:uppercase tw:tracking-[0.04em] tw:font-semibold tw:text-(--color-text-secondary)">{{ t("onlineEvals.job.detail.runs.traceLabel") }}</span>
                    <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:text-[11.5px] tw:text-(--color-text-primary) tw:truncate tw:min-w-0" :title="row.targetTraceId">{{ row.targetTraceId }}</span>
                  </div>
                </div>
              </template>
              <template #cell-scoreDisplay="{ row }">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.scoreDisplay }}</span>
              </template>
              <template #cell-latencyMs="{ row }">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ row.latencyMs != null ? formatLatency(row.latencyMs) : "—" }}</span>
              </template>
              <template #cell-status="{ row }">
                <span class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-(--color-text-secondary) jd-status-cell" :class="`jd-status-cell--${row.status}`">
                  <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-(--color-text-secondary) jd-status-cell__dot" />
                  {{ row.status }}
                </span>
              </template>
            </OTable>
          </section>
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
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { normalizeJobFilterCondition } from "../utils/jobFilter";
import { useEvalJobRuns, type JobRunsWindow } from "../composables/useEvalJobRuns";

const props = defineProps<{
  row: EvalJob;
  scorers: Scorer[];
  scoreConfigs: ScoreConfig[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-scorer", row: Scorer): void;
}>();

const { t } = useI18n();
const store = useStore();

type TabId = "configuration" | "runs" | "failures";
const activeTab = ref<TabId>("configuration");

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const streamType = computed<string>(
  () => valueOf<string>(props.row, "streamType", "stream_type") ?? "traces",
);

const normalizedFilter = computed(() => {
  const raw = valueOf<any>(props.row, "filterCondition", "filter_condition");
  return normalizeJobFilterCondition(raw);
});

const filterCondition = computed(() => normalizedFilter.value);

interface FilterClause {
  keyword: "if" | "AND" | "OR";
  column: string;
  operator: string;
  valueText: string;
  valueIsString: boolean;
  depth: number;
}

const filterClauses = computed<FilterClause[]>(() => {
  const cond = filterCondition.value;
  if (!cond) return [];
  const out = flattenFilter(cond, 0);
  if (out.length === 0) return [];
  out[0].keyword = "if";
  return out;
});

function flattenFilter(node: any, depth: number): FilterClause[] {
  if (!node || typeof node !== "object") return [];

  if (node.filterType === "condition") {
    const formatted = formatConditionParts(node);
    if (!formatted) return [];
    return [{ ...formatted, keyword: "AND" as const, depth }];
  }

  if (node.filterType === "group" && Array.isArray(node.conditions)) {
    const op: "AND" | "OR" = node.logicalOperator === "OR" ? "OR" : "AND";
    const out: FilterClause[] = [];
    for (let i = 0; i < node.conditions.length; i += 1) {
      const child = flattenFilter(node.conditions[i], depth + (out.length > 0 ? 1 : 0));
      if (child.length === 0) continue;
      if (out.length > 0 && child.length > 0) {
        child[0].keyword = op;
      }
      out.push(...child);
    }
    return out;
  }

  return [];
}

function formatConditionParts(
  node: any,
): Pick<FilterClause, "column" | "operator" | "valueText" | "valueIsString"> | null {
  const column = String(node.column ?? "").trim();
  const operator = String(node.operator ?? "=").trim();
  if (!column) return null;

  const valuesList: string[] = Array.isArray(node.values) ? node.values.filter(Boolean) : [];
  const rawValue = node.value;
  const opUpper = operator.toUpperCase();

  if (opUpper === "IN" || opUpper === "NOT IN") {
    const items = valuesList.length > 0 ? valuesList : rawValue ? [String(rawValue)] : [];
    if (items.length === 0) {
      return { column, operator, valueText: "(…)", valueIsString: false };
    }
    return {
      column,
      operator,
      valueText: `(${items.map(formatValue).join(", ")})`,
      valueIsString: false,
    };
  }

  if (rawValue == null || rawValue === "") {
    return { column, operator, valueText: `""`, valueIsString: true };
  }
  const valueText = formatValue(String(rawValue));
  return {
    column,
    operator,
    valueText,
    valueIsString: !/^-?\d+(\.\d+)?$/.test(String(rawValue)),
  };
}

function formatValue(v: string): string {
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

const statusLabel = computed(() =>
  t(`onlineEvals.jobStatus.${props.row.status}`, props.row.status),
);

const samplingMode = computed(
  () => valueOf<string>(props.row, "samplingMode", "sampling_mode") ?? "all",
);

const samplingValue = computed(
  () => valueOf<any>(props.row, "samplingValue", "sampling_value"),
);

const samplingModeLabel = computed(() => {
  if (samplingMode.value === "rate") return t("onlineEvals.job.detail.samplingRate");
  if (samplingMode.value === "count") return t("onlineEvals.job.detail.samplingCount");
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
  const dataType = String(
    valueOf<string>(cfg, "dataType", "data_type") ?? "",
  );
  if (dataType === "numeric") {
    const range: any =
      valueOf<any>(cfg, "numericRange", "numeric_range") ?? {};
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
    const refId = typeof ref === "string" ? ref : ref?.id ?? "";
    const refVersion = typeof ref === "object" ? ref?.version ?? null : null;
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
      ? props.scoreConfigs.find((c) => entityId(c) === cfgId) ?? null
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

// `_evaluator.attributes_scorer_id` stores the per-version row `id`, not
// `entity_id`. Match on `s.id` so the lookup actually resolves.
function scorerNameFor(refId: string): string {
  if (!refId) return t("onlineEvals.job.detail.runs.scorerUnknown");
  const found = props.scorers.find((s) => String(s.id) === refId);
  return found?.name ?? refId;
}

function findScorerById(refId: string): Scorer | null {
  return props.scorers.find((s) => String(s.id) === refId) ?? null;
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
    count: null as number | null,
  },
  {
    id: "runs" as TabId,
    label: t("onlineEvals.job.detail.tabs.runs"),
    count: null as number | null,
  },
  {
    id: "failures" as TabId,
    label: t("onlineEvals.job.detail.tabs.failures"),
    count: null as number | null,
  },
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

function syncDateWindow() {
  const picker = dateTimePickerRef.value;
  if (!picker) return;
  const dt = picker.getConsumableDateTime();
  if (dt && typeof dt.startTime === "number" && typeof dt.endTime === "number") {
    dateWindow.value = { startUs: dt.startTime, endUs: dt.endTime };
  }
}

// The DateTimePicker emits `update:modelValue` on apply; sync the resolved
// window on every change so the queries refire.
watch(selectedDate, () => syncDateWindow(), { deep: true });

const tableEnabled = computed(
  () => activeTab.value === "runs" || activeTab.value === "failures",
);
const jobIdRef = computed(() => String(props.row.id ?? ""));

const {
  kpis,
  runs,
  failuresByScorer,
  isLoading: isLoadingRuns,
  refresh: refreshRunsData,
} = useEvalJobRuns(jobIdRef, dateWindow, tableEnabled);

async function refreshRuns() {
  syncDateWindow();
  await refreshRunsData();
}

const failedRuns = computed(() =>
  runs.value.filter((r) => r.status === "error" || r.status === "timeout"),
);

const failureRows = computed(() => failuresByScorer.value.filter((r) => r.failures > 0));

// — KPI tone —
const successRateTone = computed(() => {
  const r = kpis.value.successRate;
  if (r == null) return "";
  if (r >= 95) return "jd-kpi--good";
  if (r >= 80) return "jd-kpi--warn";
  return "jd-kpi--bad";
});

function failTone(rate: number): string {
  if (rate >= 20) return "jd-status-cell--bad";
  if (rate >= 5) return "jd-status-cell--warn";
  return "";
}

// — OTable column definitions —
const runColumns = computed(() => [
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
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "target",
    header: t("onlineEvals.job.detail.runs.col.target"),
    sortable: false,
    size: 360,
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
    meta: { align: "right" },
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

const failureByScorerColumns = computed(() => [
  {
    id: "scorerId",
    header: t("onlineEvals.job.detail.failures.col.scorer"),
    accessorKey: "scorerId",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "failureRate",
    header: t("onlineEvals.job.detail.failures.col.failureRate"),
    accessorKey: "failureRate",
    sortable: true,
    size: 130,
    meta: { align: "right" },
  },
  {
    id: "failures",
    header: t("onlineEvals.job.detail.failures.col.count"),
    accessorKey: "failures",
    sortable: true,
    size: 140,
    meta: { align: "right" },
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
/* Animation keyframes — cannot be inlined */
@keyframes jd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

@keyframes jd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

/* Tab active state — self-styles applied here for specificity alongside border-bottom-color */
.jd__tab--active {
  color: var(--color-primary-600, #3F7994);
  border-bottom-color: var(--color-primary-600, #3F7994);
}

/* Tab count inside active tab — descendant selector, must keep */
.jd__tab--active .jd__tab-count {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 18%, transparent);
  color: var(--color-primary-600, #3F7994);
}

/* KPI tone backgrounds — dynamic class applied via successRateTone computed */
.jd-kpi--good { background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 4%, var(--color-card-bg)); }
.jd-kpi--warn { background: color-mix(in srgb, #f59e0b 5%, var(--color-card-bg)); }
.jd-kpi--bad  { background: color-mix(in srgb, var(--o2-status-error-text, #c62828) 4%, var(--color-card-bg)); }

/* KPI value color when inside a toned KPI card — descendant selectors, must keep */
.jd-kpi--good .jd-kpi__value { color: var(--o2-status-success-text, #2e7d32); }
.jd-kpi--warn .jd-kpi__value { color: #b45309; }
.jd-kpi--bad  .jd-kpi__value { color: var(--o2-status-error-text, #c62828); }

/* Scorer card hover with :not(:disabled) — complex selector, must keep */
.jd-scorers__card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 45%, transparent);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
  box-shadow: 0 1px 3px color-mix(in srgb, var(--color-primary-600, #3F7994) 12%, transparent);
  transform: translateY(-1px);
}

/* Scorer card disabled — attribute selector, must keep */
.jd-scorers__card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Scorer card hover affecting child elements — descendant selectors, must keep */
.jd-scorers__card:hover:not(:disabled) .jd-scorers__cta {
  color: var(--color-primary-600, #3F7994);
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__cta-label {
  opacity: 1;
}

.jd-scorers__card:hover:not(:disabled) .jd-scorers__chevron {
  opacity: 1;
  transform: translateX(2px);
}

/* Status cell color states — dynamic class applied via jd-status-cell--${row.status} */
.jd-status-cell--success { color: var(--o2-status-success-text, #2e7d32); }
.jd-status-cell--error,
.jd-status-cell--timeout { color: var(--o2-status-error-text, #c62828); }
.jd-status-cell--warn { color: #b45309; }
.jd-status-cell--bad { color: var(--o2-status-error-text, #c62828); }

/* Status dot color inside status cells — descendant selectors, must keep */
.jd-status-cell--success .jd-status-cell__dot { background: var(--o2-status-success-text, #2e7d32); }
.jd-status-cell--error .jd-status-cell__dot,
.jd-status-cell--timeout .jd-status-cell__dot { background: var(--o2-status-error-text, #c62828); }
.jd-status-cell--skipped .jd-status-cell__dot {
  background: color-mix(in srgb, var(--color-text-secondary) 60%, transparent);
}
</style>
