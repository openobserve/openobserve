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
  <!-- AddAlert OWNS the ONE form (Rule ③ owner pattern): `form` is created in
       setup() via useAlertForm's useOForm and handed to <OForm :form> so the
       topbar OForm* fields and the already-migrated descendant steps
       (QueryConfig / AlertSettings) bind by nested `name=` into it. -->
  <OForm :form="form" v-slot="{ isSubmitting }" class="h-full w-full">
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- V3 "Single Pane of Glass" Layout (All alert types)                -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <OPageLayout bleed>
      <template #header>
        <OPageHeader
          class="alert-v3-topbar border-border-default [container-type:inline-size] shrink-0 border-b [container-name:topbar]"
          :back="{
            label: activeFolderName || t('alerts.header'),
            ariaLabel: activeFolderName
              ? t('alerts.form.header.backToFolder', { folder: activeFolderName })
              : undefined,
            onClick: goBackToAlertsList,
            dataTest: 'add-alert-back-btn',
          }"
          title-overflow="visible"
        >
          <template #title>
            <span class="flex min-w-0 items-center gap-1">
              <OTruncatedText data-test="add-alert-header-title">{{
                formData.name || t("alerts.sections.details.unnamed")
              }}</OTruncatedText>
              <OButton
                v-if="!isEditing"
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                :aria-label="t('alerts.form.header.editName')"
                data-test="add-alert-header-name-edit"
                @click="editNameInDetails"
              >
                <OTooltip side="bottom" :content="t('alerts.form.header.editName')" />
              </OButton>
            </span>
          </template>

          <!-- EDIT MODE: the alert's state trails the name (anomaly: status, last run, retry) -->
          <template #title-trail>
            <AlertEditStatus
              v-if="isEditingAlert"
              part="state"
              :header="editHeader"
              :alert-id="editAlertId"
              :folder-id="editFolderId"
              :org-id="store.state.selectedOrganization.identifier"
            />
            <div
              v-else-if="(beingUpdated || anomalyEditMode) && isAnomalyMode"
              class="flex items-center gap-1.5"
            >
              <OTooltip
                :content="raw(anomalyConfig.last_error)"
                :disabled="
                  (anomalyConfig.status !== 'failed' &&
                    !isAnomalyDataReadinessStatus(anomalyConfig.status)) ||
                  !anomalyConfig.last_error
                "
              >
                <OTag
                  v-if="anomalyConfig.status"
                  type="anomalyStatus"
                  :value="anomalyConfig.status"
                />
              </OTooltip>
              <!-- §4.8 health badge: its own element keyed off notice_class, never folded into the status tag. -->
              <OTooltip v-if="anomalyNoticeBadge" :content="anomalyNoticeTooltip">
                <OTag
                  variant="warning-quiet"
                  :label="anomalyNoticeBadge.label"
                  data-test="anomaly-notice-badge"
                />
              </OTooltip>
              <span
                v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
                class="text-2xs text-text-secondary whitespace-nowrap"
              >
                {{
                  t("alerts.lastRun", { time: anomalyFormatTs(anomalyConfig.last_detection_run) })
                }}
              </span>
              <OTooltip
                v-if="anomalyConfig.status === 'failed'"
                :content="t('alerts.retryTraining')"
              >
                <OButton
                  variant="ghost-destructive"
                  size="xs"
                  :loading="anomalyRetraining"
                  @click="anomalyTriggerRetrain"
                  icon-left="replay"
                >
                  {{ t("alerts.retry") }}
                </OButton>
              </OTooltip>
              <OTooltip
                v-else-if="anomalyCanCheckDataNow(anomalyConfig)"
                :content="t('alerts.anomaly.checkDataNowTooltip')"
              >
                <OButton
                  variant="ghost"
                  size="xs"
                  :loading="anomalyRetraining"
                  data-test="anomaly-check-data-now"
                  @click="anomalyTriggerRetrain"
                  icon-left="replay"
                >
                  {{ t("alerts.anomaly.checkDataNow") }}
                </OButton>
              </OTooltip>
            </div>
          </template>

          <template #subtitle>
            <span class="flex min-w-0 items-center gap-1 leading-normal">
              <span class="whitespace-nowrap">
                {{ t("alerts.modeInFolder", { mode: headerModeLabel }) }}
              </span>
              <OTruncatedText
                class="text-text-body font-medium"
                data-test="add-alert-header-folder"
              >
                {{ activeFolderName }}
              </OTruncatedText>
            </span>
          </template>

          <template v-if="isEditingAlert" #actions>
            <template v-if="lgUp">
              <AlertEditStatus
                part="actions"
                :header="editHeader"
                :alert-id="editAlertId"
                :folder-id="editFolderId"
                :org-id="store.state.selectedOrganization.identifier"
              />
              <AlertEditActions
                part="fire"
                :header="editHeader"
                :name="formData.name"
                :folder-id="editFolderId"
              />
            </template>
            <AlertEditActions
              part="more"
              :compact="!lgUp"
              :header="editHeader"
              :name="formData.name"
              :folder-id="editFolderId"
              @edit-json="openJsonEditor"
            >
              <template #menu-start>
                <AlertEditStatus
                  part="menu"
                  :header="editHeader"
                  :alert-id="editAlertId"
                  :folder-id="editFolderId"
                  :org-id="store.state.selectedOrganization.identifier"
                />
              </template>
            </AlertEditActions>
          </template>
        </OPageHeader>
      </template>

      <div v-if="siemDetectionId" class="flex shrink-0 flex-col gap-2 px-3 pt-2">
        <OBanner
          dense
          variant="info"
          icon="shield-alert-outline"
          data-test="add-alert-siem-detection"
        >
          {{ t("alerts.siemDetection.notice") }}
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              icon-right="open-in-new"
              data-test="add-alert-siem-detection-open"
              @click="openInSecurity"
              >{{ t("alerts.siemDetection.open") }}</OButton
            >
          </template>
        </OBanner>
      </div>
      <!-- What the source adapter had to change to turn the user's query into an
           alert — a stripped LIMIT, an absolute range become a rolling window.
           Shown here rather than only in the confirm dialog because most
           surfaces now skip that dialog and come straight to this form; without
           this the transforms would be silent. -->
      <div
        v-if="prefillWarnings.length || calibrationHandoff.reserved.value"
        class="flex shrink-0 flex-col gap-2 px-3 pt-2"
      >
        <!-- Invisible until the handoff is read, so the slot keeps its height from first paint. -->
        <div
          v-if="calibrationHandoff.reserved.value"
          :class="calibrationBanner ? '' : 'invisible'"
          :data-severity="calibrationBanner?.variant ?? ''"
          data-test="add-alert-calibration-banner"
        >
          <OBanner dense inline-actions :variant="calibrationBanner?.variant ?? 'info'">
            <OTruncatedText>{{ calibrationBanner?.text ?? "" }}</OTruncatedText>
          </OBanner>
        </div>
        <OBanner
          v-for="(warning, index) in prefillWarnings"
          :key="`${warning.key}-${index}`"
          dense
          :variant="warning.level === 'info' ? 'info' : 'warning'"
          :content="t(`alerts.prefill.warnings.${warning.key}`, warning.params ?? {})"
          :data-test="`add-alert-prefill-warning-${warning.key}`"
        />
      </div>

      <div :key="draftFormKey" class="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
        <aside
          class="border-border-default max-lg:bg-surface-base flex shrink-0 flex-col gap-3 overflow-y-auto border-e px-2 py-3 max-lg:sticky max-lg:top-0 max-lg:z-1 max-lg:w-auto max-lg:gap-2 max-lg:border-e-0 max-lg:border-b max-lg:px-3 max-lg:py-2"
          :class="compactRail ? 'w-14' : 'w-53'"
          data-test="add-alert-section-nav"
        >
          <!-- Below xl the rail keeps only the step markers, so the find field moves to the bar above the form. -->
          <Teleport :to="findSlotRef" :disabled="!findInBar">
            <OCommandSearch
              v-model="settingFind.query.value"
              :items="settingFind.items.value"
              :label="t('alerts.find.label')"
              :placeholder="t('alerts.find.placeholder')"
              :count-text="settingFind.countText.value"
              :empty-text="settingFind.emptyText.value"
              shortcut-id="sectionedFormFind"
              data-test="add-alert-find-setting"
              @select="settingFind.select"
            >
              <template #footer>{{ t("alerts.find.hint") }}</template>
            </OCommandSearch>
          </Teleport>
          <OSectionNav
            :items="sectionItems"
            :active="activeSection"
            :label="t('alerts.sections.navLabel')"
            :compact="compactRail"
            @select="goToSection"
          />
        </aside>

        <div
          class="flex min-h-0 min-w-0 shrink grow basis-5xl flex-col max-lg:flex-none lg:max-w-5xl"
        >
          <div
            class="border-border-default flex shrink-0 items-center justify-end gap-4 border-b px-4 py-1"
            data-test="add-alert-show-all-bar"
          >
            <div v-if="compactRail" ref="findSlotRef" class="me-auto w-60 min-w-0" />
            <OSwitch
              :model-value="showAll"
              :label="t('alerts.form.showAll')"
              label-position="left"
              off-tone="neutral"
              state-text
              class="min-h-6"
              data-test="add-alert-show-all"
              @update:model-value="setShowAll(Boolean($event))"
            />
          </div>
          <OSnapScroll
            ref="snapScrollRef"
            v-model:active="activeSection"
            :snap="lgUp"
            class="min-h-0 min-w-0 flex-1 max-lg:flex-none lg:scroll-pb-12"
            data-test="add-alert-sections"
          >
            <AlertFormSection
              v-if="!watchCollapsed"
              id="watch"
              :current="activeSection === 'watch'"
              :sections="formSections"
              :title="t('alerts.sections.watch.title')"
              :help="t('alerts.sections.watch.help')"
              @go="goToSection"
            >
              <template v-if="showsLibraryLink" #tools>
                <i18n-t
                  keypath="alerts.form.watch.library"
                  tag="span"
                  scope="global"
                  class="text-text-secondary text-xs whitespace-nowrap"
                  data-test="add-alert-library-line"
                >
                  <template #link>
                    <OButton
                      variant="link"
                      size="xs"
                      data-test="add-alert-library-link"
                      @click="goToAlertLibrary"
                      >{{ t("alerts.form.watch.libraryLink") }}</OButton
                    >
                  </template>
                </i18n-t>
              </template>
              <p
                v-if="isEditing"
                class="text-text-secondary m-0 flex items-center gap-1 pt-2.5 pb-2 text-sm"
                data-test="add-alert-watch-locked"
              >
                <OIcon name="lock" size="xs" />
                {{ t("alerts.form.watch.locked") }}
              </p>
              <div class="[container-type:inline-size] [container-name:stream-config]">
                <div
                  class="border-border-default flex items-center gap-0 border-b py-2.5"
                  data-test="add-alert-how-it-checks-row"
                >
                  <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
                  <span
                    class="text-compact me-3 shrink-0 font-semibold tracking-[0.01em] whitespace-nowrap"
                    >{{ t("alerts.alertType") }}</span
                  >
                  <OToggleGroup
                    :model-value="formData.is_real_time"
                    :disabled="beingUpdated || anomalyEditMode"
                    class="min-w-0"
                    mobile-dropdown
                    data-test="add-alert-type-tabs"
                    @update:model-value="onAlertTypeChange($event as string)"
                  >
                    <OToggleGroupItem
                      v-for="option in alertTypeOptions"
                      :key="option.value"
                      :value="option.value"
                      size="sm"
                      :disabled="option.disabled"
                      :focusable-unavailable="option.disabled"
                      :tooltip="option.description"
                      :data-test="option.dataTest"
                    >
                      <template #icon-left>
                        <OIcon
                          :name="option.disabled ? 'lock' : option.icon!"
                          size="sm"
                          :class="!option.disabled && '@max-lg/stream-config:hidden'"
                        />
                      </template>
                      {{ option.label }}
                    </OToggleGroupItem>
                  </OToggleGroup>
                </div>
                <div v-if="!isCompositeMode" data-test="add-alert-source-card" data-snap-stop>
                  <div class="flex items-center gap-4 py-2 max-md:flex-wrap max-md:gap-2">
                    <div class="flex items-center gap-1.5">
                      <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                        {{ t("alerts.streamType") }} <span class="text-text-body">*</span>
                      </div>
                      <!-- eslint-disable local/no-hardcoded-px -- query condition: a threshold for WHEN layout changes, not a rendered length -->
                      <OFormSelect
                        ref="streamTypeRef"
                        name="stream_type"
                        :aria-label="t('alerts.streamType')"
                        data-test="add-alert-stream-type-select-dropdown"
                        :options="streamTypeOptions"
                        :searchable="false"
                        class="stream-type-select w-37.5! @max-[900px]/stream-config:w-27.5! @max-[600px]/stream-config:w-25!"
                        :disabled="beingUpdated || anomalyEditMode"
                        @update:model-value="onStreamTypeChange"
                      />
                      <!-- eslint-enable local/no-hardcoded-px -->
                    </div>
                    <div class="flex min-w-0 flex-1 items-center gap-1.5 max-md:basis-full">
                      <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                        {{ t("alerts.stream_name") }} <span class="text-text-body">*</span>
                      </div>
                      <OFormSelect
                        ref="streamNameRef"
                        name="stream_name"
                        :aria-label="t('alerts.stream_name')"
                        data-test="add-alert-stream-name-select-dropdown"
                        :options="streamPickerOptions"
                        :search-placeholder="
                          formData.stream_type === 'metrics'
                            ? t('alerts.discovery.metricSearch')
                            : undefined
                        "
                        :loading="isFetchingStreams"
                        class="w-full! max-w-75 min-w-0"
                        :disabled="beingUpdated || anomalyEditMode || !formData.stream_type"
                        @update:model-value="updateStreamFields($event)"
                      >
                        <template #option="{ option }">
                          <AlertStreamOption :option="option" />
                        </template>
                      </OFormSelect>
                      <OTooltip
                        v-if="!formData.stream_type"
                        :content="t('alerts.selectStreamTypeFirst')"
                      />
                    </div>
                  </div>
                  <AlertStreamContents
                    v-if="formData.stream_name && !isAnomalyMode"
                    :stream-name="formData.stream_name"
                    :stream-type="formData.stream_type"
                    @insert="onMetricLabelInsert"
                  />
                </div>
              </div>
              <AlertIntentStart
                v-if="showsIntentStart"
                :stream-type="formData.stream_type"
                :stream-name="formData.stream_name"
                :columns="originalStreamFields"
                :metric-streams="schemaList"
                :period-minutes="Number(formData.trigger_condition.period) || 10"
                :anomaly-available="isAnomalyDetectionEnabled && !anomalyLicenseLocked"
                :org-alert-count="orgAlertCount"
                :show-library="showsLibraryLink"
                :active="appliedIntent?.fill?.intent ?? pendingIntent"
                :applied="!!appliedIntent"
                :how-it-checks="String(formData.is_real_time)"
                data-snap-stop
                @apply="applyIntent"
                @pending="onIntentPending"
                @use-suggestion="applySuggestion"
                @scratch="startFromScratch"
                @open-alert="openExistingAlert"
                @update:period="setLookBack"
                @threshold="sentenceThreshold = true"
              >
                <template #defaults>
                  <AlertDefaultsLine :defaults="saveDefaults" :name="defaultsName" />
                </template>
              </AlertIntentStart>
            </AlertFormSection>

            <AlertFormSection
              id="condition"
              :current="activeSection === 'condition'"
              :sections="formSections"
              :title="t('alerts.sections.condition.title')"
              :help="conditionHelp"
              @go="goToSection"
            >
              <template v-if="watchCollapsed" #lead>
                <p
                  class="text-text-body m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                  data-test="add-alert-watch-summary"
                >
                  <span>{{ watchSummary }}</span>
                  <OTag
                    v-if="appliedIntent"
                    variant="default-soft"
                    size="xs"
                    :label="t('alerts.intent.fromIntent', { intent: appliedIntent.label })"
                    data-test="add-alert-watch-summary-intent"
                  />
                  <OButton
                    variant="link"
                    data-test="add-alert-watch-summary-change"
                    @click="expandWatch"
                    >{{ t("alerts.form.change") }}</OButton
                  >
                </p>
              </template>
              <div data-test="add-alert-query-card" data-snap-stop>
                <CompositeAlertForm
                  v-if="isCompositeMode"
                  :model-value="formData"
                  :org-identifier="store.state.selectedOrganization.identifier"
                  :folder-id="activeFolderId as string"
                  :available-children="availableCompositeChildren"
                  :section-targets="sectionTargets"
                  @update:model-value="updateCompositeDraft"
                  @validation="onCompositeValidation"
                />
                <QueryConfig
                  v-else
                  v-show="!isAnomalyMode"
                  ref="step2Ref"
                  :section-targets="sectionTargets"
                  :tab="formData.query_condition.type || 'custom'"
                  :multiTimeRange="formData.query_condition.multi_time_range"
                  :columns="filteredColumns"
                  :streamFieldsMap="streamFieldsMap"
                  :generatedSqlQuery="generatedSqlQuery"
                  :inputData="formData.query_condition"
                  :streamType="formData.stream_type"
                  :isRealTime="formData.is_real_time"
                  :sqlQuery="formData.query_condition.sql"
                  :promqlQuery="formData.query_condition.promql"
                  :preview-value-range="previewValueRange"
                  :vrlFunction="decodedVrlFunction"
                  :streamName="formData.stream_name"
                  :sqlQueryErrorMsg="sqlQueryErrorMsg"
                  :sqlAggColumnOptions="sqlAggColumnOptions"
                  :sqlQueryHasHaving="sqlQueryHasHaving"
                  :promqlStreamNote="promqlStreamNote"
                  :isAggregationEnabled="isAggregationEnabled"
                  :beingUpdated="beingUpdated"
                  :isSeeding="isLoadingPrefill"
                  :promqlCondition="formData.query_condition.promql_condition"
                  :triggerCondition="formData.trigger_condition"
                  @update:tab="updateTab"
                  @input:update="onInputUpdate"
                  @update:sqlQuery="updateSqlQuery"
                  @update:promqlQuery="updatePromqlQuery"
                  @update:vrlFunction="updateVrlFunction"
                  @validate-sql="validateSqlQuery"
                  @clear-multi-windows="clearMultiWindows"
                  @editor-closed="handleEditorClosed"
                  @editor-state-changed="handleEditorStateChanged"
                  @update:isAggregationEnabled="(value) => (isAggregationEnabled = value)"
                  @update:aggregation="updateAggregation"
                  @update:promqlCondition="updatePromqlCondition"
                  @update:triggerCondition="updateTriggerCondition"
                  @update:period="setLookBack"
                />
                <AnomalyDetectionConfig
                  v-show="isAnomalyMode"
                  ref="anomalyStep2Ref"
                  :config="anomalyConfig"
                  :preview-sql="anomalyPreviewSql"
                  :stored-intervals="anomalyStoredIntervals"
                  :stored-sql-function="anomalyStoredSqlFunction"
                  :section-targets="sectionTargets"
                />
              </div>
              <AlertSuggestionLine section="condition" anchor="query" />
              <div class="flex flex-col" data-snap-stop>
                <OSettingRow
                  v-if="showsConditionPresets"
                  :label="t('alerts.sections.presets.label')"
                  fill
                  wide
                  data-test="add-alert-condition-presets"
                >
                  <OToggleGroup
                    :model-value="activeConditionPreset"
                    :aria-label="t('alerts.sections.presets.label')"
                    class="min-w-0 flex-wrap self-start"
                    @update:model-value="applyConditionPreset($event as string)"
                  >
                    <OToggleGroupItem
                      v-for="option in conditionPresetOptions"
                      :key="option.value"
                      :value="option.value"
                      size="sm"
                      :tooltip="option.description"
                      :data-test="option.dataTest"
                    >
                      {{ option.label }}
                    </OToggleGroupItem>
                  </OToggleGroup>
                </OSettingRow>
                <OSettingRow
                  v-if="formData.is_real_time === 'true'"
                  :label="t('alerts.groups.schedule')"
                  wide
                  data-test="add-alert-schedule-note"
                >
                  <span class="text-text-body text-sm">{{
                    t("alerts.form.schedule.realtime")
                  }}</span>
                </OSettingRow>
                <div ref="compareLeadRef" class="empty:hidden" />
                <div
                  v-show="!isAnomalyMode && !isCompositeMode"
                  :ref="(el) => setSectionTarget('queryCondition', el)"
                  class="empty:hidden"
                  data-test="add-alert-query-condition-slot"
                  data-snap-stop
                />
                <AlertBacktest
                  v-if="showsBacktest"
                  :query="backtestQuery"
                  :stream-type="formData.stream_type"
                  :period="Number(formData.trigger_condition.period)"
                  :operator="formData.trigger_condition.operator"
                  :threshold="Number(formData.trigger_condition.threshold)"
                  :trigger-condition="formData.trigger_condition"
                  :real-time="formData.is_real_time === 'true'"
                  :compares="!!formData.query_condition?.multi_time_range?.length"
                />
                <div
                  v-show="isCompositeMode"
                  :ref="(el) => setSectionTarget('compositeCondition', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <OSettingRow
                  v-if="isCompositeMode"
                  :label="t('alerts.groups.schedule')"
                  wide
                  data-test="add-alert-schedule-note"
                >
                  <span class="text-text-body text-sm">{{
                    t("alerts.form.schedule.composite")
                  }}</span>
                </OSettingRow>
                <div
                  v-show="isAnomalyMode"
                  :ref="(el) => setSectionTarget('anomalyCondition', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div
                  v-show="isAnomalyMode"
                  :ref="(el) => setSectionTarget('anomalyTraining', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div
                  v-show="isAnomalyMode"
                  :ref="(el) => setSectionTarget('anomalyConditionMore', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div
                  v-show="!isAnomalyMode"
                  :ref="(el) => setSectionTarget('settingsHold', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <Teleport :to="compareLeadRef" :disabled="!compareLeads || !compareLeadRef">
                  <AlertTierPlace id="compareWithPast">
                    <div
                      v-if="formData.is_real_time === 'false' && tiers.isVisible('compareWithPast')"
                      data-snap-stop
                    >
                      <CompareWithPast
                        ref="step3Ref"
                        :multiTimeRange="formData.query_condition.multi_time_range"
                        :period="formData.trigger_condition.period"
                        :frequency="formData.trigger_condition.frequency"
                        :frequencyType="formData.trigger_condition.frequency_type"
                        :cron="formData.trigger_condition.cron"
                        :selectedTab="formData.query_condition.type || 'custom'"
                        :has-function="!!formData.query_condition.vrl_function?.trim()"
                        @update:multiTimeRange="updateMultiTimeRange"
                      />
                    </div>
                  </AlertTierPlace>
                </Teleport>
                <OSettingRow
                  v-if="formData.is_real_time === 'false' && !isCronSchedule"
                  :label="t('alerts.queryConfig.checkEvery')"
                  fill
                  data-test="add-alert-schedule-row"
                  data-snap-stop
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <div :ref="(el) => setSectionTarget('querySchedule', el)" class="contents" />
                    <div :ref="(el) => setSectionTarget('settingsSchedule', el)" class="contents" />
                  </div>
                </OSettingRow>
                <template v-else>
                  <div
                    v-show="!isAnomalyMode && !isCompositeMode"
                    :ref="(el) => setSectionTarget('querySchedule', el)"
                    class="empty:hidden"
                    data-snap-stop
                  />
                  <div
                    v-show="!isAnomalyMode"
                    :ref="(el) => setSectionTarget('settingsSchedule', el)"
                    class="empty:hidden"
                    data-snap-stop
                  />
                </template>
                <div
                  v-show="isAnomalyMode"
                  :ref="(el) => setSectionTarget('anomalySchedule', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <AlertCheckTimeline
                  v-if="showsCheckTimeline"
                  :frequency="Number(formData.trigger_condition.frequency)"
                  :period="Number(formData.trigger_condition.period)"
                  :forecast-window="checkTimelineForecastWindow"
                  :query-condition="formData.query_condition"
                  :aligned="formData.trigger_condition.align_time !== false"
                />
                <AlertSuggestionLine section="condition" anchor="end" />
                <div
                  :ref="(el) => setSectionTarget('narrowPreview', el)"
                  class="empty:hidden"
                  data-test="add-alert-narrow-preview"
                />
              </div>
              <template #optional>
                <AlertTierLinks
                  section="condition"
                  :view="tiers.view('condition')"
                  @add="onTierAdd"
                  @toggle="tiers.toggle('condition')"
                />
              </template>
            </AlertFormSection>

            <AlertFormSection
              id="notify"
              :current="activeSection === 'notify'"
              :sections="formSections"
              :title="t('alerts.sections.notify.title')"
              :help="t('alerts.sections.notify.help')"
              @go="goToSection"
            >
              <div class="flex flex-col" data-snap-stop>
                <div
                  v-show="!isAnomalyMode"
                  :ref="(el) => setSectionTarget('settingsNotify', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div
                  v-show="!isAnomalyMode"
                  :ref="(el) => setSectionTarget('advancedMessage', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div
                  v-show="!isAnomalyMode"
                  :ref="(el) => setSectionTarget('settingsNotifyMore', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div v-show="isAnomalyMode" data-snap-stop>
                  <AnomalyAlerting
                    :config="anomalyConfig"
                    :section-targets="sectionTargets"
                    :destinations="destinations as (SelectOption & { name: string })[]"
                    @refresh:destinations="$emit('refresh:destinations')"
                  />
                </div>
                <div
                  v-show="!isAnomalyMode"
                  :ref="(el) => setSectionTarget('advancedOncall', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <OSettingRow
                  :label="t('alerts.sections.details.name')"
                  fill
                  data-test="add-alert-details-name-row"
                  data-snap-stop
                >
                  <div class="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
                    <template v-if="beingUpdated || anomalyEditMode">
                      <OTruncatedText
                        class="text-text-body text-sm leading-8.5"
                        data-test="add-alert-details-name-text"
                      >
                        {{ formData.name }}
                      </OTruncatedText>
                    </template>
                    <div
                      v-else
                      ref="step1Ref"
                      class="flex max-w-120 min-w-0 flex-1 basis-64 flex-col gap-1.5"
                      @input="onNameInput"
                      @focusin="onNameFocus"
                      @blur.capture="applySavedName"
                      @keydown.enter="onNameEnter"
                      @focusout="alertAutoName.onCommit(formData.name ?? '')"
                    >
                      <OFormInput
                        name="name"
                        :placeholder="
                          isAnomalyMode
                            ? t('alerts.anomalyNamePlaceholder')
                            : t('alerts.alertNamePlaceholder')
                        "
                        :aria-label="t('alerts.sections.details.name')"
                        data-test="add-alert-details-name-input"
                      >
                        <template #error />
                      </OFormInput>
                      <AlertMessageLine
                        :error="nameFieldError"
                        error-data-test="add-alert-details-name-error"
                        data-test="add-alert-details-name-line"
                      >
                        <span
                          v-if="nameSavedAs"
                          class="text-text-secondary text-xs"
                          data-test="add-alert-details-name-saved-as"
                          >{{ t("alerts.form.names.savesAs", { name: nameSavedAs }) }}</span
                        >
                        <span
                          v-else-if="nameRewrittenFrom"
                          class="text-text-secondary text-xs"
                          data-test="add-alert-details-name-rewritten"
                          >{{ t("alerts.form.names.rewritten") }}</span
                        >
                        <span
                          v-else-if="
                            formData.name &&
                            (alertAutoName.isAuto.value || formData.name === alertNameSuggestion)
                          "
                          class="text-text-secondary text-xs"
                          data-test="add-alert-details-name-auto"
                          >{{ t("alerts.sections.details.autoName") }}</span
                        >
                        <OButton
                          v-else-if="alertNameSuggestion && formData.name !== alertNameSuggestion"
                          class="self-start"
                          variant="link"
                          size="xs"
                          data-test="add-alert-details-name-suggest"
                          @click="alertAutoName.resetToAuto"
                          >{{
                            t("alerts.sections.details.useSuggestion", {
                              name: alertNameSuggestion,
                            })
                          }}</OButton
                        >
                      </AlertMessageLine>
                    </div>
                    <div
                      class="flex min-h-8.5 items-center gap-1.5"
                      data-test="add-alert-details-folder-row"
                    >
                      <span class="text-text-secondary text-sm">{{
                        t("alerts.sections.details.inFolder")
                      }}</span>
                      <div v-if="!isEditing" class="flex items-center">
                        <InlineSelectFolderDropdown
                          variant="inline"
                          :model-value="activeFolderId as string"
                          type="alerts"
                          data-test="add-alert-details-folder-select"
                          @update:model-value="updateActiveFolderId({ value: $event })"
                        />
                      </div>
                      <OTruncatedText
                        v-else
                        class="text-text-body text-sm leading-8.5"
                        data-test="add-alert-details-folder-name"
                      >
                        {{ activeFolderName }}
                      </OTruncatedText>
                    </div>
                  </div>
                </OSettingRow>
                <!-- AlertSettings renders nothing inline in the sectioned editor: every slice lives in a section slot. -->
                <AlertSettings
                  v-show="!isAnomalyMode"
                  ref="step4Ref"
                  :section-targets="sectionTargets"
                  :formData="formData"
                  :isRealTime="formData.is_real_time"
                  :columns="filteredColumns"
                  :isAggregationEnabled="isAggregationEnabled"
                  :destinations="formData.destinations"
                  :recoveryDestinations="formData.recovery_destinations"
                  :formattedDestinations="getFormattedDestinations"
                  :destinationObjects="destinations"
                  :workflows="formData.workflows"
                  :destinationRequired="destinationRequired"
                  @update:trigger="updateTriggerCondition"
                  @update:aggregation="updateAggregation"
                  @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
                  @update:promqlCondition="updatePromqlCondition"
                  @update:destinations="updateDestinations"
                  @update:recoveryDestinations="updateRecoveryDestinations"
                  @refresh:destinations="refreshDestinations"
                  @update:workflows="updateWorkflows"
                />
                <div
                  v-show="isAnomalyMode"
                  :ref="(el) => setSectionTarget('anomalyDetails', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div
                  v-show="!isAnomalyMode"
                  :ref="(el) => setSectionTarget('advancedDetails', el)"
                  class="empty:hidden"
                  data-snap-stop
                />
                <div v-show="!isAnomalyMode" data-snap-stop>
                  <Advanced
                    :section-targets="sectionTargets"
                    :template="formData.template"
                    :templates="templates"
                    :contextAttributes="formData.context_attributes"
                    :description="formData.description"
                    :rowTemplate="formData.row_template"
                    :rowTemplateType="formData.row_template_type"
                    :destinations="destinations"
                    :selectedDestinations="formData.destinations"
                    :alertName="formData.name"
                    :streamName="formData.stream_name"
                    :streamType="formData.stream_type"
                    :triggerCondition="formData.trigger_condition"
                    :streamFields="filteredColumns"
                    @update:template="updateTemplate"
                    @refresh:templates="refreshTemplates"
                    @update:contextAttributes="updateContextAttributes"
                    @update:description="updateDescription"
                    @update:rowTemplate="updateRowTemplate"
                    @update:rowTemplateType="updateRowTemplateType"
                  />
                </div>
                <AlertSuggestionLine section="notify" anchor="end" />
              </div>
              <template #optional>
                <AlertTierLinks
                  section="notify"
                  :view="tiers.view('notify')"
                  @add="onTierAdd"
                  @toggle="tiers.toggle('notify')"
                />
                <OCollapsible
                  :label="t('alerts.sections.review.title')"
                  class="border-border-default border-t"
                  data-test="add-alert-review"
                >
                  <section class="flex flex-col" :aria-label="t('alerts.sections.review.title')">
                    <div
                      v-for="(line, index) in reviewLines"
                      :key="line.id"
                      class="text-compact flex min-w-0 items-center gap-6 py-1 ps-3.5"
                      :class="{ 'border-border-subtle border-t': index > 0 }"
                    >
                      <span
                        class="text-text-body min-w-0 flex-1 break-words"
                        :data-test="`add-alert-review-${line.id}-text`"
                      >
                        <template
                          v-for="(sentence, position) in [line, ...(line.more ?? [])]"
                          :key="sentence.keypath"
                          >{{ position > 0 ? sentenceGap : ""
                          }}<i18n-t
                            :keypath="sentence.keypath"
                            :plural="sentence.plural"
                            tag="span"
                            scope="global"
                          >
                            <template v-for="(part, name) in sentence.parts" :key="name" #[name]>
                              <strong v-if="part.strong" class="text-text-heading font-semibold">{{
                                part.text
                              }}</strong>
                              <template v-else>{{ part.text }}</template>
                            </template>
                          </i18n-t></template
                        >
                      </span>
                      <span class="flex w-18 shrink-0 justify-end">
                        <OButton
                          variant="ghost-primary"
                          size="sm"
                          :data-test="`add-alert-review-${line.id}`"
                          @click="goToSection(line.section)"
                          >{{ t("alerts.form.change") }}</OButton
                        >
                      </span>
                    </div>
                  </section>
                </OCollapsible>
              </template>
            </AlertFormSection>
          </OSnapScroll>
        </div>

        <aside
          class="border-border-default w-83 shrink-0 flex-col overflow-y-auto border-s p-3 max-lg:w-auto max-lg:border-s-0 max-lg:border-t lg:grow"
          :class="railInCondition ? 'hidden' : 'flex'"
          data-test="add-alert-rail"
        >
          <!-- Below lg the steps stack, so the preview moves next to the condition it previews. -->
          <Teleport :to="sectionTargets.narrowPreview" :disabled="!railInCondition">
            <div class="flex flex-col gap-3 max-lg:pt-3" data-test="add-alert-rail-content">
              <div
                v-if="!isCompositeMode"
                class="bg-surface-base border-border-default rounded-surface flex shrink-0 flex-col overflow-hidden border"
              >
                <div
                  class="border-border-default flex h-10 shrink-0 items-center gap-2 border-b px-3 select-none"
                >
                  <span class="text-sm font-medium">{{ t("alerts.preview") }}</span>
                  <div
                    :ref="(el) => setSectionTarget('previewRange', el)"
                    class="ms-auto flex items-center"
                    data-test="add-alert-preview-range-slot"
                  />
                </div>
                <div :class="previewTestOpen ? 'flex min-h-60 flex-col' : 'h-60 min-h-0'">
                  <AnomalyDataPreview v-if="isAnomalyMode" :config="anomalyConfig" />
                  <template v-else>
                    <div
                      v-if="!formData.stream_name"
                      class="flex h-full flex-col items-center justify-center gap-2 px-3"
                    >
                      <OIcon name="query-stats" size="lg" class="opacity-20" />
                      <span class="text-text-secondary text-center text-sm font-medium">
                        {{ t("alerts.previewEmptyState") }}
                      </span>
                    </div>
                    <template v-else>
                      <!-- The preview stays mounted: a PromQL preview only runs from its watchers. -->
                      <div
                        v-if="pendingIntent"
                        class="flex h-full flex-col items-center justify-center gap-2 px-3"
                        data-test="add-alert-preview-intent-pending"
                      >
                        <OIcon name="edit" size="lg" class="opacity-20" />
                        <span class="text-text-secondary text-center text-sm font-medium">
                          {{ t("alerts.intent.previewWaits") }}
                        </span>
                      </div>
                      <PreviewAlert
                        v-show="!pendingIntent"
                        ref="previewAlertRef"
                        class="h-full w-full flex-1"
                        :formData="formData"
                        :query="previewQuery"
                        :selectedTab="formData.query_condition.type || 'custom'"
                        :isAggregationEnabled="isAggregationEnabled"
                        :isUsingBackendSql="isUsingBackendSql"
                        :isEditorOpen="isEditorOpen"
                        :previewDateTime="previewDateTimeValue"
                        :range-target="sectionTargets.previewRange ?? null"
                        labelled-limit
                        @schema-updated="handleSqlSchemaUpdated"
                        @value-range="previewValueRange = $event"
                        @test-open="previewTestOpen = $event"
                      />
                    </template>
                  </template>
                </div>
              </div>
              <div
                v-show="isCompositeMode"
                :ref="(el) => setSectionTarget('compositePreview', el)"
                class="empty:hidden"
              />
              <p
                v-if="railVerdict"
                class="m-0 flex items-start gap-2 text-sm"
                :class="railVerdict.tone === 'fires' ? 'text-text-heading' : 'text-text-body'"
                data-test="add-alert-rail-verdict"
              >
                <OIcon
                  :name="RAIL_VERDICT_ICONS[railVerdict.tone].name"
                  :class="RAIL_VERDICT_ICONS[railVerdict.tone].class"
                  size="sm"
                  class="mt-0.5 shrink-0"
                />
                <span>{{ railVerdict.text }}</span>
              </p>
              <AlertRecentRuns
                v-if="isEditingAlert && editAlertId"
                :alert-id="editAlertId"
                :folder-id="editFolderId"
                :expected-every-minutes="recentChecksExpectedEvery"
                :saved-at="modelValue?.updated_at"
                :is-real-time="formData.is_real_time === 'true'"
              />
            </div>
          </Teleport>
        </aside>
      </div>

      <div
        class="border-border-default flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2.5"
        data-test="add-alert-footer"
      >
        <AlertStepNav :sections="formSections" :active="activeSection" @step="stepToSection" />
        <div class="me-auto flex min-w-0 flex-1 items-center gap-4">
          <AlertUnsavedChanges
            v-if="isEditingAlert"
            :changes="unsavedChanges"
            :disabled="isSubmitting"
            @discard="discardChanges"
          />
          <AlertLookAlike
            v-else-if="!isAnomalyMode && !silentAutoObserveDraft && !viaIncidentDraft"
            :stream-type="formData.stream_type"
            :stream-name="formData.stream_name"
            :query-condition="formData.query_condition"
            @open="openExistingAlert"
          />
          <p
            v-if="silentAutoObserveDraft"
            class="text-status-error-text flex min-w-0 items-start gap-1.5 text-xs"
            data-test="add-alert-no-destination"
          >
            <OIcon name="error" size="xs" class="mt-0.5 shrink-0" />
            <span
              >{{ unreachableLine(t, reachGap, 1) }}
              <OButton
                v-if="reachGap === 'noTeam'"
                variant="ghost-primary"
                size="xs"
                icon-right="arrow-forward"
                data-test="add-alert-setup-oncall"
                @click="openOncallSetup()"
                >{{ t("alerts.reach.setUpOncall") }}</OButton
              >
              <OButton
                v-if="reachGap === 'noTeam'"
                variant="ghost-primary"
                size="xs"
                :loading="checkingReach"
                data-test="add-alert-check-oncall"
                @click="checkOncallAgain()"
                >{{ t("alerts.reach.checkAgain") }}</OButton
              ></span
            >
          </p>
          <p
            v-else-if="viaIncidentDraft"
            class="text-text-secondary min-w-0 text-xs"
            data-test="add-alert-via-incident"
          >
            {{ viaIncidentLine(t, 1) }}
          </p>
        </div>
        <p
          v-if="issueSections && !silentAutoObserveDraft"
          class="text-status-error-text m-0 flex min-w-0 items-start gap-1.5 text-xs"
          data-test="add-alert-save-reason"
        >
          <OIcon name="error" size="xs" class="mt-0.5 shrink-0" />
          <i18n-t
            keypath="alerts.form.save.issuesIn"
            tag="span"
            scope="global"
            :plural="issueCount"
          >
            <template #count>{{ issueCount }}</template>
            <template #sections>
              <OButton
                variant="link"
                size="xs"
                data-test="add-alert-save-reason-link"
                @click="goToSaveReason"
                >{{ issueSections }}</OButton
              >
            </template>
          </i18n-t>
        </p>
        <p
          v-else-if="compositeNeedsChildren && !silentAutoObserveDraft"
          class="text-text-secondary m-0 min-w-0 text-xs"
          data-test="add-alert-save-reason"
        >
          <OButton
            variant="link"
            size="xs"
            data-test="add-alert-save-reason-link"
            @click="goToSaveReason"
            >{{ t("alerts.form.save.compositeNeeds") }}</OButton
          >
        </p>
        <p
          v-else-if="firesOnSave && !silentAutoObserveDraft"
          :class="[
            'm-0 flex min-w-0 items-start gap-1.5 text-xs',
            firesOnSave === 'untouched' ? 'text-status-error-text' : 'text-status-warning-text',
          ]"
          data-test="add-alert-fires-on-save"
        >
          <OIcon
            :name="firesOnSave === 'untouched' ? 'error' : 'warning'"
            size="xs"
            class="mt-0.5 shrink-0"
          />
          <span>{{ t("alerts.guard.firesOnSave") }}</span>
        </p>
        <OButton
          data-test="add-alert-cancel-btn"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="cancelEditor"
          >{{ t("alerts.cancel") }}</OButton
        >
        <OButton
          data-test="add-alert-submit-btn"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting || checkingName || (isAnomalyMode && anomalySaving)"
          :disabled="silentAutoObserveDraft"
          class="min-w-28"
          @click="saveAlert"
          >{{ saveLabel }}</OButton
        >
      </div>
    </OPageLayout>
  </OForm>

  <ODrawer
    data-test="add-alert-json-editor-drawer"
    bleed
    v-model:open="showJsonEditorDialog"
    size="lg"
    :title="t('alerts.editJson')"
    persistent
  >
    <JsonEditor
      :data="jsonEditorData"
      :title="t('alerts.editJson')"
      :type="'alerts'"
      :validation-errors="validationErrors"
      @close="showJsonEditorDialog = false"
      @saveJson="saveAlertJson"
      :isEditing="beingUpdated"
    />
  </ODrawer>

  <ODialog
    data-test="alert-save-mode-dialog"
    v-model:open="saveModeDialogOpen"
    size="sm"
    :title="t('alerts.saveModeDialog.title')"
    persistent
    :show-close="false"
    :secondary-button-label="t('alerts.cancel')"
    :primary-button-label="
      t('alerts.saveModeDialog.saveWithMode', { mode: queryModeName(saveModePick) })
    "
    @click:secondary="saveModeDialogOpen = false"
    @click:primary="saveWithPickedMode"
  >
    <div class="flex flex-col gap-3 text-sm">
      <p data-test="alert-save-mode-lead">{{ saveModeLead }}</p>
      <OToggleGroup v-model="saveModePick" class="self-start" data-test="alert-save-mode-options">
        <OToggleGroupItem
          v-for="mode in saveModeChoices ?? []"
          :key="mode"
          :value="mode"
          size="sm"
          :data-test="`alert-save-mode-option-${mode}`"
        >
          <template #icon-left>
            <OIcon v-if="mode === 'custom'" name="build" size="sm" />
            <OIcon v-else-if="mode === 'sql'" name="database" size="sm" />
            <OIcon v-else name="show-chart" size="sm" />
          </template>
          {{ queryModeName(mode) }}
        </OToggleGroupItem>
      </OToggleGroup>
      <p v-if="saveModeInfo" class="text-status-warning-text" data-test="alert-save-mode-warning">
        {{ saveModeInfo }}
      </p>
      <p class="text-text-secondary text-xs" data-test="alert-save-mode-note">
        {{ saveModeNote }}
      </p>
    </div>
  </ODialog>

  <EditorDraftDialogs :draft="alertDraft" />
</template>

<script lang="ts">
import { raw, type I18nText } from "@/types/i18n";
import { getIntlLocale } from "@/locales";
import {
  defineComponent,
  computed,
  watch,
  provide,
  ref,
  reactive,
  onMounted,
  onBeforeUnmount,
  nextTick,
  shallowRef,
} from "vue";
import { useStore } from "vuex";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

import JsonEditor from "../common/JsonEditor.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Advanced from "./steps/Advanced.vue";
import InlineSelectFolderDropdown from "../common/sidebar/InlineSelectFolderDropdown.vue";
import PreviewAlert from "./PreviewAlert.vue";
import AnomalyDetectionConfig from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.vue";
import AnomalyDataPreview from "@/components/anomaly_detection/AnomalyDataPreview.vue";
import AnomalyAlerting from "@/components/anomaly_detection/steps/AnomalyAlerting.vue";
import {
  useAlertForm,
  defaultAlertValue,
  isSixFieldCron,
  seedFormFromPrefill,
  type AlertFormEmit,
} from "@/composables/useAlertForm";
import { useAlertEditorDraft } from "@/composables/alerts/useAlertEditorDraft";
import { useCalibrationHandoff } from "@/composables/alerts/useCalibrationHandoff";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import {
  anomalyNoticeBadgeKeys,
  anomalyCanCheckDataNow,
  isAnomalyDataReadinessStatus,
} from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.schema";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useAutoName } from "@/composables/useAutoName";
import { buildAlertAutoName } from "@/utils/autoName";
import { savedAlertName, suggestedAlertName, unusedAlertName } from "@/utils/alerts/alertName";
import { useQuery as useServerQuery } from "@tanstack/vue-query";
import { alertsListQuery } from "@/services/alerts.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import CompositeAlertForm from "./composite/CompositeAlertForm.vue";
import { childOptionsFrom } from "./composite/expression";
import alertsService from "@/services/alerts";
import OSnapScroll from "@/lib/core/SnapScroll/OSnapScroll.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OSectionNav from "@/lib/navigation/SectionNav/OSectionNav.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import type { ChoiceCardOption } from "@/lib/forms/ChoiceCards/OChoiceCards.types";
import AlertStreamContents from "./AlertStreamContents.vue";
import AlertStreamOption from "./AlertStreamOption.vue";
import AlertIntentStart from "./AlertIntentStart.vue";
import AlertDefaultsLine from "./AlertDefaultsLine.vue";
import AlertLookAlike from "./AlertLookAlike.vue";
import AlertMessageLine from "./AlertMessageLine.vue";
import {
  carriedThreshold,
  compareFactor,
  type IntentFill,
  type IntentId,
} from "@/utils/alerts/alertIntents";
import type { AlreadySetUp, LibrarySuggestion } from "@/utils/alerts/librarySuggest.types";
import type { ValueRange } from "@/utils/alerts/ratioThreshold";
import { buildPrefillFromSuggestion } from "@/utils/alerts/prefill/fromLibrary";
import { withPackTag } from "@/components/alertLibrary/libraryInstall";
import {
  insertLabelIntoPromql,
  recentActivity,
  recentStreams,
  streamOptions,
  useStreamDays,
} from "@/composables/alerts/useStreamDiscovery";
import AlertCheckTimeline from "./AlertCheckTimeline.vue";
import AlertBacktest from "./AlertBacktest.vue";
import { replaysDay } from "@/utils/alerts/alertBacktest";
import { provideAlertTestRun } from "@/composables/alerts/useAlertTestRun";
import { generateSqlQuery } from "@/utils/alerts/alertQueryBuilder";
import { getCronIntervalDifferenceInSeconds, isAboveMinRefreshInterval } from "@/utils/queryUtils";
import OCommandSearch from "@/lib/forms/CommandSearch/OCommandSearch.vue";
import {
  isAnomalyFindId,
  isAnomalyOnlyFindId,
  isTieredSetting,
  type AlertFindId,
} from "./alertSettingFind";
import { useAlertSettingFind } from "@/composables/alerts/useAlertSettingFind";
import AlertFormSection from "./AlertFormSection.vue";
import AlertStepNav from "./AlertStepNav.vue";
import { focusFirstControl } from "@/utils/focusNextControl";
import AlertTierLinks from "./AlertTierLinks.vue";
import AlertTierPlace from "./AlertTierPlace.vue";
import AlertSuggestionLine from "./AlertSuggestionLine.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import {
  alertTierContext,
  tierApplies as tierAppliesIn,
  tierIsSet as tierIsSetIn,
  type AlertSettingId,
} from "./alertSettingTiers";
import {
  ALERT_SETTING_TIERS_KEY,
  useAlertSettingTiers,
} from "@/composables/alerts/useAlertSettingTiers";
import { useShowAllSettings } from "@/composables/alerts/useShowAllSettings";
import {
  ALERT_BACKTEST_SIGNAL_KEY,
  ALERT_SUGGESTIONS_KEY,
  useAlertSuggestions,
} from "@/composables/alerts/useAlertSuggestions";
import {
  RESOLVING_PLATFORMS,
  type BacktestSignal,
  type SuggestionContext,
} from "./alertSuggestions";
import { ALERT_FORM_CONTEXT_KEY } from "./alertFormContext";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import { previewVerdictSentence } from "@/utils/alerts/alertReadBack";
import { dataNoun, forecastWindowWords } from "@/utils/alerts/alertCopy";
import { countCompleteConditions } from "@/utils/alerts/alertCondition";
import config from "@/aws-exports";
import { getUUID } from "@/utils/zincutils";
import {
  AGGREGATION_ENABLED_FIELD,
  ALERT_CONDITION_PRESETS,
  conditionPresetFor,
  ALERT_SECTIONS,
  type AlertSectionId,
  type AlertSectionSlot,
  type AlertSectionTargets,
} from "./alertFormSections";
import {
  useAlertFormSections,
  watchedStreamText,
  type AlertDestinationObjects,
} from "@/composables/alerts/useAlertFormSections";
import { shownFieldError } from "@/composables/alerts/shownFieldError";
import useBreakpoint from "@/composables/useBreakpoint";
import type { OSnapScrollExpose } from "@/lib/core/SnapScroll/OSnapScroll.types";
import AlertEditStatus from "./AlertEditStatus.vue";
import AlertEditActions from "./AlertEditActions.vue";
import AlertUnsavedChanges from "./AlertUnsavedChanges.vue";
import AlertRecentRuns from "./AlertRecentRuns.vue";
import { useAlertEditHeader } from "@/composables/alerts/useAlertEditHeader";
import { useAlertUnsavedChanges } from "@/composables/alerts/useAlertUnsavedChanges";
import { cloneDeep, get } from "lodash-es";
import { unreachableLine, viaIncidentLine } from "@/utils/alerts/deliveryTarget";
import { useOnCallSetup } from "@/composables/useOnCallSetup";
import { getFoldersListByType } from "@/utils/commons";
import { useLicenseLock } from "@/composables/useFeatureLock";

const RAIL_VERDICT_ICONS = {
  fires: { name: "notifications-active", class: "text-status-error-text" },
  quiet: { name: "check-circle", class: "text-status-positive" },
  note: { name: "info", class: "text-text-secondary" },
  warn: { name: "warning", class: "text-status-warning-text" },
} as const;
// A jump has landed once no scroll event has fired for this long (the snap scroller's own settle time).
const JUMP_SETTLE_MS = 150;
const SENTENCE_GAP = raw(" ");

// The focused control stays put when it survives the fold; otherwise the section in view does.
function foldAnchor(active: string): HTMLElement | null {
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    focused.closest("[data-snap-section]") &&
    !focused.closest('[data-snap-section="watch"]')
  ) {
    return focused;
  }
  return document.querySelector<HTMLElement>(`[data-snap-section="${active}"]`);
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return document.scrollingElement as HTMLElement | null;
}

export default defineComponent({
  name: "ComponentAddUpdateAlert",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultAlertValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array,
      default: () => [],
    },
    templates: {
      type: Array,
      default: () => [],
    },
    folderId: {
      type: String,
      default: undefined,
    },
  },
  emits: ["update:list", "cancel:hideform", "refresh:destinations", "refresh:templates"],
  components: {
    OIcon,
    OPageLayout,
    OBanner,
    JsonEditor,
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Advanced,
    PreviewAlert,
    AnomalyDetectionConfig,
    AnomalyDataPreview,
    AnomalyAlerting,
    InlineSelectFolderDropdown,
    OButton,
    OToggleGroup,
    OToggleGroupItem,
    ODrawer,
    ODialog,
    OTag,
    OTooltip,
    OForm,
    OFormInput,
    OFormSelect,
    OPageHeader,
    OTruncatedText,
    CompositeAlertForm,
    EditorDraftDialogs,
    OSnapScroll,
    OSettingRow,
    OSectionNav,
    OCollapsible,
    AlertStepNav,
    AlertStreamContents,
    AlertStreamOption,
    AlertIntentStart,
    AlertDefaultsLine,
    AlertLookAlike,
    AlertMessageLine,
    AlertCheckTimeline,
    AlertBacktest,
    OCommandSearch,
    AlertFormSection,
    AlertTierLinks,
    AlertTierPlace,
    AlertSuggestionLine,
    OSwitch,
    AlertEditStatus,
    AlertEditActions,
    AlertUnsavedChanges,
    AlertRecentRuns,
  },
  setup(props, { emit }) {
    const store = useStore();
    // Bound once the draft exists; a save reports to the draft first, which decides whether the host navigates.
    let onFormSaved: ((folderId?: string) => void) | null = null;
    const formEmit = ((event: string, ...args: unknown[]) => {
      if (event === "update:list" && onFormSaved) {
        onFormSaved(args[0] as string | undefined);
        return;
      }
      emit(event as Parameters<typeof emit>[0], ...args);
    }) as AlertFormEmit;
    const snapScrollRef = ref<OSnapScrollExpose | null>(null);
    // A folded section 1 lives on section 2's summary line; a jump to it reopens it.
    const goToSection = (requested: string) => {
      // A step this alert type drops says its one sentence in step 2.
      const id = formSections.value.some((s) => s.id === requested) ? requested : "condition";
      startJump();
      if (id === "watch" && watchCollapsed.value) {
        expandWatch();
        return;
      }
      snapScrollRef.value?.scrollToSection(id);
    };
    // The footer's Back and Next hand the Tab start to the section's first control, past its header arrows.
    // Focus waits for the landing: a control that scrolls itself into view on focus would stop the glide.
    const stepToSection = (id: AlertSectionId) => {
      focusOnLanding = id;
      goToSection(id);
    };
    // A centred error leaves the previous card's band stuck over its tail; the snap scroller rests on a section stop.
    const alertForm = useAlertForm(props, formEmit, {
      showSection: goToSection,
      revealControl: (el) => snapScrollRef.value?.revealElement(el),
      heldSaveSection: () => (compositeNeedsChildren.value ? "condition" : undefined),
    });
    const alertEditorDraft = useAlertEditorDraft({
      form: alertForm,
      modelValue: () => props.modelValue,
      onSaved: (folderId, options) => emit("update:list", folderId, options),
    });
    const calibrationHandoff = useCalibrationHandoff({
      form: alertForm,
      editorDraft: alertEditorDraft,
      modelValue: () => props.modelValue,
    });
    onFormSaved = (folderId) => {
      void calibrationHandoff.recordSaved();
      alertEditorDraft.handleSaved(folderId);
    };
    // The handoff waits for the restore choice, so a draft decides before any patch lands.
    onMounted(async () => {
      await alertEditorDraft.start();
      await calibrationHandoff.run();
    });

    // A fresh alert arrives with its type and data chosen, so its first action is picking the stream.
    onMounted(async () => {
      await alertForm.formReady;
      const opened = alertForm.router.currentRoute.value.query;
      if (alertForm.beingUpdated.value || alertForm.anomalyEditMode.value) {
        activeSection.value = "condition";
        snapScrollRef.value?.scrollToSection("condition");
        return;
      }
      // On a phone a focused field scrolls the page past the alert type and opens the keyboard.
      if (opened.prefill || !lgUp.value) return;
      await nextTick();
      document
        .querySelector<HTMLElement>(
          '[data-test="add-alert-stream-name-select-dropdown"] [role="combobox"]',
        )
        ?.focus({ preventScroll: true });
    });

    const cancelEditor = async () => {
      if (await alertEditorDraft.draft.confirmLeave()) emit("cancel:hideform");
    };

    // Share server SQL-validation squiggle ranges with the descendant query
    // editors (QueryEditorDialog / QueryConfig) via inject.
    provide("alertSqlErrorRanges", alertForm.sqlErrorRanges);

    // SQL tab's Multi Alert value-column dropdown (sql_simple_multi_alert_fe_prd.md
    // §11): PreviewAlert already calls /result_schema every time the preview
    // query itself fires (its own reactive query watcher / editor-closed
    // refresh) — reuse that response instead of a second, differently-timed
    // fetch. QueryConfig's own watcher on this prop does the actual
    // clear-if-missing comparison; this handler only forwards the list.
    const previewValueRange = ref<ValueRange | null>(null);
    const previewTestOpen = ref(false);
    const handleSqlSchemaUpdated = (payload: { projections: string[]; hasHaving: boolean }) => {
      alertForm.sqlAggColumnOptions.value = payload.projections;
      alertForm.sqlQueryHasHaving.value = payload.hasHaving;
    };

    const isAnomalyDetectionEnabled = computed(
      () => alertForm.store.state.zoConfig.anomaly_detection_enabled === true,
    );
    const { locked: anomalyLicenseLocked, lockedReason: anomalyLockedReason } =
      useLicenseLock("anomaly_detection");

    // §4.8: keyed off the config API's notice_class field alone.
    const anomalyNoticeBadge = computed(() => {
      const keys = anomalyNoticeBadgeKeys(alertForm.anomalyConfig.value.notice_class);
      return keys ? { label: alertForm.t(keys.labelKey as any) } : null;
    });
    const anomalyNoticeTooltip = computed(() => {
      const keys = anomalyNoticeBadgeKeys(alertForm.anomalyConfig.value.notice_class);
      return raw(keys ? keys.tooltipKeys.map((k) => alertForm.t(k as any)).join(" ") : "");
    });
    const isCompositeMode = computed(() => alertForm.formData.value.is_real_time === "composite");
    const availableCompositeChildren = ref<any[]>([]);

    const loadCompositeChildren = async () => {
      if (!isCompositeMode.value) return;
      try {
        const response = await alertsService.listByFolderId(
          0,
          1000,
          "name",
          false,
          "",
          alertForm.store.state.selectedOrganization.identifier,
          undefined,
          "",
          "all",
        );
        const rows = Array.isArray(response.data?.list) ? response.data.list : [];
        availableCompositeChildren.value = childOptionsFrom(rows);
      } catch {
        availableCompositeChildren.value = [];
      }
    };

    const updateCompositeDraft = (draft: any) => {
      alertForm.setF("composite_condition", draft.composite_condition);
      alertForm.setF("children", draft.children ?? []);
    };

    // Composite drafts validate asynchronously against the server; until the form
    // reports a valid expression, Save holds and names the reason beside it.
    const compositeValidation = ref<{ valid: boolean }>({ valid: false });
    const { silentAutoObserveDraft, destinationRequired, viaIncidentDraft, reachGap } = alertForm;
    const onCompositeValidation = (value: { valid: boolean }) => {
      compositeValidation.value = value;
    };

    watch(
      isCompositeMode,
      (enabled) => {
        if (!enabled) return;
        // Fresh draft → re-validate before the button can re-enable on a stale
        // `valid` from a previous visit to composite mode.
        compositeValidation.value = { valid: false };
        loadCompositeChildren();
      },
      { immediate: true },
    );

    // Auto-expand preview when stream name is selected, collapse when cleared
    watch(
      () => alertForm.formData.value.stream_name,
      (newVal) => {
        alertForm.chartCollapsed.value = !newVal;
      },
    );

    const activeEvaluationStatus = computed(
      () => alertForm.previewAlertRef.value?.evaluationStatus || null,
    );
    const alertTypeOptions = computed<ChoiceCardOption[]>(() => [
      {
        label: alertForm.t("alerts.scheduled"),
        description: alertForm.t("alerts.sections.typeHelp.scheduled"),
        value: "false",
        icon: "schedule",
        dataTest: "add-alert-type-tab-false",
      },
      {
        label: alertForm.t("alerts.realTime"),
        description: alertForm.t("alerts.sections.typeHelp.realtime"),
        value: "true",
        icon: "bolt",
        dataTest: "add-alert-type-tab-true",
      },
      ...(isAnomalyDetectionEnabled.value || anomalyLicenseLocked.value
        ? [
            {
              label: alertForm.t("alerts.anomalyDetection"),
              description: anomalyLicenseLocked.value
                ? anomalyLockedReason.value
                : alertForm.t("alerts.sections.typeHelp.anomaly"),
              value: "anomaly",
              icon: anomalyLicenseLocked.value ? ("lock" as const) : ("query-stats" as const),
              disabled: anomalyLicenseLocked.value,
              dataTest: "add-alert-type-tab-anomaly",
            },
          ]
        : []),
      ...(alertForm.store.state.zoConfig.composite_alerts_available === true ||
      isCompositeMode.value
        ? [
            {
              label: alertForm.t("alerts.compositeAlert"),
              description: alertForm.t("alerts.sections.typeHelp.composite"),
              value: "composite",
              icon: "account-tree" as const,
              dataTest: "add-alert-type-tab-composite",
            },
          ]
        : []),
    ]);

    const streamTypeOptions = computed<SelectOption[]>(() =>
      (["logs", "metrics", "traces"] as const).map((type) => ({
        label: alertForm.t(`alerts.sections.dataTypes.${type}.label`),
        value: type,
      })),
    );

    // Raw split (no trim), the same rule the alert list hides its Library button by.
    const showsLibraryLink = computed(
      () =>
        !alertForm.beingUpdated.value &&
        !alertForm.anomalyEditMode.value &&
        !(store.state.zoConfig?.custom_hide_menus ?? "").split(",").includes("alertLibrary"),
    );
    const goToAlertLibrary = () =>
      alertForm.router.push({
        name: "alertLibrary",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });

    // A preset writes an event count, so it only fits a scheduled builder alert being created.
    const showsConditionPresets = computed(() => {
      const fd = alertForm.formData.value;
      return (
        !alertForm.beingUpdated.value &&
        fd.is_real_time === "false" &&
        (fd.query_condition?.type || "custom") === "custom" &&
        !alertForm.isAggregationEnabled.value
      );
    });
    // A typed limit no card fits gets its own selected card, so the cards never read as unset.
    const activeConditionPreset = computed(() =>
      conditionPresetFor(alertForm.formData.value.trigger_condition),
    );
    const conditionPresetOptions = computed<ChoiceCardOption[]>(() => [
      ...ALERT_CONDITION_PRESETS.map((preset) => ({
        value: preset.id,
        label: alertForm.t(preset.labelKey, {
          noun: dataNoun(alertForm.formData.value.stream_type, "custom", 1, alertForm.t),
        }),
        description: alertForm.t("alerts.sections.presets.orMore", { count: preset.threshold }),
        dataTest: `add-alert-condition-preset-${preset.id}`,
      })),
      ...(activeConditionPreset.value === "custom"
        ? [
            {
              value: "custom",
              label: alertForm.t("alerts.form.presets.custom"),
              description: alertForm.t("alerts.sections.presets.orMore", {
                count: Number(alertForm.formData.value.trigger_condition?.threshold),
              }),
              dataTest: "add-alert-condition-preset-custom",
            },
          ]
        : []),
    ]);
    const applyConditionPreset = (id: string) => {
      const preset = ALERT_CONDITION_PRESETS.find((candidate) => candidate.id === id);
      if (!preset) return;
      alertForm.setF("trigger_condition.operator", ">=");
      alertForm.setF("trigger_condition.threshold", preset.threshold);
    };

    const showsBacktest = computed(() =>
      replaysDay(alertForm.formData.value, alertForm.isAggregationEnabled.value),
    );

    // Test it's answer stays in its panel: a row it added here would push the form down under the user.
    provideAlertTestRun();

    const backtestQuery = computed(() =>
      generateSqlQuery(
        alertForm.formData.value,
        alertForm.streamFieldsMap.value,
        false,
        store.state.zoConfig.timestamp_column || "_timestamp",
      ),
    );

    const showsCheckTimeline = computed(() => {
      const fd = alertForm.formData.value;
      return fd.is_real_time === "false" && fd.trigger_condition?.frequency_type !== "cron";
    });

    // Mode as the subtitle, exactly as AddPanel does it ("Add Panel" / "Edit
    // Panel"): the header then reads NAME first, what-you're-doing second, and
    // the two pages have the same shape. The containing folder is already the
    // back button's label, so the subtitle no longer repeats it.
    const headerModeLabel = computed(() => {
      const editing = alertForm.beingUpdated.value || alertForm.anomalyEditMode.value;
      return editing ? alertForm.t("alerts.editAlertMode") : alertForm.t("alerts.addAlertMode");
    });

    const activeFolderName = computed(() => {
      const folders = alertForm.store.state.organizationData.foldersByType?.alerts ?? [];
      const found = folders.find((f: any) => f.folderId === alertForm.activeFolderId.value);
      return found?.name ?? "default";
    });
    // Opened straight from an alert's page, the folder list may not be loaded, which read as "default".
    onMounted(() => {
      const folders = alertForm.store.state.organizationData.foldersByType?.alerts ?? [];
      const id = alertForm.activeFolderId.value;
      if (id && id !== "default" && !folders.some((f: any) => f.folderId === id)) {
        void getFoldersListByType(alertForm.store, "alerts").catch(() => undefined);
      }
    });

    const goBackToAlertsList = () => {
      return alertForm.router.push({
        path: "/alerts",
        query: {
          folder: alertForm.activeFolderId.value ?? "default",
          tab: alertForm.router.currentRoute.value.query.tab,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const {
      openSetup: openOncallSetup,
      checkAgain: checkOncallAgain,
      checking: checkingReach,
    } = useOnCallSetup();

    // Stream-type change: write the value into the ONE form explicitly (so the
    // synchronous form store is current before updateStreams reads it — not
    // relying on the OFormSelect field-change flush order), then refresh streams
    // (which also resets stream_name via setF).
    const onStreamTypeChange = (value: any) => {
      alertForm.setF("stream_type", value);
      alertForm.updateStreams();
    };

    // Alert type is not an OFormSelect, so it writes the form directly.
    const onAlertTypeChange = (value: unknown) => {
      if (value === "anomaly" && anomalyLicenseLocked.value) return;
      alertForm.setF("is_real_time", value);
      // Realtime runs Builder only. The query text and Compare-with-Past windows
      // stay in the form for a switch back; the payload never sends windows here.
      if (value === "true" && alertForm.formData.value.query_condition?.type !== "custom") {
        alertForm.setF("query_condition.type", "custom");
      }
    };

    const { lgUp, xlUp } = useBreakpoint();
    const activeSection = ref<AlertSectionId>("watch");
    const visitedSections = ref<ReadonlySet<AlertSectionId>>(new Set());
    // A threshold typed in the step-1 sentence is the user's, as one typed in step 2 is.
    const sentenceThreshold = ref(false);
    const leftWatch = ref(false);
    const foldDue = ref(false);
    // A jump glides past section 2; folding section 1 mid-glide would cut it short, so the fold waits until scrolling stops.
    const jumping = ref(false);
    let jumpSettle: ReturnType<typeof setTimeout> | undefined;
    const foldWhenDue = () => {
      if (foldDue.value && !jumping.value) {
        foldDue.value = false;
        leftWatch.value = true;
      }
    };
    let focusOnLanding: AlertSectionId | null = null;
    const endJump = () => {
      jumping.value = false;
      foldWhenDue();
      const id = focusOnLanding;
      focusOnLanding = null;
      if (!id) return;
      // The card, not the folded summary line above it, holds the section's first field.
      // A locked section 1 on edit has no enabled field, so its heading takes focus.
      void nextTick(() => {
        const card = document.querySelector<HTMLElement>(
          `[data-test="add-alert-section-${id}-card"]`,
        );
        if (card && !focusFirstControl(card, "[data-snap-sticky]")) {
          card.querySelector<HTMLElement>("[data-snap-heading]")?.focus({ preventScroll: true });
        }
      });
    };
    const onJumpScroll = () => {
      if (!jumping.value) return;
      clearTimeout(jumpSettle);
      jumpSettle = setTimeout(endJump, JUMP_SETTLE_MS);
    };
    const startJump = () => {
      jumping.value = true;
      onJumpScroll();
    };
    onMounted(() =>
      document.addEventListener("scroll", onJumpScroll, { capture: true, passive: true }),
    );
    onBeforeUnmount(() => {
      document.removeEventListener("scroll", onJumpScroll, { capture: true });
      clearTimeout(jumpSettle);
    });
    const focusMovedOn = () =>
      !!document.activeElement?.closest('[data-snap-section]:not([data-snap-section="watch"])');
    watch(activeSection, (now, left) => {
      if (now === "notify") nameDue.value = true;
      visitedSections.value = new Set([...visitedSections.value, left]);
      if (now === "watch") foldDue.value = false;
      // Scrolling past section 1 keeps it open; a jump, or focus moving on from it, folds it.
      else if (
        alertForm.formData.value.stream_name &&
        (jumping.value || (left === "watch" && focusMovedOn()))
      )
        foldDue.value = true;
      foldWhenDue();
    });

    const isEditing = computed(
      () => alertForm.beingUpdated.value || alertForm.anomalyEditMode.value,
    );
    // An edit keeps section 1 open, read-only: it cannot change, but it stays one jump away.
    const watchCollapsed = computed(() => !isEditing.value && leftWatch.value);
    const editNameInDetails = () => {
      goToSection("notify");
      void nextTick(() =>
        document
          .querySelector<HTMLElement>('[data-test="add-alert-details-name-input"] input')
          ?.focus({ preventScroll: true }),
      );
    };
    const expandWatch = () => {
      foldDue.value = false;
      leftWatch.value = false;
      void nextTick(() => snapScrollRef.value?.scrollToSection("watch"));
    };
    // Folding removes content above the view; scrolling back by the shift holds the view and focus still.
    // A view resting on a section's start stays on it, since the summary line lands atop that section.
    watch(watchCollapsed, (folded) => {
      if (!folded) return;
      const anchor = foldAnchor(activeSection.value);
      if (!anchor) return;
      const section = anchor.closest<HTMLElement>("[data-snap-section]") ?? anchor;
      const scroller = scrollParent(section);
      if (!scroller) return;
      const viewTop = () => scroller.getBoundingClientRect().top;
      const atStart = Math.abs(section.getBoundingClientRect().top - viewTop()) <= 2;
      const held = atStart ? section : anchor;
      const before = held.getBoundingClientRect().top;
      void nextTick(() => {
        const shift = held.getBoundingClientRect().top - before;
        if (shift) scroller.scrollTop += shift;
      });
    });
    const watchSummary = computed(() => {
      const fd = alertForm.formData.value;
      const how = alertTypeOptions.value.find((o) => o.value === String(fd.is_real_time))?.label;
      if (isCompositeMode.value || !how) return how ?? "";
      const type = streamTypeOptions.value.find((o) => o.value === fd.stream_type)?.label;
      return alertForm.t("alerts.form.watch.summary", {
        type: type ?? raw(fd.stream_type),
        stream: watchedStreamText(fd, alertForm.t),
        how,
      });
    });

    // Filled by template refs after mount; until then every step renders its slices inline.
    const sectionTargets = reactive<AlertSectionTargets>({});
    const setSectionTarget = (slot: AlertSectionSlot, el: unknown) => {
      const next = el instanceof HTMLElement ? el : null;
      if (sectionTargets[slot] !== next) sectionTargets[slot] = next;
    };

    // Anomaly edits keep their own header trail and save path.
    const isEditingAlert = computed(
      () => alertForm.beingUpdated.value && !alertForm.isAnomalyMode.value,
    );
    const editAlertId = computed(() =>
      String(
        alertForm.formData.value?.id ?? props.modelValue?.id ?? props.modelValue?.alert_id ?? "",
      ),
    );
    const editFolderId = computed(() => {
      const id = alertForm.activeFolderId.value;
      return (Array.isArray(id) ? id[0] : id) || undefined;
    });
    // Switching the measure off drops the aggregation from the payload, so the switch is tracked with the values.
    const trackedValues = computed(() => ({
      ...alertForm.formData.value,
      [AGGREGATION_ENABLED_FIELD]: alertForm.isAggregationEnabled.value,
    }));
    const unsaved = useAlertUnsavedChanges({
      values: trackedValues,
      enabled: () => isEditingAlert.value,
      ready: alertForm.formReady,
    });
    const editHeader = useAlertEditHeader({
      alertId: () => (isEditingAlert.value ? editAlertId.value : ""),
      name: () => String(unsaved.baseline.value?.name ?? alertForm.formData.value?.name ?? ""),
      folderId: () => editFolderId.value,
      onEnabledSaved: (enabled) => {
        alertForm.setF("enabled", enabled);
        unsaved.acceptSaved("enabled", enabled);
      },
    });
    const discardChanges = async () => {
      const saved = unsaved.baseline.value;
      if (!saved) return;
      const { [AGGREGATION_ENABLED_FIELD]: aggregationEnabled, ...base } = saved;
      const current = alertForm.formData.value;
      const streamChanged =
        current.stream_type !== base.stream_type || current.stream_name !== base.stream_name;
      alertForm.resetForm(cloneDeep(base));
      alertForm.isAggregationEnabled.value = aggregationEnabled === true;
      // The restored form matches the saved alert, so no stored draft should offer the edits back.
      alertEditorDraft.draft.discard();
      // Steps hold local copies of what they first read, so they remount on the restored values.
      alertEditorDraft.formKey.value += 1;
      if (streamChanged && base.stream_name) {
        await alertForm.updateStreamFields(String(base.stream_name));
      }
    };

    const submitAttempted = alertForm.form.useStore((s) => s.submissionAttempts > 0);
    // These mark a section for the list; the schema counts the field errors behind them.
    const cronSaveProblem = computed(() => {
      const tc = alertForm.formData.value?.trigger_condition;
      if (tc?.frequency_type !== "cron") return false;
      if (!tc.cron || !tc.timezone || !isSixFieldCron(tc.cron)) return true;
      try {
        const seconds = getCronIntervalDifferenceInSeconds(tc.cron);
        return (
          typeof seconds === "number" && !isAboveMinRefreshInterval(seconds, store.state?.zoConfig)
        );
      } catch {
        return true;
      }
    });
    const querySaveProblem = computed(() => {
      const fd = alertForm.formData.value;
      if (fd?.is_real_time !== "false") return false;
      const qc = fd.query_condition ?? {};
      if (qc.type === "sql")
        return !String(qc.sql ?? "").trim() || !!alertForm.sqlQueryErrorMsg.value?.trim();
      if (qc.type === "promql") return !String(qc.promql ?? "").trim();
      return false;
    });
    const sqlCheckFailed = computed(() => {
      const fd = alertForm.formData.value;
      return (
        fd?.is_real_time === "false" &&
        fd.query_condition?.type === "sql" &&
        !!String(fd.query_condition.sql ?? "").trim() &&
        !!alertForm.sqlQueryErrorMsg.value?.trim()
      );
    });
    // Same gate as the incident switch in AlertSettings: a prefilled flag elsewhere opens nothing.
    const incidentsEnabled = computed(
      () =>
        (config.isEnterprise === "true" || config.isCloud === "true") &&
        store.state.zoConfig?.incidents_enabled === true,
    );
    const {
      sections: formSections,
      items: sectionItems,
      errorCounts,
      review: reviewLines,
      defaults: saveDefaults,
    } = useAlertFormSections({
      // The server's SQL check is not a schema rule, so a failed one is counted here.
      extraErrors: computed(() => ({
        condition: submitAttempted.value && sqlCheckFailed.value ? 1 : 0,
      })),
      invalid: computed(() => ({
        condition: !!querySaveProblem.value,
        schedule: !!cronSaveProblem.value,
      })),
      fieldMeta: alertForm.visibleFieldMeta,
      formData: alertForm.formData,
      destinationObjects: computed(() => props.destinations as AlertDestinationObjects),
      anomalyConfig: alertForm.anomalyConfig,
      anomalyStreamDays: useStreamDays(
        () => store.state.selectedOrganization?.identifier ?? "",
        () => (alertForm.isAnomalyMode.value ? String(alertForm.formData.value.stream_type) : ""),
        () => String(alertForm.formData.value.stream_name ?? ""),
      ),
      isAnomalyMode: alertForm.isAnomalyMode,
      isAggregationEnabled: alertForm.isAggregationEnabled,
      isEditing: computed(() => alertForm.beingUpdated.value || alertForm.anomalyEditMode.value),
      incidentsEnabled,
      changedSections: unsaved.sections,
      visited: visitedSections,
      queryFailed: computed(
        () => sqlCheckFailed.value || alertForm.previewAlertRef.value?.queryFailed === true,
      ),
      t: alertForm.t,
    });

    const issueCount = computed(() =>
      Object.values(errorCounts.value).reduce((sum, count) => sum + count, 0),
    );
    const saveLabel = computed(() => {
      if (issueCount.value > 0) {
        return alertForm.t(
          "alerts.form.save.fixIssues",
          { count: issueCount.value },
          issueCount.value,
        );
      }
      if (alertForm.isAnomalyMode.value && !alertForm.anomalyEditMode.value) {
        return alertForm.t("alerts.saveAndTrain");
      }
      return isEditingAlert.value
        ? alertForm.t("alerts.editMode.saveChanges")
        : alertForm.t("alerts.save");
    });
    const compositeNeedsChildren = computed(
      () => isCompositeMode.value && compositeValidation.value.valid !== true,
    );
    // Names beside Save the sections it will not save yet; the link goes where the first fix is.
    const issueSections = computed(() => {
      const titles = sectionItems.value
        .filter((item) => (errorCounts.value[item.id as AlertSectionId] ?? 0) > 0)
        .map((item) => item.title);
      return titles.length
        ? raw(new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(titles))
        : "";
    });
    const goToSaveReason = () => {
      if (issueCount.value > 0) alertForm.focusOnFirstError();
      else goToSection("condition");
    };

    // A real-time alert has no window to count, so the preview offers no verdict to restate.
    const railVerdict = computed<{
      text: string;
      tone: "fires" | "quiet" | "note" | "warn";
    } | null>(() => {
      const status = activeEvaluationStatus.value;
      const fd = alertForm.formData.value;
      if (alertForm.isAnomalyMode.value || !fd.stream_name || pendingIntent.value) return null;
      if (fd.is_real_time === "true") {
        // Every matching event fires, so with no filter every event in the stream does.
        const hasFilter = countCompleteConditions(fd.query_condition?.conditions) > 0;
        return {
          text: previewVerdictSentence(
            status ?? { wouldTrigger: true, reason: "" },
            fd,
            alertForm.t,
            {
              hasFilter,
            },
          ),
          tone: status?.count !== undefined && !hasFilter ? "warn" : "note",
        };
      }
      // The save check is stricter than the preview run, so its error also leaves nothing to judge.
      if (!status || fd.is_real_time !== "false" || sqlCheckFailed.value) return null;
      if (status.note) return { text: status.reason, tone: status.note };
      // Before step 2 the threshold is the form's starter, so the rail states the value, not a verdict.
      const undecided =
        !isEditingAlert.value &&
        !visitedSections.value.has("condition") &&
        activeSection.value !== "condition" &&
        !sentenceThreshold.value;
      if (undecided && (status.grouped || fd.query_condition?.type === "promql")) return null;
      // An empty value threshold leaves nothing to judge; a measured value still helps pick one.
      const noThreshold = alertForm.valueThresholdMissing.value;
      if (noThreshold && status.value === undefined) return null;
      return {
        text: previewVerdictSentence(status, fd, alertForm.t, {
          countsEvents:
            fd.query_condition?.type === "custom" && !alertForm.isAggregationEnabled.value,
          undecided,
        }),
        tone: noThreshold || undecided ? "note" : status.wouldTrigger ? "fires" : "quiet",
      };
    });

    // Red when the threshold that fires is one the form filled in, not one the user chose.
    const firesOnSave = computed<"untouched" | "set" | null>(() => {
      if (isEditingAlert.value || railVerdict.value?.tone !== "fires") return null;
      if (alertForm.valueThresholdMissing.value) return null;
      return alertForm.valueThresholdUntouched.value ? "untouched" : "set";
    });

    const tierContext = computed(() =>
      alertTierContext({
        isRealTime: String(alertForm.formData.value.is_real_time),
        queryType: alertForm.formData.value.query_condition?.type,
        incidentsEnabled: incidentsEnabled.value,
        oncallEnabled: store.state.zoConfig?.oncall_enabled === true,
        suppressRepeatsEnabled: config.isEnterprise === "true" || config.isCloud === "true",
        generatedSql: !!alertForm.generatedSqlQuery.value,
      }),
    );
    const tierValues = () => ({
      form: alertForm.formData.value,
      anomaly: alertForm.isAnomalyMode.value ? alertForm.anomalyConfig.value : null,
    });
    const tierAvailable = (id: AlertSettingId) =>
      tierAppliesIn(id, tierContext.value, tierValues());
    const tierIsSet = (id: AlertSettingId) => tierIsSetIn(id, tierValues());
    const { showAll, setShowAll } = useShowAllSettings(() => ({
      user: store.state.userInfo?.email ?? "",
      org: store.state.selectedOrganization?.identifier ?? "",
    }));
    const tiers = useAlertSettingTiers({ available: tierAvailable, isSet: tierIsSet, showAll });
    provide(ALERT_SETTING_TIERS_KEY, tiers);

    const findAvailable = (id: AlertFindId): boolean => {
      const fd = alertForm.formData.value;
      if (alertForm.isAnomalyMode.value) {
        if (id === "name" || id === "folder") {
          return !alertForm.beingUpdated.value && !alertForm.anomalyEditMode.value;
        }
        return isAnomalyFindId(id) || (isTieredSetting(id) && tierAvailable(id));
      }
      if (isAnomalyOnlyFindId(id)) return false;
      const composite = isCompositeMode.value;
      const mode = fd.query_condition?.type || "custom";
      // SQL shows its own Simple/Multi toggle outside the tiered group-by row.
      if (id === "groupBy" && mode === "sql" && !composite) {
        return fd.is_real_time === "false";
      }
      if (isTieredSetting(id)) return tierAvailable(id);
      switch (id) {
        case "streamType":
        case "stream":
          return !composite;
        case "filters":
          return !composite && mode === "custom";
        case "queryEditor":
          return !composite && mode !== "custom";
        case "threshold":
        case "checkEvery":
        case "timezone":
        case "lookBack":
          return fd.is_real_time === "false";
        case "name":
        case "folder":
          return !alertForm.beingUpdated.value;
        default:
          return true;
      }
    };
    const settingFind = useAlertSettingFind({
      t: alertForm.t,
      available: findAvailable,
      tiers,
      goToSection,
      reveal: (el) => snapScrollRef.value?.revealElement(el),
    });

    // Only the 24 h check writes this; null until it has a finished result.
    const backtestSignal = ref<BacktestSignal | null>(null);
    provide(ALERT_BACKTEST_SIGNAL_KEY, backtestSignal);

    const { detectPrebuiltType } = usePrebuiltDestinations();
    const resolvingDestinations = computed(() =>
      (alertForm.formData.value.destinations ?? []).filter((name: string) => {
        const destination = (props.destinations as { name?: string }[]).find(
          (d) => d?.name === name,
        );
        const platform = destination ? detectPrebuiltType(destination as any) : null;
        return (RESOLVING_PLATFORMS as readonly string[]).includes(platform ?? "");
      }),
    );
    const suggestionContext = computed<SuggestionContext>(() => {
      const fd = alertForm.formData.value;
      return {
        shape: tierContext.value.shape,
        kind: tierContext.value.kind,
        promql: String(fd.query_condition?.promql ?? ""),
        ruleMode: fd.query_condition?.promql_rule_mode === true,
        backtest: backtestSignal.value,
        resolvingDestinations: resolvingDestinations.value,
        createsIncident: fd.creates_incident === true,
        oncallSet: tierIsSet("oncall"),
        available: tierAvailable,
        isSet: tierIsSet,
      };
    });
    const suggestions = useAlertSuggestions({
      context: suggestionContext,
      scope: () => ({
        user: store.state.userInfo?.email ?? "",
        org: store.state.selectedOrganization?.identifier ?? "",
        alertId: isEditingAlert.value && editAlertId.value ? editAlertId.value : null,
      }),
      tiers,
      t: alertForm.t,
      focus: (id) => settingFind.select(id),
    });
    provide(ALERT_SUGGESTIONS_KEY, suggestions);

    provide(ALERT_FORM_CONTEXT_KEY, {
      isEditing: computed(() => alertForm.beingUpdated.value || alertForm.anomalyEditMode.value),
      showAll,
      goToSection,
      reveal: (el: HTMLElement) => snapScrollRef.value?.revealElement(el),
      openSetting: (id: string) => settingFind.select(id),
      conditionNote: ref(null),
      thresholdGuide: shallowRef(null),
      previewStatus: activeEvaluationStatus,
    });

    const checkTimelineForecastWindow = computed(() => {
      const forecast = alertForm.formData.value._ui?.forecast;
      return forecast && alertForm.formData.value.query_condition?.type === "promql"
        ? forecastWindowWords(forecast.W, alertForm.t)
        : undefined;
    });
    // An enabled alert checking at least daily should have recent checks; none is then a problem.
    const recentChecksExpectedEvery = computed(() => {
      const fd = alertForm.formData.value;
      const every = Number(fd.trigger_condition?.frequency);
      return fd.enabled !== false &&
        fd.is_real_time === "false" &&
        fd.trigger_condition?.frequency_type !== "cron" &&
        every > 0 &&
        every <= 1440
        ? every
        : undefined;
    });
    const isCronSchedule = computed(
      () => alertForm.formData.value.trigger_condition?.frequency_type === "cron",
    );

    const railInCondition = computed(() => !lgUp.value && !!sectionTargets.narrowPreview);
    const compactRail = computed(() => lgUp.value && !xlUp.value);
    // A generated comparison is the alert's condition, so it leads step 2; it stays there while windows exist.
    const compareLeadRef = ref<HTMLElement | null>(null);
    const compareLeads = ref(false);
    watch(
      () => {
        const qc = alertForm.formData.value.query_condition;
        return [qc?.multi_time_range?.length ?? 0, compareFactor(qc?.vrl_function)] as const;
      },
      ([windows, factor]) => {
        compareLeads.value = windows > 0 && (compareLeads.value || factor !== undefined);
      },
      { immediate: true },
    );
    const findSlotRef = ref<HTMLElement | null>(null);
    const findInBar = computed(() => compactRail.value && !!findSlotRef.value);

    const conditionHelp = computed(() => {
      if (isCompositeMode.value) return alertForm.t("alerts.sections.condition.helpComposite");
      if (alertForm.isAnomalyMode.value)
        return alertForm.t("alerts.sections.condition.helpAnomaly");
      if (alertForm.formData.value.is_real_time === "true")
        return alertForm.t("alerts.sections.condition.helpRealtime");
      const fd = alertForm.formData.value;
      const mode = fd.query_condition?.type;
      if (mode === "sql") return alertForm.t("alerts.sections.condition.helpSql");
      if (mode === "promql") return alertForm.t("alerts.sections.condition.helpPromql");
      if (fd.stream_type === "traces") return alertForm.t("alerts.sections.condition.helpSpans");
      if (fd.stream_type === "metrics") return alertForm.t("alerts.sections.condition.helpMetrics");
      return alertForm.t("alerts.sections.condition.help");
    });

    // A one-click link adds the setting itself, so the click is never only a reveal.
    const onTierAdd = async (id: AlertSettingId) => {
      tiers.bring(id);
      if (id === "createsIncident") alertForm.setF("creates_incident", true);
      if (id === "variables" && !(alertForm.formData.value.context_attributes ?? []).length) {
        alertForm.setF("context_attributes", [{ id: getUUID(), key: "", value: "" }]);
      }
      // The clicked link is gone, so focus moves to the row it added rather than dropping to the page.
      await nextTick();
      await nextTick();
      tiers
        .slotFor(id)
        ?.querySelector<HTMLElement>(
          "input:not([disabled]), textarea, button:not([disabled]), [tabindex='0']",
        )
        ?.focus();
    };

    // ── Save-mode dialog copy ────────────────────────────────────────────────
    // Mode names match the QueryConfig mode toggle.
    const queryModeName = (mode: string) =>
      mode === "sql"
        ? raw("SQL")
        : mode === "promql"
          ? raw("PromQL")
          : alertForm.t("alerts.queryBuilder");

    // Names the modes that are set up; an empty selected mode is named first.
    const saveModeLead = computed(() => {
      const selected = alertForm.formData.value.query_condition?.type || "custom";
      const [first, second, third] = alertForm.queryModesWithContent.value.map(queryModeName);
      if (alertForm.queryModesWithContent.value.includes(selected)) {
        return third
          ? alertForm.t("alerts.saveModeDialog.leadAllSetUp", { first, second, third })
          : alertForm.t("alerts.saveModeDialog.leadBothSetUp", { first, second });
      }
      return second
        ? alertForm.t("alerts.saveModeDialog.leadSelectedEmptyTwoOthers", {
            selected: queryModeName(selected),
            first,
            second,
          })
        : alertForm.t("alerts.saveModeDialog.leadSelectedEmptyOneOther", {
            selected: queryModeName(selected),
            other: first,
          });
    });

    // Only warns, and only when the picked mode is empty by the same rule as the lead.
    const saveModeInfo = computed(() => {
      const pick = alertForm.saveModePick.value;
      if (alertForm.queryModesWithContent.value.includes(pick)) return null;
      return pick === "custom"
        ? alertForm.t("alerts.saveModeDialog.noFilters", {
            stream: alertForm.formData.value.stream_name,
          })
        : alertForm.t("alerts.saveModeDialog.noQuery");
    });

    // Says what runs: the picked mode only. Names the other modes that hold content.
    const saveModeNote = computed(() => {
      const pick = alertForm.saveModePick.value;
      const [first, second] = alertForm.queryModesWithContent.value
        .filter((mode) => mode !== pick)
        .map(queryModeName);
      const params = { pick: queryModeName(pick), first, second, other: first };
      if (second) return alertForm.t("alerts.saveModeDialog.noteTwoOthersUnused", params);
      if (first) return alertForm.t("alerts.saveModeDialog.noteOneOtherUnused", params);
      return alertForm.t("alerts.saveModeDialog.noteOnlyPick", params);
    });

    // ── Smart alert name ─────────────────────────────────────────────────────
    // A new alert names itself after what it actually watches ("k8s_logs where
    // status >= 500") and keeps re-deriving that as the stream and condition
    // change — until the first keystroke in the header, after which the name is
    // the user's. Editing an existing alert (or anomaly) is excluded outright:
    // a saved name is never regenerated behind the user's back.
    const folderAlerts = useServerQuery(
      computed(() => ({
        ...alertsListQuery(
          store.state.selectedOrganization.identifier,
          String(alertForm.activeFolderId.value ?? "default"),
        ),
        enabled: !alertForm.beingUpdated.value && !alertForm.anomalyEditMode.value,
      })),
    );
    const takenAlertNames = computed(
      () =>
        new Set<string>(
          (folderAlerts.data.value ?? []).map((a: { name?: string }) => a.name ?? ""),
        ),
    );
    // Offered only once the user reaches the name (or saves), so the name never renames itself mid-form.
    const nameDue = ref(false);
    const libraryName = ref("");
    const alertNameSuggestion = computed(() =>
      unusedAlertName(
        suggestedAlertName(buildAlertAutoName(alertForm.formData.value, alertForm.t), {
          due: nameDue.value,
          fromLibrary: libraryName.value,
        }),
        takenAlertNames.value,
      ),
    );
    const alertAutoName = useAutoName({
      suggestion: alertNameSuggestion,
      currentValue: () => (alertForm.formData.value?.name ?? "") as string,
      apply: (name: string) => alertForm.setF("name", name),
      enabled: () => !alertForm.beingUpdated.value && !alertForm.anomalyEditMode.value,
    });
    const nameFieldError = shownFieldError(alertForm.form, "name");
    // While typing, the field keeps the user's text and this line names what it will save as.
    const nameSavedAs = computed(() => {
      const typed = String(alertForm.formData.value?.name ?? "");
      const saved = savedAlertName(typed);
      return !nameFieldError.value && saved && saved !== typed ? saved : "";
    });
    // The typed name a blur rewrote, so the line under the field can say why it changed.
    const nameRewrittenFrom = ref("");
    // Runs in the capture phase, ahead of the field's own blur check, so that check sees the saved name.
    const applySavedName = () => {
      if (!nameSavedAs.value) return;
      nameRewrittenFrom.value = String(alertForm.formData.value?.name ?? "");
      alertForm.setF("name", nameSavedAs.value);
    };
    // Saving a nameless alert names it from what it watches instead of stopping on the name.
    const saveAlert = async () => {
      nameDue.value = true;
      await nextTick();
      if (!String(alertForm.form.state.values.name ?? "").trim()) alertAutoName.resetToAuto();
      await alertForm.handleSave();
    };
    // A generated name is a placeholder the user usually replaces, so focusing it selects it whole.
    const onNameFocus = (event: FocusEvent) => {
      if (alertAutoName.isAuto.value && event.target instanceof HTMLInputElement) {
        event.target.select();
      }
    };
    // Enter in the name saves the alert; focus leaves for the first issue, so the toast says what stopped it.
    const onNameEnter = async (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      applySavedName();
      await alertForm.handleSave();
      await nextTick();
      if (alertForm.form.state.isValid) return;
      toast({
        variant: "error",
        message: issueSections.value
          ? alertForm.t(
              "alerts.form.save.issuesIn",
              { count: issueCount.value, sections: issueSections.value },
              issueCount.value,
            )
          : alertForm.t("alerts.saveFailed"),
      });
    };
    const onNameInput = () => {
      nameRewrittenFrom.value = "";
      alertAutoName.markManual();
    };

    // Its SQL is compiled from its Sigma rule, so the server refuses query edits from here.
    const siemDetectionId = computed(() => {
      const attrs = props.modelValue?.context_attributes;
      const marker = Array.isArray(attrs)
        ? attrs.find((a: { key?: string }) => a?.key === "siem")?.value
        : attrs?.siem;
      return props.isUpdated && String(marker) === "true"
        ? String(props.modelValue?.id ?? props.modelValue?.alert_id ?? "")
        : "";
    });
    const openInSecurity = () =>
      alertForm.router.push({
        path: "/security/detections",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          detection: siemDetectionId.value,
        },
      });

    // Freshness is judged when the type's list lands, from the stats each row already carries.
    const streamPickerOptions = computed(() =>
      streamOptions(alertForm.schemaList.value as any[], {
        t: alertForm.t,
        nowUs: Date.now() * 1000,
        recent: recentStreams(
          store.state.selectedOrganization?.identifier ?? "",
          alertForm.formData.value.stream_type,
        ),
        activeNow: (name: string) =>
          recentActivity(
            {
              org: store.state.selectedOrganization?.identifier ?? "",
              streamType: alertForm.formData.value.stream_type,
            },
            name,
          ),
      }),
    );
    const onMetricLabelInsert = ({ label, value }: { label: string; value?: string }) => {
      const condition = alertForm.formData.value.query_condition;
      const current = condition.type === "promql" ? (condition.promql ?? "") : "";
      if (condition.type !== "promql") alertForm.updateTab("promql");
      alertForm.updatePromqlQuery(
        insertLabelIntoPromql(current, alertForm.formData.value.stream_name, label, value),
      );
    };

    // ── Intent start (section 1): a chip or a ready-made card fills sections 2–4, nothing is saved ──
    const showsIntentStart = computed(
      () =>
        !isEditing.value &&
        !isCompositeMode.value &&
        !!alertForm.formData.value.stream_name &&
        !alertForm.isLoadingPrefill.value,
    );
    // Folds the cards from 10 alerts; the folder list is a floor until the org's lists have loaded.
    const orgAlertCount = computed<number | undefined>(() => {
      const byFolder = store.state.organizationData?.allAlertsListByFolderId ?? {};
      const org = Object.values(byFolder).reduce<number>(
        (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
        0,
      );
      const folder = folderAlerts.data.value?.length;
      if (!org && folder === undefined) return undefined;
      return Math.max(org, folder ?? 0);
    });
    const appliedIntent = ref<{ fill: IntentFill | null; label: I18nText } | null>(null);
    // Shown before Save, but the name field stays empty until the user reaches it (FR1-D3).
    const defaultsName = computed(
      () =>
        String(alertForm.formData.value.name ?? "").trim() ||
        unusedAlertName(
          suggestedAlertName(buildAlertAutoName(alertForm.formData.value, alertForm.t), {
            due: true,
            fromLibrary: libraryName.value,
          }),
          takenAlertNames.value,
        ),
    );
    // A chosen intent whose sentence still has an empty filter or measure: nothing is written or previewed.
    const pendingIntent = ref<IntentId | null>(null);
    let pendingQuery = "";
    let intentBaseline: any = null;
    const intentPaths = new Set<string>();
    const LIBRARY_ATTRIBUTES = new Set(["library_id", "library_hash"]);

    // Undoes only what the last intent wrote, so edits elsewhere in the form stay.
    const restoreIntent = () => {
      pendingIntent.value = null;
      if (!intentBaseline || !appliedIntent.value) return;
      if (appliedIntent.value.fill) {
        intentPaths.forEach((path) => alertForm.setF(path, cloneDeep(get(intentBaseline, path))));
      } else {
        const now = alertForm.formData.value;
        alertForm.resetForm({
          ...cloneDeep(intentBaseline),
          destinations: now.destinations,
          context_attributes: (now.context_attributes ?? []).filter(
            (a: { key?: string }) => !LIBRARY_ATTRIBUTES.has(a.key ?? ""),
          ),
        });
      }
      intentPaths.clear();
      appliedIntent.value = null;
      libraryName.value = "";
      // The ready-made query's check result belongs to it, not to the restored builder.
      alertForm.sqlQueryErrorMsg.value = "";
      void nextTick(() => alertForm.previewAlertRef.value?.refreshData?.());
    };
    const holdBaseline = () => {
      if (!appliedIntent.value) intentBaseline = cloneDeep(alertForm.formData.value);
    };

    const applyIntent = async ({ fill, label }: { fill: IntentFill; label: I18nText }) => {
      const carried = carriedThreshold(appliedIntent.value?.fill, fill, (path) =>
        get(alertForm.formData.value, path),
      );
      holdBaseline();
      restoreIntent();
      if (String(alertForm.formData.value.is_real_time) !== fill.howItChecks) {
        intentPaths.add("is_real_time");
        intentPaths.add("query_condition.type");
        onAlertTypeChange(fill.howItChecks);
      }
      Object.entries({ ...fill.values, ...carried }).forEach(([path, value]) => {
        intentPaths.add(path);
        alertForm.setF(path, cloneDeep(value));
      });
      // A new object, so the anomaly step's own form re-seeds from it instead of writing its old values back.
      if (fill.anomaly)
        alertForm.anomalyConfig.value = { ...alertForm.anomalyConfig.value, ...fill.anomaly };
      if (fill.vrl) alertForm.showVrlFunction.value = true;
      alertForm.isAggregationEnabled.value = fill.aggregation;
      await nextTick();
      if (fill.values["query_condition.type"] === "custom") {
        (
          alertForm.step2Ref.value as { syncMeasureFromForm?: () => void } | null
        )?.syncMeasureFromForm?.();
      }
      appliedIntent.value = { fill, label };
      if (fill.intent === "promql") goToSection("condition");
    };

    const onIntentPending = async ({ intent }: { intent: IntentId }) => {
      restoreIntent();
      await nextTick();
      pendingIntent.value = intent;
      pendingQuery = JSON.stringify(alertForm.formData.value.query_condition);
    };
    // Building the query in section 2 instead answers the pending intent.
    watch(
      () => JSON.stringify(alertForm.formData.value.query_condition),
      (query) => {
        if (pendingIntent.value && query !== pendingQuery) pendingIntent.value = null;
      },
    );

    const applySuggestion = async (suggestion: LibrarySuggestion) => {
      holdBaseline();
      restoreIntent();
      const prefill = buildPrefillFromSuggestion(suggestion);
      const data = cloneDeep(alertForm.formData.value);
      const seeded = seedFormFromPrefill(data, prefill, {
        sql: prefill.sql ?? "",
        floorMinutes: Math.max(
          1,
          Math.ceil((Number(store.state.zoConfig?.min_auto_refresh_interval) || 0) / 60),
        ),
      });
      // Provenance the saved alert carries, the way one-click install stamps it.
      data.context_attributes = [
        ...(data.context_attributes ?? []).filter(
          (a: { key?: string; value?: string }) =>
            !LIBRARY_ATTRIBUTES.has(a.key ?? "") && !!(a.key || a.value),
        ),
        { id: getUUID(), key: "library_id", value: suggestion.id },
        ...(suggestion.library?.content_hash
          ? [{ id: getUUID(), key: "library_hash", value: suggestion.library.content_hash }]
          : []),
      ];
      if (suggestion.library?.pack) data.tags = withPackTag(data.tags, suggestion.library.pack);
      alertForm.resetForm(data);
      libraryName.value = String(data.name ?? "");
      if (seeded.aggregation) alertForm.isAggregationEnabled.value = true;
      if (seeded.vrl) alertForm.showVrlFunction.value = true;
      appliedIntent.value = { fill: null, label: raw(prefill.sourceLabel) };
      goToSection("condition");
    };

    // A window typed in a condition sentence is a Look back edit, so Check every follows as there.
    const setLookBack = (minutes: number | "") =>
      (
        alertForm.step4Ref.value as { handlePeriodChange?: (value: unknown) => void } | null
      )?.handlePeriodChange?.(minutes);

    const startFromScratch = () => {
      restoreIntent();
      goToSection("condition");
    };

    const openExistingAlert = (alert: AlreadySetUp) =>
      alertForm.router.push({
        name: "alertList",
        query: {
          alert_id: alert.alert_id,
          action: "update",
          name: alert.name,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });

    // A new stream or type starts the intents over; what an intent wrote stays as ordinary values.
    watch(
      () => `${alertForm.formData.value.stream_type}/${alertForm.formData.value.stream_name}`,
      () => {
        appliedIntent.value = null;
        pendingIntent.value = null;
        sentenceThreshold.value = false;
        intentBaseline = null;
        intentPaths.clear();
      },
    );

    return {
      raw,
      siemDetectionId,
      openInSecurity,
      streamPickerOptions,
      onMetricLabelInsert,
      showsIntentStart,
      orgAlertCount,
      appliedIntent,
      pendingIntent,
      sentenceThreshold,
      saveDefaults,
      defaultsName,
      applyIntent,
      setLookBack,
      onIntentPending,
      applySuggestion,
      startFromScratch,
      openExistingAlert,
      ...alertForm,
      alertDraft: alertEditorDraft.draft,
      calibrationHandoff,
      calibrationBanner: calibrationHandoff.banner,
      draftFormKey: alertEditorDraft.formKey,
      cancelEditor,
      alertAutoName,
      headerModeLabel,
      isAnomalyDetectionEnabled,
      anomalyNoticeBadge,
      anomalyNoticeTooltip,
      isAnomalyDataReadinessStatus,
      anomalyCanCheckDataNow,
      alertTypeOptions,
      streamTypeOptions,
      showsLibraryLink,
      goToAlertLibrary,
      showsConditionPresets,
      conditionPresetOptions,
      activeConditionPreset,
      applyConditionPreset,
      showsCheckTimeline,
      showsBacktest,
      backtestQuery,
      reviewLines,
      sentenceGap: SENTENCE_GAP,
      issueCount,
      saveLabel,
      compositeNeedsChildren,
      issueSections,
      goToSaveReason,
      lgUp,
      compactRail,
      findSlotRef,
      findInBar,
      compareLeadRef,
      compareLeads,
      snapScrollRef,
      activeSection,
      goToSection,
      isEditing,
      watchCollapsed,
      stepToSection,
      watchSummary,
      expandWatch,
      editNameInDetails,
      ALERT_SECTIONS,
      sectionTargets,
      setSectionTarget,
      sectionItems,
      formSections,
      isEditingAlert,
      editAlertId,
      editFolderId,
      editHeader,
      unsavedChanges: unsaved.changes,
      discardChanges,
      railVerdict,
      firesOnSave,
      RAIL_VERDICT_ICONS,
      tiers,
      onTierAdd,
      showAll,
      setShowAll,
      isCronSchedule,
      checkTimelineForecastWindow,
      recentChecksExpectedEvery,
      railInCondition,
      conditionHelp,
      settingFind,
      alertNameSuggestion,
      nameSavedAs,
      applySavedName,
      saveAlert,
      nameRewrittenFrom,
      nameFieldError,
      onNameInput,
      onNameFocus,
      onNameEnter,
      anomalyLockedReason,
      anomalyLicenseLocked,
      activeFolderName,
      goBackToAlertsList,
      onStreamTypeChange,
      onAlertTypeChange,
      queryModeName,
      saveModeLead,
      saveModeInfo,
      saveModeNote,
      activeEvaluationStatus,
      isCompositeMode,
      availableCompositeChildren,
      updateCompositeDraft,
      silentAutoObserveDraft,
      destinationRequired,
      viaIncidentDraft,
      reachGap,
      openOncallSetup,
      checkOncallAgain,
      checkingReach,
      unreachableLine,
      viaIncidentLine,
      onCompositeValidation,
      handleSqlSchemaUpdated,
      previewValueRange,
      previewTestOpen,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:o2-form): float each control's validation message out of
   flow. A class passed to OInput/OFormSelect lands on the ROOT wrapper — the
   flex-col holding the control AND its message — so an in-flow message would
   grow these fixed-height topbar rows, escape the card, and be painted over by
   the next card. `top:100%` resolves against the wrapper. The selects
   deliberately carry NO height clamp (it only ever shrank the wrapper box,
   never the 2.125rem trigger, which mis-anchored the floating message).
   pointer-events:none so the floating text can't swallow clicks on the tab bar
   it overlaps. `:deep` because [role="alert"] renders inside the child
   component. All widths and container-query steps are template utilities.
   The alert-name field is NOT listed here: OInlineEdit renders its message
   BESIDE the name (below is the subtitle band), so it adds no height either and
   needs no wrapper override. */
.stream-type-select,
.stream-name-select {
  position: relative;
}

.stream-type-select :deep([role="alert"]),
.stream-name-select :deep([role="alert"]) {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 0.125rem;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}
</style>

<style scoped>
/* keep(complex-state): `.alert-field-highlight` is a transient state class that
   AlertFocusManager (utils/alerts/focusManager.ts) adds/removes at RUNTIME via
   classList on refs registered from useAlertForm — no template ever writes it,
   so it cannot become a template utility. AddAlert is the alert-form root and
   owns every registered field's DOM (incl. the QueryConfig subtree, which
   instantiates its own focusManager), so one `:deep()` here covers them all.
   `!important` is preserved: it must beat the field components' own border
   utilities, exactly as the previous global rule did. */
:deep(.alert-field-highlight) {
  border: 0.125rem solid var(--color-accent) !important;
  border-radius: 0.25rem;
  transition: border 0.3s ease;
}
</style>
