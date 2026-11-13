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
    ref="groupEl"
    icon="info"
    class="date-time-container inline-flex max-w-full shrink-0 items-stretch [&_button:focus-visible]:z-1"
    :class="{
      'rounded-default border-button-outline-border min-h-8.5 border': !hideRangeShift,
      'w-full [&>*]:flex-1': fieldAppearance,
    }"
  >
    <OTooltip v-if="!hideRangeShift" shortcut-id="timeRangePrevious" side="bottom">
      <template #content>
        <span class="flex flex-col">
          <span>{{ stepTooltip.prev.title }}</span>
          <span v-if="stepTooltip.prev.window" class="text-text-secondary text-xs tabular-nums">{{
            stepTooltip.prev.window
          }}</span>
        </span>
      </template>
      <OButton
        data-test="date-time-prev-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! disabled:text-text-disabled! h-auto! rounded-e-none! border-e! max-md:hidden"
        icon-left="chevron-left"
        :aria-label="stepTooltip.prev.title"
        :disabled="disable || disablePrevShift"
        @click.prevent.stop="shiftTimeRange('prev')"
      />
    </OTooltip>
    <OPopover
      v-model:open="menuOpen"
      :anchor="hideRangeShift ? null : groupEl"
      side="bottom"
      :align="menuAlign"
      :z-index="10001"
      :aria-label="t('common.selectDateRange')"
      :collision-padding="POPOVER_COLLISION_PADDING"
      content-class="border-border-default! bg-surface-overlay! rounded-surface! overflow-hidden p-0 shadow-lg!"
      @update:open="onMenuOpenChange"
      @open-auto-focus="onPopoverOpenAutoFocus"
    >
      <template #trigger>
        <OButton
          :data-test="dataTestName"
          id="date-time-button"
          ref="datetimeBtn"
          data-cy="date-time-button"
          :variant="variant"
          :size="fieldAppearance ? 'sm' : 'sm-toolbar'"
          :class="{
            [selectedType + 'type']: !disableRelative,
            hideRelative: disableRelative,
            'w-fit': disableRelative,
            'h-auto! rounded-none! border-0!': !hideRangeShift,
            'enabled:hover:bg-interactive-hover-bg! data-[state=open]:bg-surface-accent-active!':
              !fieldAppearance,
            'border-select-border! enabled:hover:border-select-border-hover! w-full':
              fieldAppearance,
            'max-md:rounded-default!': !hideRangeShift,
          }"
          class="justify-start! max-md:max-w-full max-md:min-w-0"
          :aria-label="triggerAriaLabel"
          :disabled="disable"
          @mouseenter="onTriggerHover(true)"
          @mouseleave="onTriggerHover(false)"
          @focus="onTriggerHover(true)"
          @blur="onTriggerHover(false)"
        >
          <template #icon-left>
            <OIcon name="schedule" size="sm" :class="{ 'max-md:hidden': !fieldAppearance }" />
          </template>
          <span
            class="date-time-label flex min-w-0 flex-1 text-start whitespace-pre tabular-nums max-md:min-w-16"
            :class="fieldAppearance ? 'font-normal' : 'font-semibold'"
            ><span v-if="triggerParts.name" class="min-w-0 truncate">{{ triggerParts.name }}</span
            ><span v-if="triggerParts.dates" class="shrink-0" data-test="date-time-trigger-dates">{{
              triggerParts.name ? ` · ${triggerParts.dates}` : triggerParts.dates
            }}</span></span
          >
          <OIcon
            v-if="narrowedByQuery"
            name="filter-alt"
            size="sm"
            class="text-text-secondary shrink-0"
            data-test="date-time-trigger-narrowed"
          />
          <OBadge
            v-if="zoneBadgeText"
            data-test="date-time-zone-badge"
            variant="default-soft"
            size="sm"
            class="shrink-0 tabular-nums"
            >{{ zoneBadgeText }}</OBadge
          >
          <template #icon-right
            ><OIcon
              name="arrow-drop-down"
              size="sm"
              class="date-time-arrow ms-auto text-lg! transition-transform duration-250"
              :class="{ 'max-md:hidden': !fieldAppearance }"
          /></template>
        </OButton>
      </template>
      <div
        id="date-time-menu"
        ref="menuEl"
        class="date-time-dialog z-10001 flex h-82 max-h-(--reka-popover-content-available-height) w-110 max-w-[min(27.5rem,calc(100vw-1.5rem))] flex-col"
        @keydown.capture="onPickerKeydown"
        @paste="onPickerPaste"
      >
        <div class="flex shrink-0 flex-col gap-1.5 px-3 pt-2.5 pb-2" data-test="date-time-top-bar">
          <div class="flex min-w-0 items-center gap-2">
            <div v-if="!hideClipboard" class="relative min-w-0 flex-1" @focusout="onBarFocusOut">
              <OInput
                ref="inputBar"
                v-model="inputText"
                data-test="date-time-input"
                class="min-w-0 [&>div:first-of-type]:h-8!"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                :aria-expanded="shownRows.length > 0"
                :aria-controls="shownRows.length > 0 ? listId : undefined"
                :aria-activedescendant="cursorRow >= 0 ? `${listId}-${cursorRow}` : undefined"
                :placeholder="
                  isMobile ? t('dateTime.placeholderShort') : t('common.timeRangeInputPlaceholder')
                "
                :aria-label="t('common.timeRangeInputLabel')"
                :error="inputError"
                :aria-describedby="inputError ? inputErrorId : undefined"
                @update:model-value="onInputEdit"
                @keydown="onInputKeydown"
              >
                <template #icon-right>
                  <OShortcut
                    v-if="previewLine?.ready && !suggestionsOpen && listCursor < 0"
                    data-test="date-time-input-enter-hint"
                    class="me-1"
                    keys="enter"
                    size="sm"
                  />
                  <OTooltip v-else :content="t('common.pasteRange')" side="bottom" align="end">
                    <OButton
                      data-test="date-time-paste-btn"
                      variant="ghost"
                      size="icon-xs-sq"
                      icon-left="content-paste"
                      class="text-text-secondary!"
                      :aria-label="t('common.pasteRange')"
                      @click="pasteRange"
                    />
                  </OTooltip>
                </template>
              </OInput>
            </div>
            <div v-else class="flex-1" />
            <OSelect
              v-if="!hideRelativeTimezone"
              data-test="datetime-timezone-select"
              v-model="timezone"
              :options="timezoneSelectOptions"
              searchable
              :aria-label="t('logStream.timezone')"
              :search-placeholder="t('dateTime.searchZones')"
              :search-debounce="0"
              @search="zoneQuery = $event"
              :dropdown-style="{ minWidth: 'min(24rem, calc(100vw - 2rem))' }"
              @update:model-value="onTimezoneChange"
              @open="isTimezoneSelectOpen = true"
              @close="
                isTimezoneSelectOpen = false;
                zoneQuery = '';
              "
              class="w-auto! max-w-36 min-w-0 shrink-0 [&_[role=combobox]]:h-8!"
            >
              <template #trigger>
                <span
                  class="text-select-text text-compact flex-1 truncate text-start tabular-nums"
                  data-test="datetime-timezone-short"
                  >{{ zoneShortLabel }}</span
                >
              </template>
            </OSelect>
          </div>
          <div class="flex h-6 min-w-0 items-center gap-2">
            <div
              v-if="summaryError"
              :id="inputErrorId"
              data-test="date-time-input-error"
              role="alert"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-xs whitespace-nowrap"
            >
              <OIcon name="error-outline" size="sm" class="text-input-error-text shrink-0" />
              <span class="text-input-error-text shrink-0 font-medium">{{
                summaryError.message
              }}</span>
              <span
                v-if="summaryError.examples"
                class="text-text-secondary min-w-0 truncate"
                data-test="date-time-input-examples"
                >{{ summaryError.examples }}</span
              >
            </div>
            <div
              v-else
              data-test="date-time-resolved"
              :data-preview="previewLine ? 'true' : undefined"
              class="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap tabular-nums"
            >
              <span
                v-if="shownLine.name"
                class="text-compact shrink-0 font-semibold"
                :class="previewLine ? 'text-toggle-item-active-text' : 'text-text-heading'"
                data-test="date-time-resolved-name"
                >{{ shownLine.name }}</span
              >
              <OBadge
                v-if="shownLine.live"
                variant="primary-soft"
                size="sm"
                class="shrink-0"
                data-test="date-time-preview-live"
                >{{ t("dateTime.tagLive")
                }}<OTooltip :content="t('dateTime.tagLiveHint')" side="bottom"
              /></OBadge>
              <OBadge
                v-else-if="shownLine.fixed"
                variant="default-soft"
                size="sm"
                class="shrink-0"
                data-test="date-time-preview-fixed"
                >{{ t("dateTime.fixed")
                }}<OTooltip :content="t('dateTime.tagFixedHint')" side="bottom"
              /></OBadge>
              <span
                v-if="shownLine.range"
                class="text-compact shrink-0"
                :class="previewLine ? 'text-toggle-item-active-text' : 'text-text-secondary'"
                data-test="date-time-resolved-range"
                >{{ shownLine.range }}</span
              >
              <!-- The duration gives way first: once its box is narrower than the tag, the tag wraps out of sight. -->
              <span
                v-if="shownLine.duration"
                class="flex h-6 min-w-0 shrink-[64] flex-wrap items-center overflow-hidden max-md:hidden"
              >
                <span class="h-6 w-0" aria-hidden="true" />
                <OBadge
                  variant="default-soft"
                  size="sm"
                  class="shrink-0"
                  data-test="date-time-resolved-duration"
                  >{{ shownLine.duration }}</OBadge
                >
              </span>
              <span
                v-if="shownLine.note"
                class="min-w-0 shrink-[4] truncate text-xs"
                :class="shownLine.warning ? 'text-status-warning-text' : 'text-text-secondary'"
                :title="shownLine.note"
                data-test="date-time-preview-note"
                >{{ shownLine.note }}</span
              >
              <OButton
                v-if="asUtcLabel"
                data-test="date-time-as-utc-toggle"
                variant="outline"
                size="chip"
                class="text-text-link! shrink-0 rounded-full!"
                @click="toggleAsUtc"
                >{{ asUtcLabel.short
                }}<OTooltip :content="asUtcLabel.full" side="bottom" align="end"
              /></OButton>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <!-- Copy takes the selection, not a preview, so it steps aside and the preview's note shows in full. -->
              <OTooltip
                v-if="!hideClipboard && !previewLine"
                :content="copyDisabled ? t('dateTime.nothingToCopy') : t('common.copyRange')"
                :shortcut="copyShortcut"
                side="bottom"
                align="end"
              >
                <OButton
                  data-test="date-time-copy-btn"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="content-copy"
                  class="enabled:text-text-secondary! disabled:text-text-disabled! max-md:hidden"
                  :aria-label="t('common.copyRange')"
                  :disabled="copyDisabled"
                  @click="copyRange"
                />
              </OTooltip>
              <OTooltip
                v-if="showLiveButton"
                :content="t('dateTime.goLiveHint', { duration: liveDurationLabel })"
                side="bottom"
                align="end"
              >
                <OButton
                  data-test="date-time-live-btn"
                  variant="outline"
                  size="xs"
                  class="text-text-link! h-6! shrink-0 gap-1.5! px-2!"
                  :aria-label="t('dateTime.goLiveHint', { duration: liveDurationLabel })"
                  @click="goLive"
                  ><span class="bg-accent size-1.5 rounded-full" aria-hidden="true" />{{
                    t("dateTime.live")
                  }}</OButton
                >
              </OTooltip>
            </div>
          </div>
        </div>
        <div class="border-border-default min-h-0 flex-1 border-y" data-test="date-time-body">
          <div v-if="calendarMode" class="h-full overflow-y-auto px-3 py-1">
            <ODateRangeCalendar
              ref="calendarRef"
              band-range
              prevent-deselect
              fill
              compact
              auto-focus
              :locale="intlLocale"
              :week-starts-on="weekStart"
              :calendar-label="t('dateTime.dateRangeGrid')"
              :prev-label="t('dateTime.calendarPrevMonth')"
              :next-label="t('dateTime.calendarNextMonth')"
              :hide-selection="selectedType === 'relative'"
              :start-date="selectedDate.from"
              :end-date="selectedDate.to"
              :min-date="calendarMinDate"
              :max-date="calendarMaxDate"
              :unavailable-before="retentionFloorDay ?? undefined"
              :unavailable-reason="
                retentionDays ? t('dateTime.outsideRetention', { days: retentionDays }) : undefined
              "
              @update:start-date="onCalendarStartDate"
              @update:end-date="onCalendarEndDate"
              @update:pending-date="onCalendarPendingDay"
              @update:preview-date="calendarPreviewDay = $event"
            />
          </div>
          <div v-else class="flex h-full flex-col">
            <div
              v-if="showChips && !typing"
              class="border-border-subtle flex h-9 shrink-0 items-center gap-2 border-b px-3 max-md:h-11"
              data-test="date-time-chips"
            >
              <OToggleGroup
                :model-value="litChip ?? undefined"
                @update:model-value="onChipToggle"
                @reselect="onChipReselect"
              >
                <OToggleGroupItem
                  v-for="chip in chipItems"
                  :key="chip.value"
                  :value="chip.value"
                  size="xs"
                  :disabled="chip.disabled"
                  focusable-unavailable
                  :tooltip="chip.reason ? raw(chip.reason) : undefined"
                  :aria-label="chip.title"
                  class="o-time-chip data-[state=on]:bg-accent! data-[state=on]:text-text-inverse! data-disabled:border-border-default h-6! tabular-nums data-disabled:border data-disabled:bg-transparent! max-md:h-8! max-md:min-w-10 forced-colors:data-[state=on]:bg-[color:Highlight]! forced-colors:data-[state=on]:text-[color:HighlightText]! forced-colors:data-[state=on]:forced-color-adjust-none"
                  :data-test="`date-time-chip-${chip.label}`"
                  >{{ raw(chip.label) }}<OTooltip v-if="!chip.disabled" :content="chip.title"
                /></OToggleGroupItem>
              </OToggleGroup>
              <OTooltip
                v-for="(note, noteIndex) in chipsNotes"
                :key="note.testId"
                :content="note.tooltip"
                side="right"
              >
                <span
                  class="text-text-secondary inline-flex min-w-0 shrink items-center gap-1 text-xs"
                  :class="{ 'ms-auto': noteIndex === 0 }"
                  :data-test="note.testId"
                >
                  <OIcon :name="note.icon" size="xs" class="shrink-0" />
                  <span class="truncate">{{ note.text }}</span>
                </span>
              </OTooltip>
            </div>
            <div class="min-h-0 flex-1">
              <DateTimeRangeList
                v-if="bodyRows.length > 0"
                :id="listId"
                :rows="bodyRows"
                :active="cursorRow"
                :editing-id="editingPinRowId"
                :heading="emptyExamples.length > 0 ? t('dateTime.noMatchYet') : listHeading"
                @pick="pickBodyRow"
                @cursor="setCursorRow"
                @pin="pinRecentRow"
                @unpin="unpinRow"
                @remove="removeRecentRow"
                @rename="renamePin"
                @rename-cancel="cancelPinName"
              />
            </div>
          </div>
        </div>
        <div class="flex h-9 shrink-0 items-center gap-1 ps-1 pe-2" data-test="date-time-footer">
          <template v-if="calendarMode">
            <OTooltip v-if="!disableRelative" :content="t('dateTime.backToList')">
              <OButton
                data-test="date-time-calendar-back-btn"
                variant="ghost"
                size="icon-xs-sq"
                icon-left="arrow-back"
                class="text-text-secondary! shrink-0"
                :aria-label="t('dateTime.backToList')"
                @click="closeCalendar"
              />
            </OTooltip>
            <div
              v-if="!hideRelativeTime"
              class="startEndTime grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-0.5 max-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              data-test="date-time-start-end"
              @keydown.enter="onTimeFieldEnter"
            >
              <OTime
                class="min-w-0"
                size="sm"
                :aria-label="t('common.timeRangeStart')"
                :prefix="fieldsBlank ? undefined : startDayLabel"
                :placeholder="t('common.timeRangeStart')"
                hide-icon
                format24
                revert-refused
                :error="unreadableFields.start || timeFieldError?.field === 'start'"
                hide-message
                :model-value="fieldsBlank ? '' : selectedTime.startTime"
                with-seconds
                optional-seconds
                data-test="datetime-start-time"
                @input="onTimeFieldTyping('start', $event)"
                @invalid="onTimeFieldInvalid('start', $event)"
                @update:model-value="onStartTimeEdit"
                @focus="timeFieldFocused = true"
                @blur="onTimeFieldBlur"
              />
              <OIcon
                name="arrow-forward"
                size="xs"
                class="text-text-label self-center justify-self-center max-md:hidden"
                aria-hidden="true"
              />
              <OTime
                class="min-w-0"
                :class="{ '[&_input]:text-text-label': calendarPreviewDay && pendingDay }"
                size="sm"
                :aria-label="t('common.timeRangeEnd')"
                :prefix="fieldsBlank ? undefined : endDayLabel"
                :placeholder="t('common.timeRangeEnd')"
                hide-icon
                format24
                revert-refused
                :error="unreadableFields.end || timeFieldError?.field === 'end'"
                hide-message
                :model-value="fieldsBlank ? '' : selectedTime.endTime"
                with-seconds
                optional-seconds
                data-test="datetime-end-time"
                @input="onTimeFieldTyping('end', $event)"
                @invalid="onTimeFieldInvalid('end', $event)"
                @update:model-value="onEndTimeEdit"
                @focus="timeFieldFocused = true"
                @blur="onTimeFieldBlur"
              />
            </div>
            <div v-else class="flex-1" />
            <OTooltip :content="applyBlockedReason">
              <OButton
                data-test="date-time-apply-btn"
                variant="primary"
                size="xs"
                class="shrink-0 px-3!"
                :disabled="applyDisabled"
                @click="onApplyClick"
              >
                {{ t("common.apply") }}
              </OButton>
            </OTooltip>
          </template>
          <template v-else>
            <OButton
              data-test="date-time-pick-dates-btn"
              variant="ghost"
              size="xs"
              icon-left="calendar-month"
              class="text-text-heading!"
              @click="openCalendar"
              >{{ t("dateTime.pickDates") }}</OButton
            >
            <div class="flex-1" />
            <template v-if="!hideRangeShift">
              <OTooltip shortcut-id="timeRangePrevious">
                <template #content>
                  <span class="flex flex-col">
                    <span>{{ stepTooltip.prev.title }}</span>
                    <span
                      v-if="stepTooltip.prev.window"
                      class="text-text-secondary text-xs tabular-nums"
                      >{{ stepTooltip.prev.window }}</span
                    >
                  </span>
                </template>
                <OButton
                  data-test="date-time-prev-btn-footer"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="chevron-left"
                  class="enabled:text-text-secondary! disabled:text-text-disabled!"
                  :aria-label="stepTooltip.prev.title"
                  :disabled="disable || disablePrevShift"
                  @click="shiftTimeRange('prev')"
                />
              </OTooltip>
              <OTooltip shortcut-id="timeRangeNext">
                <template #content>
                  <span class="flex flex-col">
                    <span>{{ stepTooltip.next.title }}</span>
                    <span
                      v-if="stepTooltip.next.window"
                      class="text-text-secondary text-xs tabular-nums"
                      >{{ stepTooltip.next.window }}</span
                    >
                  </span>
                </template>
                <OButton
                  data-test="date-time-next-btn-footer"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="chevron-right"
                  class="enabled:text-text-secondary! disabled:text-text-disabled!"
                  :aria-label="stepTooltip.next.title"
                  :disabled="disable || isNextShiftDisabled()"
                  @click="shiftTimeRange('next')"
                />
              </OTooltip>
              <OTooltip
                v-if="!hideRelativeTime"
                :content="stepTooltip.zoom"
                shortcut-id="timeRangeZoomOut"
              >
                <OButton
                  data-test="date-time-zoom-out-btn-footer"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="zoom-out"
                  class="enabled:text-text-secondary! disabled:text-text-disabled!"
                  :aria-label="stepTooltip.zoom"
                  :disabled="disable || zoomOutBlocked"
                  @click="zoomOut"
                />
              </OTooltip>
            </template>
          </template>
        </div>
        <div class="sr-only" aria-live="polite" data-test="date-time-live-region">
          {{ panelSpeech }}
        </div>
      </div>
    </OPopover>
    <OTooltip
      v-if="triggerTooltip"
      :anchor="triggerElement"
      :open="triggerTooltipOpen && !menuOpen"
      side="bottom"
    >
      <template #content>
        <span class="flex flex-col tabular-nums" data-test="date-time-trigger-tooltip">
          <span>{{ triggerTooltip.stamps }}</span>
          <span class="text-text-secondary text-xs">{{ triggerTooltip.detail }}</span>
        </span>
      </template>
    </OTooltip>
    <OTooltip v-if="!hideRangeShift" shortcut-id="timeRangeNext" side="bottom">
      <template #content>
        <span class="flex flex-col">
          <span>{{ stepTooltip.next.title }}</span>
          <span v-if="stepTooltip.next.window" class="text-text-secondary text-xs tabular-nums">{{
            stepTooltip.next.window
          }}</span>
        </span>
      </template>
      <OButton
        data-test="date-time-next-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! disabled:text-text-disabled! h-auto! rounded-none! border-s! max-md:hidden"
        icon-left="chevron-right"
        :aria-label="stepTooltip.next.title"
        :disabled="disable || isNextShiftDisabled()"
        @click.prevent.stop="shiftTimeRange('next')"
      />
    </OTooltip>
    <OTooltip
      v-if="!hideRangeShift && !hideRelativeTime"
      :content="stepTooltip.zoom"
      shortcut-id="timeRangeZoomOut"
      side="bottom"
    >
      <OButton
        data-test="date-time-zoom-out-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! disabled:text-text-disabled! h-auto! border-s! max-md:hidden forced-colors:disabled:text-[color:GrayText]!"
        :class="showUndo ? 'rounded-none!' : 'rounded-s-none!'"
        icon-left="zoom-out"
        :aria-label="stepTooltip.zoom"
        :disabled="disable || zoomOutBlocked"
        @click.prevent.stop="zoomOut"
      />
    </OTooltip>
    <OTooltip v-if="showUndo" :content="undoTooltip" shortcut-id="timeRangeUndo" side="bottom">
      <OButton
        data-test="date-time-undo-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! h-auto! rounded-s-none! border-s!"
        icon-left="undo"
        :aria-label="undoTooltip"
        :disabled="disable"
        @click.prevent.stop="undoRange"
      />
    </OTooltip>
    <div class="sr-only" aria-live="polite" data-test="date-time-applied-live-region">
      {{ appliedSpeech }}
    </div>
  </div>
</template>

<script lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import DateTimeRangeList from "@/components/DateTimeRangeList.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import {
  ref,
  defineComponent,
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  useId,
  watch,
  nextTick,
  type PropType,
} from "vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import { getImageURL, useLocalTimezone, convertToUtcTimestamp } from "../utils/zincutils";
import {
  formatCalendarLabel,
  parseCalendarToken,
  resolveCalendarPeriod,
} from "@/utils/dashboard/calendarPeriods";
import { CALENDAR_RAIL_ITEMS, PAST_PERIOD_KEYS, formatZoneBadge } from "@/utils/timeRangeRail";
import {
  isRelativeHistoryEntry,
  sameHistoryEntry,
  type TimeRangeHistoryEntry,
} from "@/composables/useTimeRangeHistory";
import {
  TIME_INPUT_EXAMPLES,
  type TimeRangeListRow,
  type TimeRangePreset,
} from "@/utils/timeRangeList";
import { instantFromShiftedMs } from "@/utils/timeRangeZoom";
import {
  formatRangeCopyText,
  formatRangeDates,
  formatRangeDuration,
  formatRangeLabel,
  formatRangeStamps,
  formatZoneOffset,
  type RangeLabelInput,
} from "@/utils/timeRangeLabel";
import { weekStartsOn } from "@/utils/weekStart";
import { searchTimeZones } from "@/utils/timeZoneSearch";
import type { DateRangeCalendarExposed } from "@/lib/forms/DateTimeRange/ODateRangeCalendar.types";
import { parseRollingPeriod } from "@/utils/dateTimeRangeParse";
import { copyToClipboard } from "@/utils/clipboard";
import { isMacOS } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import useTimeRangeZone, {
  MICROS_PER_MINUTE,
  MICROS_PER_SECOND,
  addCivilDays,
  zoneOffset,
} from "@/composables/useTimeRangeZone";
import useTimeRangeLimits, { MAX_CUSTOM_RELATIVE_VALUE } from "@/composables/useTimeRangeLimits";
import useTimeRangeRail from "@/composables/useTimeRangeRail";
import useTimeRangeTyping, { type InputPlan } from "@/composables/useTimeRangeTyping";
import useTimeRangeFields, { type FieldsSnapshot } from "@/composables/useTimeRangeFields";
import useTimeRangeSummary from "@/composables/useTimeRangeSummary";
import useTimeRangeStepping from "@/composables/useTimeRangeStepping";

const POPOVER_COLLISION_PADDING = { top: 48, right: 8, bottom: 8, left: 8 };
// Seconds each unit nominally spans, months at their longest; a DST day can still run 25h, so typed periods also check the real span.
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  M: 2_678_400,
};
// Units of a fixed length, largest first; weeks and months keep their own unit when zoomed.
const EXACT_UNIT_SECONDS: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };

interface ConsumableDateTime {
  startTime: number;
  endTime: number;
  relativeTimePeriod: string | null;
  selectedDate?: unknown;
  selectedTime?: unknown;
  valueType?: string;
  userChangedValue?: boolean;
  rerun?: boolean;
}

export default defineComponent({
  components: {
    OButton,
    OIcon,
    OTooltip,
    OInput,
    OSelect,
    OTime,
    ODateRangeCalendar,
    OPopover,
    DateTimeRangeList,
    OBadge,
    OShortcut,
    OToggleGroup,
    OToggleGroupItem,
  },
  props: {
    defaultType: {
      type: String,
      default: "relative",
    },
    defaultAbsoluteTime: {
      type: Object,
      default: null,
    },
    defaultRelativeTime: {
      type: String,
      default: "15m",
    },
    autoApply: {
      type: Boolean,
      default: false,
    },
    applyPresets: {
      type: Boolean,
      default: false,
    },
    initialTimezone: {
      type: String as PropType<string | null>,
      required: false,
      default: null,
    },
    disable: {
      type: Boolean,
      default: false,
    },
    queryRangeRestrictionMsg: {
      type: String,
      default: "",
    },
    queryRangeRestrictionInHour: {
      type: Number,
      default: 0,
    },
    dataTestName: {
      type: String,
      default: "date-time-btn",
    },
    disableRelative: {
      type: Boolean,
      default: false,
    },
    hideRelativeTime: {
      type: Boolean,
      default: false,
    },
    hideRelativeTimezone: {
      type: Boolean,
      default: false,
    },
    /** Starts the picker on this IANA zone and keeps zone changes local to it instead of writing the app's timezone. */
    pickerTimezone: {
      type: String,
      default: "",
    },
    /** Drops the paste box and the copy and paste buttons; a date-only picker then loses its whole top row. */
    hideClipboard: {
      type: Boolean,
      default: false,
    },
    hideRangeShift: {
      type: Boolean,
      default: false,
    },
    /** Turns off the ‹ shift, for a parent that knows there is nothing earlier to show. */
    disablePrevShift: {
      type: Boolean,
      default: false,
    },
    minDate: {
      type: String,
      default: null,
    },
    /** The last pickable calendar day (yyyy/MM/dd); absent means today, for a caller that schedules ahead. */
    maxDate: {
      type: String,
      default: null,
    },
    menuAlign: {
      type: String as PropType<"center" | "start" | "end">,
      default: "end",
    },
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "outline",
    },
    /** Offers Today … Last year; off where the backend only parses rolling `<n><unit>` periods. */
    calendarPresets: {
      type: Boolean,
      default: false,
    },
    /** The calendar offers days after today, so typed yearless dates may read as upcoming ones. */
    futureAllowed: {
      type: Boolean,
      default: false,
    },
    /** Reads calendar words (yesterday, last week) as rolling periods; only for recurring forms with no calendar presets. */
    rollingCalendarWords: {
      type: Boolean,
      default: false,
    },
    /** Sizes the trigger like a form field (full width, field height and border) instead of a toolbar button. */
    fieldAppearance: {
      type: Boolean,
      default: false,
    },
    /** Opens the picker as soon as it mounts, for a range the user just asked to add. */
    defaultOpen: {
      type: Boolean,
      default: false,
    },
    /** Drops the relative Seconds unit, for a caller that accepts only whole minutes. */
    hideSeconds: {
      type: Boolean,
      default: false,
    },
    /** Replaces the trigger's range text, for a caller that states the range on its own clock; empty keeps the picker's. */
    triggerText: {
      type: String,
      default: "",
    },
    /** Days of data the page keeps; rows, chips and dates wholly before it are greyed. Unset greys nothing. */
    retentionDays: {
      type: Number as PropType<number | null>,
      default: null,
    },
    /** Binds the global time-range keys (T [ ] - Z); only a page's own toolbar picker sets it, never a panel's. */
    shortcuts: {
      type: Boolean,
      default: false,
    },
    /** Offers undo after a zoom, shift, brush or zoom-out; pickers without range shift never show it. */
    undoable: {
      type: Boolean,
      default: true,
    },
    /** Chip set and calendar row order; dashboards lead with long ranges and show dates on the trigger. */
    preset: {
      type: String as PropType<TimeRangePreset>,
      default: "ops",
    },
    /** Live ranges show their dates after the name on the trigger; null follows the preset. */
    showDates: {
      type: Boolean as PropType<boolean | null>,
      default: null,
    },
    /** "always" shows the zone offset on the trigger even when it is the browser's. */
    zoneBadge: {
      type: String as PropType<"auto" | "always">,
      default: "auto",
    },
    /** The window a query's own `_timestamp` filter keeps inside the picked range, if any. */
    narrowedByQuery: {
      type: Object as PropType<{ startUs: number; endUs: number } | null>,
      default: null,
    },
  },

  emits: ["on:date-change", "on:timezone-change", "hide", "show", "on:undo"],

  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18nTyped();
    const clock = useTimeRangeZone(() => props.pickerTimezone);
    const {
      pickerZone,
      zone,
      intlLocale,
      tooltipNow,
      refreshTooltipNow,
      labelOptions,
      convertUnixTime,
      civilDayStart,
      absoluteToMicros,
      endFieldToMicros,
      isZoneMidnight,
      relativeLabel,
      resolveRelativePeriod,
      calendarTooltip,
    } = clock;
    const limits = useTimeRangeLimits(props, clock);
    const { calendarMinDate, calendarMaxDate, trustedRange, calendarExceedsRestriction } = limits;
    const selectedType = ref("relative");
    const relativePeriod = ref("m");
    const relativeValue = ref(15);
    // A selected calendar period overrides relativePeriod/relativeValue while the type is relative.
    const calendarToken = ref<string | null>(null);
    const appliedCalendarToken = ref<string | null>(null);
    // A typed running period (`Q4`, `FY26`) keeps its typed name only while its token is the one set by that typing.
    const calendarName = ref<string | null>(null);
    const appliedCalendarName = ref<string | null>(null);
    watch(calendarToken, () => (calendarName.value = null), { flush: "sync" });
    // A typed period name (`Q4 2026`) stays only on the exact instants it was typed for; a zone redraw keeps them.
    const namedRange = ref<{ name: string; startUs: number; endUs: number } | null>(null);
    const absoluteLabelInput = (startUs: number, endUs: number): RangeLabelInput => {
      const named = namedRange.value;
      return named && named.startUs === startUs && named.endUs === endUs
        ? { startUs, endUs, name: named.name, period: true }
        : { startUs, endUs };
    };
    // Type and relative selection last applied; closing without Apply restores these.
    let appliedSelection = {
      selectedType: "relative",
      calendarToken: null as string | null,
      relativePeriod: "m",
      relativeValue: 15,
    };
    // A single clicked day the range calendar is still waiting to pair with an end date.
    const pendingDay = ref<string | null>(null);
    // The day a second calendar pick would end on, under the pointer or focus.
    const calendarPreviewDay = ref<string | null>(null);
    const calendarRef = ref<DateRangeCalendarExposed | null>(null);
    // The Start/End fields as the panel opened, restored when it closes with nothing applied, since showing a relative pick overwrites it.
    let absoluteAtOpen: FieldsSnapshot | null = null;
    let appliedSinceOpen = false;
    // The panel aligns to the whole ‹ trigger › group, not the trigger alone.
    const groupEl = ref<HTMLElement | null>(null);
    const menuEl = ref<HTMLElement | null>(null);
    const inputBar = ref<{ focus: () => void } | null>(null);
    const menuOpen = ref(false);
    // Index into the list rows below the suggestions; -1 while the cursor is in the bar.
    const listCursor = ref(-1);
    const calendarMode = ref(false);
    // The rolling period in force, so the one chip equal to it is the only control lit for it.
    const appliedPeriod = ref<string | null>(null);
    const lastValidCustomValue = ref(15);

    let relativePeriods = [
      { label: t("common.seconds"), value: "s" },
      { label: t("common.minutes"), value: "m" },
      { label: t("common.hours"), value: "h" },
      { label: t("common.days"), value: "d" },
      { label: t("common.weeks"), value: "w" },
      { label: t("common.months"), value: "M" },
    ].filter((period) => !props.hideSeconds || period.value !== "s");

    const inputErrorId = useId();
    const listId = useId();

    let relativePeriodsMaxValue = ref<Record<string, number>>({
      s: 0,
      m: 0,
      h: 0,
      d: 0,
      w: 0,
      M: 0,
    });

    const periodUnits = ["s", "m", "h", "d", "w", "M"];

    const pastPeriodKey = computed<I18nKey>(() => PAST_PERIOD_KEYS[relativePeriod.value]);

    const isValidCustomValue = (value: unknown) =>
      value !== "" && value !== null && Number.isFinite(Number(value));

    // A mid-edit custom value (empty, 2.5, 0) reads as the last whole count, so the label and the emitted range agree.
    const normalizedCount = (): number => {
      const count = Math.trunc(Number(relativeValue.value));
      return isValidCustomValue(relativeValue.value) && count >= 1
        ? count
        : lastValidCustomValue.value;
    };

    const currentRelativePeriod = (): string =>
      calendarToken.value ?? `${normalizedCount()}${relativePeriod.value}`;

    // A day-only or zone-hidden picker never shows a zone, so its line and the as-UTC chip must not either.
    const showsZone = computed(() => !props.hideRelativeTimezone && !props.hideRelativeTime);

    // The applied range is already the summary, so Recent never repeats it.
    const currentEntry = computed<TimeRangeHistoryEntry | null>(() => {
      if (selectedType.value === "relative") return { relative: currentRelativePeriod() };
      const range = pendingRange.value;
      return range ? { startUs: range.startTime, endUs: range.endTime } : null;
    });

    const rail = useTimeRangeRail(props, {
      clock,
      limits,
      currentEntry,
      appliedPeriod,
      boundedPeriod,
      listCursor,
      inputBar,
    });
    const {
      showRail,
      editingPinRowId,
      showChips,
      chipItems,
      litChip,
      chipsNotes,
      recordEntry,
      removeRecentRange,
      pinRecentRow,
      unpinRow,
      removeRecentRow,
      renamePin,
      cancelPinName,
    } = rail;

    const typingBar = useTimeRangeTyping(props, {
      clock,
      limits,
      relativePeriods,
      relativePeriodsMaxValue,
      showsZone,
      menuOpen,
      listCursor,
      inputBar,
      defaultRows: rail.defaultRows,
      applyPlan,
      finish: finishInput,
      pickListRow,
      removeRecentRow,
      pinRecentRow,
      unpinRow,
    });
    const {
      inputText,
      inputError,
      inputRefusal,
      inputErrorText,
      inputAsUtc,
      suggestionsOpen,
      suggestionRows,
      activeSuggestion,
      typing,
      listRows,
      shownRows,
      activeRow,
      listHeading,
      asUtcLabel,
      cancelPendingRead,
      clearInput,
      onInputEdit,
      applyTypedReading,
      onInputKeydown,
      onBarFocusOut,
      escapeInput,
      setCursorRow,
      toggleAsUtc,
      applySuggestion,
      pickShownRow,
      pasteRange,
    } = typingBar;

    const fields = useTimeRangeFields({
      clock,
      limits,
      selectedType,
      calendarToken,
      pendingDay,
      calendarPreviewDay,
      menuOpen,
      clearInput,
      readPastedStamp: typingBar.readPastedStamp,
    });
    // A picker with no calendar rows and nothing recent still teaches the grammar instead of a blank body.
    const emptyExamples = computed<TimeRangeListRow[]>(() =>
      props.hideClipboard || inputText.value.trim() || shownRows.value.length > 0
        ? []
        : TIME_INPUT_EXAMPLES.map((example, index) => ({
            id: `example-${index}`,
            kind: "example" as const,
            label: example.text,
            meta: String(t(example.description)),
            disabled: false,
            testId: `date-time-list-example-${index}`,
            group: 0,
          })),
    );
    const bodyRows = computed(() =>
      emptyExamples.value.length > 0 ? emptyExamples.value : shownRows.value,
    );
    // Typed text lights the row Enter would take: its reading, else the first list row it filtered to.
    const cursorRow = computed(() => {
      if (emptyExamples.value.length > 0) return -1;
      if (activeRow.value >= 0 || !typing.value) return activeRow.value;
      const rows = shownRows.value;
      if (rows[0]?.id.startsWith("reading-")) return rows[0].disabled ? -1 : 0;
      if (typingBar.inputReading.value) return -1;
      return rows.findIndex((row) => !row.disabled && row.kind !== "example");
    });
    const pickBodyRow = (index: number) => {
      const example = emptyExamples.value[index];
      if (!example) return pickShownRow(index);
      inputText.value = example.label;
      onInputEdit();
      inputBar.value?.focus();
    };

    const {
      selectedTime,
      selectedDate,
      timeFieldFocused,
      timeFieldError,
      unreadableFields,
      typedFieldTime,
      writeSeededFields,
      resetTime,
      shownEndMicros,
      writeAbsoluteFields,
      absoluteFieldsKey,
      getUTCTimeStamp,
      holdUnshownInstants,
      lastInstant,
      rememberShownEnd,
      rememberSeededEnd,
      writeOutsideRange,
      clearTimeFieldErrors,
      onCalendarStartDate,
      onCalendarEndDate,
      onCalendarPendingDay,
      commitPendingDay,
      onStartTimeEdit,
      onEndTimeEdit,
      onTimeFieldTyping,
      onTimeFieldInvalid,
      onTimeFieldBlur,
      startDayLabel,
      endDayLabel,
    } = fields;

    // The pending selection as microseconds, including a clicked day still waiting for its end.
    const pendingRange = computed<{ startTime: number; endTime: number } | null>(() => {
      if (selectedType.value === "relative" && !props.disableRelative) {
        return resolveRelativePeriod(currentRelativePeriod(), tooltipNow.value);
      }
      const pending = menuOpen.value ? pendingDay.value : null;
      if (pending === null) {
        const { startUTC, endUTC } = getUTCTimeStamp();
        return { startTime: startUTC, endTime: endUTC };
      }
      return {
        startTime: absoluteToMicros(pending, selectedTime.value.startTime),
        endTime: endFieldToMicros(pending, selectedTime.value.endTime),
      };
    });

    const { zoneRedrawn, kindText, resolvedLine, previewLine, shownLine } = useTimeRangeSummary(
      props,
      {
        clock,
        fields,
        typing: typingBar,
        selectedType,
        pendingDay,
        calendarPreviewDay,
        calendarMode,
        menuOpen,
        pendingRange,
        currentRelativePeriod,
      },
    );

    const currentTimezone = useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = ref(props.pickerTimezone || currentTimezone);
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => {
      return tz;
    });
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserTime = raw("Browser Time (" + browserTz + ")");

    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);
    if (props.pickerTimezone && !timezoneOptions.includes(props.pickerTimezone)) {
      timezoneOptions.unshift(props.pickerTimezone);
    }

    // A fixed range keeps its instants across a zone change and is only redrawn; live ones re-resolve.
    const onTimezoneChange = async () => {
      const fixed = selectedType.value === "absolute" ? getUTCTimeStamp() : null;
      let selectedTimezone = timezone.value;
      if (selectedTimezone.toLowerCase() == browserTime.toLowerCase()) {
        selectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      if (props.pickerTimezone) {
        pickerZone.value = selectedTimezone;
      } else {
        useLocalTimezone(selectedTimezone);
        store.dispatch("setTimezone", selectedTimezone);
      }
      await nextTick();
      // A pending live pick still closes back to the applied fixed range, so its fields redraw too.
      redrawAbsoluteAtOpen();
      if (fixed) {
        writeAbsoluteFields(fixed.startUTC, fixed.endUTC);
        holdUnshownInstants(fixed.startUTC, fixed.endUTC);
        // After the flush in which the redrawn fields settle, or the selection watcher clears it.
        nextTick(() => (zoneRedrawn.value = true));
      } else if (props.autoApply) {
        // Read after the await: a linked fixed range is only set once the picker mounts.
        saveDate(selectedType.value);
      }

      emit("on:timezone-change", selectedTimezone);
    };

    // An initial timezone matches the offered zones ignoring case, and is written to the store.
    if (props.initialTimezone) {
      timezone.value =
        timezoneOptions.find((tz) => tz.toLowerCase() === props.initialTimezone?.toLowerCase()) ||
        currentTimezone;
      onTimezoneChange();
    }

    const filteredTimezone: any = ref(timezoneOptions);
    const isTimezoneSelectOpen = ref(false);

    // OSelect filters by substring, so the matched zones carry the query itself and arrive in rank order.
    const zoneQuery = ref("");
    const timezoneSelectOptions = computed(() => {
      const term = zoneQuery.value.trim().toLowerCase();
      if (!term) return allTimezoneOptions.value;
      return searchTimeZones(allTimezoneOptions.value, term, (option) =>
        option.value === browserTime ? browserTz : option.value,
      ).map((option) => ({ ...option, searchText: term }));
    });
    const allTimezoneOptions = computed(() =>
      timezoneOptions.map((tz: string) => {
        const isBrowser = tz === browserTime;
        const zone = isBrowser ? browserTz : tz;
        const offset = zoneOffset(zone, tooltipNow.value);
        const suffix = offset ? raw(`UTC${offset}`) : undefined;
        if (isBrowser) {
          return { label: t("common.browserTimeWithZone", { zone: browserTz }), suffix, value: tz };
        }
        if (tz === "UTC") return { label: raw(tz), suffix, value: tz };
        // The label is the name alone, so `utc` matches zone names, not every `UTC+…` offset.
        return { label: raw(tz), suffix, value: tz, searchText: offset };
      }),
    );

    const datetimeBtn = ref<unknown>(null);

    const displayValue = ref("");

    // The label as of the last apply, which the trigger shows; without autoApply a pending selection is not in force.
    const appliedDisplayValue = ref("");
    // The applied type and absolute range, so the closed trigger can label them compactly.
    const appliedType = ref("relative");
    const appliedRange = ref<{ startTime: number; endTime: number } | null>(null);

    const datePayload = ref({});
    // True while this picker's own change is being emitted, so a page answering it in the handler is not a new range.
    let emittingOwnChange = false;

    const dateLocale = {
      daysShort: ["S", "M", "T", "W", "T", "F", "S"],
    };

    onMounted(() => {
      try {
        resetTime("", "");

        let startTime = (new Date().getTime() - 900000) * 1000;
        let endTime = new Date().getTime() * 1000;

        if (props.defaultAbsoluteTime?.startTime) {
          startTime =
            props.defaultAbsoluteTime?.startTime.toString().length > 13
              ? props.defaultAbsoluteTime?.startTime
              : props.defaultAbsoluteTime?.startTime * 1000;
        }

        if (props.defaultAbsoluteTime?.endTime) {
          endTime =
            props.defaultAbsoluteTime?.endTime.toString().length > 13
              ? props.defaultAbsoluteTime?.endTime
              : props.defaultAbsoluteTime?.endTime * 1000;
        }

        // A link with an empty period and no readable from/to means the default live range, not a frozen one.
        const given = (value: unknown) => Number.isFinite(Number(value)) && Number(value) !== 0;
        const unreadableAbsolute =
          props.defaultAbsoluteTime != null &&
          !(given(props.defaultAbsoluteTime.startTime) && given(props.defaultAbsoluteTime.endTime));
        const initialType = props.disableRelative
          ? "absolute"
          : props.defaultType === "absolute" && unreadableAbsolute
            ? "relative"
            : props.defaultType;
        selectedType.value = initialType;

        markProgrammaticDateChange();
        const rangeOutcome = writeOutsideRange(startTime, endTime);
        const periodKept = readRelativeTime(props.defaultRelativeTime) !== "refused";
        if (initialType === "absolute" ? rangeOutcome === "refused" : !periodKept) {
          fallBackToDefaultPeriod();
        } else if (initialType === "absolute" && rangeOutcome === "corrected") {
          toastRangeCut();
        }

        if (props.queryRangeRestrictionInHour) computeRelativePeriod();
        // Stamped programmatic, so consumers skip a refetch; the parent's own onMounted covers the first load.
        saveDate(selectedType.value);
      } catch (e) {
        console.log(e);
      }
    });

    watch(
      () => {
        selectedTime.value.startTime;
        selectedTime.value.endTime;
        selectedDate.value?.from;
        selectedDate.value?.to;
        pendingDay.value;
      },
      () => {
        // In the open panel only Apply, Enter or a pick applies; a parent's setter still does.
        if (menuOpen.value && isUserInitiated) return;
        if (absoluteFieldsKey() === savedFieldsKey) return;
        if (
          props.autoApply &&
          selectedType.value === "absolute" &&
          !fields.isSeeding() &&
          pendingDay.value === null &&
          store.state.savedViewFlag == false
        ) {
          saveDate("absolute");
        }
      },
      { deep: true },
    );

    watch(
      () => props.defaultType,
      () => {
        if (props.defaultType !== selectedType.value) {
          selectedType.value = props.defaultType;
        }
      },
    );

    const setRelativeDate = (
      period: string,
      value: number,
      commit: boolean = props.autoApply || props.applyPresets,
    ) => {
      refreshTooltipNow();
      selectedType.value = "relative";
      calendarToken.value = null;
      pendingDay.value = null;
      relativePeriod.value = period;
      relativeValue.value = value;
      if (commit) saveDate("relative");
    };

    // A period from outside the picker, capped as Custom is and to the calendar's first day; null when it is not a whole-count period.
    function boundedPeriod(period: string): string | null {
      if (resolveCalendarPeriod(period, zone.value)) return period;
      const rolling = parseRollingPeriod(period);
      if (!rolling || !periodUnits.includes(rolling.unit)) return null;
      const { unit } = rolling;
      const nowMs = Date.now();
      const floorUs = convertToUtcTimestamp(`${calendarMinDate.value} 00:00:00`, zone.value);
      const reach = Math.floor((nowMs * 1000 - floorUs) / (UNIT_SECONDS[unit] * MICROS_PER_SECOND));
      let count = Math.min(rolling.value, MAX_CUSTOM_RELATIVE_VALUE[unit], reach);
      // A 25h DST day can still overshoot the nominal reach by one.
      while (count > 1 && clock.rollingRange(count, unit, nowMs).startTime < floorUs) count -= 1;
      if (count < 1) return null;
      if (count === rolling.value) return period;
      const [cappedUnit, cappedCount] = largestExactUnit(unit, count);
      return `${cappedCount}${cappedUnit}`;
    }

    // "corrected" and "refused" tell a caller from outside that the range in force is not the one it asked for.
    const readRelativeTime = (period: unknown): "kept" | "corrected" | "refused" => {
      const text = typeof period === "string" ? period.trim() : "";
      if (!text) return "kept";
      const bounded = boundedPeriod(text);
      if (bounded === null) return "refused";
      const calendarRange = resolveCalendarPeriod(bounded, zone.value);
      if (calendarRange && props.calendarPresets) {
        calendarToken.value = bounded;
        return "kept";
      }
      if (calendarRange) {
        // A stale token beside an applied absolute range is not the range in force, so it must not replace it.
        if (selectedType.value !== "relative") return "kept";
        // A picker without calendar presets keeps a shared calendar range as its dates instead of dropping it.
        selectedType.value = "absolute";
        calendarToken.value = null;
        markProgrammaticDateChange();
        writeOutsideRange(calendarRange.startTime, calendarRange.endTime);
        return "kept";
      }
      const rolling = parseRollingPeriod(bounded);
      if (rolling) {
        calendarToken.value = null;
        relativePeriod.value = rolling.unit;
        relativeValue.value = rolling.value;
      }
      if (bounded === text) return "kept";
      // A silently shortened range would read as the one the link asked for.
      toast({
        variant: "warning",
        message: t("common.timeRangeShortened", { label: relativeLabel(bounded) }),
      });
      return "corrected";
    };

    const setRelativeTime = (period: string) => {
      clearUndoForPageRange({ relativeTimePeriod: period });
      const outcome = readRelativeTime(period);
      if (outcome === "kept") return;
      markProgrammaticDateChange();
      if (outcome === "refused") fallBackToDefaultPeriod();
      else if (!props.disableRelative) selectedType.value = "relative";
      emitCorrectionLater();
    };

    // A range the picker cannot show must never reach a query, so the picker says so and shows the default 15 minutes.
    const fallBackToDefaultPeriod = () => {
      toast({ variant: "warning", message: t("common.timeRangeOutOfBounds") });
      const nowUs = Date.now() * 1000;
      writeAbsoluteFields(nowUs - 15 * MICROS_PER_MINUTE, nowUs);
      calendarToken.value = null;
      relativePeriod.value = "m";
      relativeValue.value = 15;
      lastValidCustomValue.value = 15;
      selectedType.value = props.disableRelative ? "absolute" : "relative";
    };

    // A silently cut range would read as the one the link asked for.
    const toastRangeCut = () => {
      const range = getConsumableDateTime();
      toast({
        variant: "warning",
        message: t("common.timeRangeShortened", {
          label: formatRangeLabel(
            { startUs: range.startTime, endUs: range.endTime },
            { ...labelOptions(), surface: "toast" },
          ),
        }),
      });
    };

    const setAbsoluteTime = (startTime: number, endTime: number) => {
      // Parent-invoked setter — the resulting auto-apply emit is programmatic.
      markProgrammaticDateChange();
      clearUndoForPageRange({ startTime, endTime });
      const outcome = writeOutsideRange(startTime, endTime);
      if (outcome === "refused") fallBackToDefaultPeriod();
      else if (outcome === "corrected") toastRangeCut();
      // A parent's range set while the panel is open is what closing without Apply returns to.
      if (menuOpen.value && absoluteAtOpen !== null) absoluteAtOpen = fields.snapshotFields();
      if (outcome !== "kept") emitCorrectionLater();
    };

    const refresh = () => {
      // Parent-invoked (e.g. on tab re-activation / auto-refresh) — programmatic.
      markProgrammaticDateChange();
      saveDate();
    };

    // Stamped on each emit as `userChangedValue`, so consumers can ignore parent-invoked setters and mount replay.
    let isUserInitiated = true;
    // Reset after the flush: pre-flush watchers, such as the auto-apply date watcher, still read `false`.
    const markProgrammaticDateChange = () => {
      isUserInitiated = false;
      nextTick(() => {
        isUserInitiated = true;
      });
    };

    let saveCount = 0;
    // The fields as last saved, so a step that saves its own write is not saved again by the date watcher.
    let savedFieldsKey: string | null = null;
    const appliedSpeech = ref("");
    // Callers often follow a setter with setDateType or refresh, so a setter's correction is emitted only if no save followed it.
    const emitCorrectionLater = () => {
      const seen = saveCount;
      nextTick(() => {
        if (saveCount !== seen) return;
        isUserInitiated = false;
        saveDate(null);
        isUserInitiated = true;
      });
    };

    let entryAtOpen: TimeRangeHistoryEntry | null = null;
    // The trigger shows only what is in force, so this runs on every path that applies a range.
    // Panel edits without autoApply stay pending until Apply.
    const markApplied = () => {
      const outgoing = appliedHistoryEntry();
      appliedSinceOpen = true;
      appliedPeriod.value =
        selectedType.value === "relative" && calendarToken.value === null
          ? currentRelativePeriod()
          : null;
      appliedDisplayValue.value = getDisplayValue.value;
      appliedType.value = selectedType.value;
      if (selectedType.value === "absolute") {
        const { startUTC, endUTC } = getUTCTimeStamp();
        appliedRange.value = { startTime: startUTC, endTime: endUTC };
      } else {
        appliedRange.value = null;
      }
      appliedCalendarToken.value = selectedType.value === "relative" ? calendarToken.value : null;
      appliedCalendarName.value = appliedCalendarToken.value ? calendarName.value : null;
      appliedSelection = {
        selectedType: selectedType.value,
        calendarToken: calendarToken.value,
        relativePeriod: relativePeriod.value,
        relativeValue: relativeValue.value,
      };
      const incoming = appliedHistoryEntry();
      if (outgoing && incoming && !sameHistoryEntry(outgoing, incoming)) recordOutgoing(outgoing);
    };

    // A range from a link or a step never passed through the panel, so Recent keeps it once the user replaces it.
    // Inside the panel only the range in force at open counts, not each auto-applied edit.
    function recordOutgoing(outgoing: TimeRangeHistoryEntry) {
      if (!isUserInitiated || !showRail.value) return;
      if (menuOpen.value && !(entryAtOpen && sameHistoryEntry(outgoing, entryAtOpen))) return;
      recordEntry(outgoing);
    }

    function appliedHistoryEntry(): TimeRangeHistoryEntry | null {
      const range = appliedRange.value;
      if (appliedType.value === "absolute") {
        return range ? { startUs: range.startTime, endUs: range.endTime } : null;
      }
      const period = appliedCalendarToken.value ?? appliedPeriod.value;
      return period ? { relative: period } : null;
    }

    // Closing without Apply restores the fields seen at open, so a zone change redraws them from the applied instants.
    const redrawAbsoluteAtOpen = () => {
      const applied = appliedRange.value;
      if (absoluteAtOpen === null || appliedSinceOpen || applied === null) return;
      const start = convertUnixTime(applied.startTime);
      const end = convertUnixTime(shownEndMicros(applied.startTime, applied.endTime));
      absoluteAtOpen = {
        date: { from: start.date, to: end.date },
        time: { startTime: start.time, endTime: end.time },
        seededEnd: null,
      };
    };

    const restoreAppliedSelection = () => {
      selectedType.value = appliedSelection.selectedType;
      calendarToken.value = appliedSelection.calendarToken;
      calendarName.value = appliedCalendarName.value;
      relativePeriod.value = appliedSelection.relativePeriod;
      relativeValue.value = appliedSelection.relativeValue;
      const atOpen = absoluteAtOpen;
      if (appliedSinceOpen || atOpen === null) return;
      writeSeededFields({ ...atOpen.date, ...atOpen.time }, atOpen.seededEnd);
    };

    // `rerun` asks the page to run the range at once, even unchanged: a lit chip again, or the undo of a run zoom.
    const saveDate = (dateType?: string | null, rerun = false) => {
      saveCount += 1;
      savedFieldsKey = selectedType.value === "absolute" ? absoluteFieldsKey() : null;
      // The resolved line and the seeded Start/End read this clock, so they match the range emitted now.
      if (selectedType.value === "relative") refreshTooltipNow();
      markApplied();
      const date = getConsumableDateTime();
      datePayload.value = date;
      date["valueType"] = dateType || selectedType.value;
      date["userChangedValue"] = isUserInitiated;
      if (rerun) date["rerun"] = true;
      if (isUserInitiated) nextTick(() => (appliedSpeech.value = String(triggerLabel.value)));
      if (store.state.savedViewFlag == false) {
        emittingOwnChange = true;
        try {
          emit("on:date-change", date);
        } finally {
          emittingOwnChange = false;
        }
      }
    };

    // Writes true instants in the picker zone, holding them where its civil fields cannot show them.
    const applyInstants = (dateType: string, startUs: number, endUs: number) => {
      fields.writeInstants(startUs, endUs);
      selectedType.value = dateType;
      markProgrammaticDateChange();
      markApplied();
    };

    // Parent-invoked setter for a chart drag-zoom — programmatic, but a range the user picked.
    const setCustomDate = (dateType: string, dateobj: { start: number; end: number }): boolean => {
      // Charts hand over `toZonedTime(instant, appZone)` values, so they become instants once, before any bound.
      const appZone = store.state.timezone || zone.value;
      const range = trustedRange(
        instantFromShiftedMs(Math.floor(Number(dateobj.start)), appZone),
        instantFromShiftedMs(Math.floor(Number(dateobj.end)), appZone),
      );
      // A refused zoom (zero width, or past maxDate) keeps the range the user is looking at.
      if (!range) return false;
      const shownBefore = JSON.stringify([selectedType.value, absoluteFieldsKey()]);
      captureUndo(true);
      applyInstants(dateType, range.start, range.end);
      recordSelection();
      // Unchanged fields fire no watcher, yet the parent's search (e.g. Search around) still expects its run.
      const unchanged = shownBefore === JSON.stringify([selectedType.value, absoluteFieldsKey()]);
      if (unchanged && props.autoApply && store.state.savedViewFlag == false) saveDate(dateType);
      return true;
    };

    const onBeforeShow = () => {};

    const onBeforeHide = () => {
      if (selectedType.value === "absolute")
        resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
    };

    const getConsumableDateTime = (): ConsumableDateTime => {
      const calendarRange =
        selectedType.value === "relative"
          ? resolveCalendarPeriod(calendarToken.value, zone.value)
          : null;
      if (calendarRange) {
        return { ...calendarRange, relativeTimePeriod: calendarToken.value };
      }
      if (selectedType.value == "relative") {
        const period = `${normalizedCount()}${relativePeriod.value}`;
        const rolling = parseRollingPeriod(period);
        if (!rolling) console.error("getConsumableDateTime: Invalid relative period");
        return {
          ...clock.rollingRange(rolling?.value ?? 15, rolling?.unit ?? "m", Date.now()),
          relativeTimePeriod: period,
        };
      } else {
        if (typeof selectedDate.value === "string") {
          selectedDate.value = {
            from: selectedDate.value,
            to: selectedDate.value,
          };
        }

        const startDateStr = selectedDate.value.from + " " + selectedTime.value.startTime;
        const endDateStr = selectedDate.value.to + " " + selectedTime.value.endTime;

        let start, end;
        if (!selectedDate.value?.from && !selectedTime.value?.startTime) {
          start = new Date();
        } else {
          start = new Date(startDateStr);
        }

        if (selectedDate.value?.to == "" && selectedTime.value?.endTime == "") {
          end = new Date();
        } else {
          end = new Date(endDateStr);
        }

        if (start.toString() === "Invalid Date" && end.toString() === "Invalid Date") {
          start = selectedDate.value + " " + selectedTime.value.startTime;
          end = selectedDate.value + " " + selectedTime.value.endTime;
        }
        const absoluteUTCTimestamp = getUTCTimeStamp();
        const rVal = {
          startTime: absoluteUTCTimestamp.startUTC,
          endTime: absoluteUTCTimestamp.endUTC,
          relativeTimePeriod: null,
          selectedDate: JSON.parse(JSON.stringify(selectedDate.value)),
          selectedTime: JSON.parse(JSON.stringify(selectedTime.value)),
        };
        return rVal;
      }
    };

    const setSavedDate = (dateobj: any) => {
      clearUndoForPageRange(
        dateobj.type === "relative"
          ? { relativeTimePeriod: dateobj.relativeTimePeriod }
          : { startTime: dateobj.startTime, endTime: dateobj.endTime },
      );
      timezone.value = zone.value;
      selectedType.value = dateobj.type;

      if (dateobj.type === "relative") {
        selectedType.value = "relative";
        readRelativeTime(dateobj.relativeTimePeriod);
      } else {
        if (
          Object.prototype.hasOwnProperty.call(dateobj, "selectedDate") &&
          Object.prototype.hasOwnProperty.call(dateobj, "selectedTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "from") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "to") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "startTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "endTime")
        ) {
          selectedDate.value = dateobj.selectedDate;
          selectedTime.value = dateobj.selectedTime;
        } else {
          applyInstants(dateobj.type, Number(dateobj.startTime), Number(dateobj.endTime));
        }
      }

      markApplied();
    };

    const { isMobile } = useBreakpoint();

    const labelSurface = computed(() => (props.preset === "dashboard" ? "dashboard" : "toolbar"));
    const datesShown = computed(() => props.showDates ?? props.preset === "dashboard");

    // Panel edits are not in force until applied, so the open panel's trigger names the applied range.
    const showsApplied = computed(() => menuOpen.value || !props.autoApply);

    const triggerRange = computed<RangeLabelInput | null>(() => {
      const shownApplied = showsApplied.value;
      const shownType = shownApplied ? appliedType.value : selectedType.value;
      if (shownType === "absolute") {
        const range = shownApplied ? appliedRange.value : pendingRange.value;
        if (!range || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
          return null;
        }
        return absoluteLabelInput(range.startTime, range.endTime);
      }
      const period = shownApplied
        ? (appliedCalendarToken.value ?? appliedPeriod.value)
        : currentRelativePeriod();
      if (!period) return null;
      const range = resolveRelativePeriod(period, tooltipNow.value);
      if (!range) return null;
      const typedName = shownApplied ? appliedCalendarName.value : calendarName.value;
      return {
        startUs: range.startTime,
        endUs: range.endTime,
        name: typedName ?? String(relativeLabel(period)),
        live: true,
        calendar: parseCalendarToken(period) !== null,
      };
    });

    // A day-only picker names the days its range touches; an exclusive midnight end belongs to the day before.
    const wholeDaysOf = (range: RangeLabelInput): RangeLabelInput => {
      const lastUs = isZoneMidnight(range.endUs) ? range.endUs - 1 : range.endUs;
      return {
        startUs: civilDayStart(convertUnixTime(range.startUs).date),
        endUs: civilDayStart(addCivilDays(convertUnixTime(lastUs).date, 1)),
      };
    };

    const triggerLabel = computed(() => {
      if (props.triggerText) return props.triggerText;
      const range = triggerRange.value;
      if (!range) {
        return showsApplied.value
          ? appliedDisplayValue.value || getDisplayValue.value
          : getDisplayValue.value;
      }
      if (props.disableRelative) {
        return formatRangeDates(props.hideRelativeTime ? wholeDaysOf(range) : range, {
          ...labelOptions(),
          surface: labelSurface.value,
        });
      }
      return formatRangeLabel(range, {
        ...labelOptions(),
        surface: labelSurface.value,
        showDates: datesShown.value,
      });
    });

    // Only a name may truncate on the trigger; its dates always show in full.
    const triggerParts = computed<{ name: string; dates: string }>(() => {
      const label = String(triggerLabel.value);
      const range = triggerRange.value;
      const name = range?.name && !props.disableRelative && !props.triggerText ? range.name : "";
      if (name && label.startsWith(`${name} · `)) {
        return { name, dates: label.slice(name.length + 3) };
      }
      return range && !range.live && !props.triggerText
        ? { name: "", dates: label }
        : { name: label, dates: "" };
    });

    // Line 1 the full stamps, line 2 zone, kind and length; the label alone can round them.
    const triggerTooltip = computed(() => {
      const range = triggerRange.value;
      if (!range || props.disableRelative || props.triggerText) return null;
      const detail = [
        formatZoneOffset(zone.value, range.startUs / 1000),
        kindText(range.live),
        formatRangeDuration(range.startUs, range.endUs),
      ].join(" · ");
      return { stamps: formatRangeStamps(range, labelOptions()), detail };
    });

    const triggerAriaLabel = computed(() =>
      t("dateTime.triggerLabel", {
        label: String(triggerLabel.value),
        zone: formatZoneOffset(zone.value, tooltipNow.value),
      }),
    );

    const triggerTooltipOpen = ref(false);
    let triggerHoverTimer: ReturnType<typeof setTimeout> | null = null;
    const onTriggerHover = (on: boolean) => {
      if (triggerHoverTimer !== null) clearTimeout(triggerHoverTimer);
      triggerHoverTimer = null;
      if (!on) {
        triggerTooltipOpen.value = false;
        return;
      }
      refreshTooltipNow();
      triggerHoverTimer = setTimeout(() => {
        triggerTooltipOpen.value = true;
      }, 400);
    };
    onBeforeUnmount(() => onTriggerHover(false));
    const triggerElement = computed<HTMLElement | null>(() => {
      const button = datetimeBtn.value as { $el?: HTMLElement } | null;
      return button?.$el ?? null;
    });

    const getDisplayValue = computed(() => {
      const calendarLabel =
        !props.disableRelative && selectedType.value === "relative" && calendarToken.value !== null
          ? formatCalendarLabel(
              calendarToken.value,
              zone.value,
              t,
              intlLocale.value,
              tooltipNow.value,
            )
          : null;
      if (calendarLabel) return calendarLabel;
      if (!props.disableRelative && selectedType.value === "relative") {
        return t(pastPeriodKey.value, { count: normalizedCount() });
      } else {
        if (selectedDate.value != null) {
          // A range selection has from and to keys; a single picked date arrives as a plain string.
          if (selectedDate.value?.from && selectedDate.value?.to && !props.disableRelative) {
            // A pending single clicked day is what Apply will use, so the label shows it already.
            const pending = menuOpen.value ? pendingDay.value : null;
            const from = pending ?? selectedDate.value.from;
            const to = pending ?? selectedDate.value.to;
            return `${from} ${selectedTime.value.startTime} - ${to} ${selectedTime.value.endTime}`;
          } else if (selectedDate.value?.from && selectedDate.value?.to && props.disableRelative) {
            return `${selectedDate.value.from} - ${selectedDate.value.to}`;
          } else {
            return `${selectedDate.value} ${selectedTime.value.startTime} - ${selectedDate.value} ${selectedTime.value.endTime}`;
          }
        } else {
          const todayDate = new Date().toLocaleDateString("en-ZA");
          return `${todayDate} ${selectedTime.value.startTime} - ${todayDate} ${selectedTime.value.endTime}`;
        }
      }
    });

    // A clicked day still waiting for its end is the selection the panel shows, so Recent highlights it.
    const selectionKey = computed<string>(() => {
      if (selectedType.value === "relative") return `rel:${currentRelativePeriod()}`;
      const range = pendingRange.value;
      return range ? `${range.startTime}-${range.endTime}` : "";
    });

    // Any other pick replaces the selection the bar's text was aimed at, so the text goes with it.
    watch(selectionKey, () => {
      timeFieldError.value = null;
      zoneRedrawn.value = false;
      if (inputText.value) clearInput();
    });

    function applyPlan(plan: InputPlan) {
      clearUndo();
      if (plan.kind === "absolute") {
        applyAbsoluteRange(plan.start, plan.end, plan.calendarPeriod);
        const range = pendingRange.value;
        namedRange.value =
          plan.name && range
            ? { name: plan.name, startUs: range.startTime, endUs: range.endTime }
            : null;
        return;
      }
      if (plan.kind !== "rolling" && plan.kind !== "calendar") return;
      refreshTooltipNow();
      selectedType.value = "relative";
      pendingDay.value = null;
      if (plan.kind === "calendar") {
        calendarToken.value = plan.token;
        calendarName.value = plan.name ?? null;
        if (props.autoApply) saveDate("relative");
        return;
      }
      calendarToken.value = null;
      relativePeriod.value = plan.unit;
      relativeValue.value = plan.value;
      lastValidCustomValue.value = plan.value;
      if (props.autoApply) saveDate("relative-custom");
    }

    function finishInput() {
      if (props.autoApply) closeMenu();
      else applyAndClose();
    }

    // The selection as the label formatter reads it, for the copied text.
    const selectionRange = computed<RangeLabelInput | null>(() => {
      const range = pendingRange.value;
      if (!range || !Number.isFinite(range.startTime) || !(range.endTime > range.startTime)) {
        return null;
      }
      if (selectedType.value !== "relative" || props.disableRelative) {
        return absoluteLabelInput(range.startTime, range.endTime);
      }
      const period = currentRelativePeriod();
      return {
        startUs: range.startTime,
        endUs: range.endTime,
        name: calendarName.value ?? String(relativeLabel(period)),
        live: true,
        calendar: parseCalendarToken(period) !== null,
      };
    });

    const copyDisabled = computed(() => selectionRange.value === null);
    const copyShortcut = isMacOS() ? "ctrl+shift+c" : "alt+shift+c";

    // Readable text the bar reads back; it names the zone, so it means the same in every timezone.
    const copyRange = () => {
      const range = selectionRange.value;
      if (!range) return;
      copyToClipboard(formatRangeCopyText(range, labelOptions()), t, {
        successMessage: t("common.dateRangeCopied"),
      });
    };

    const applyAbsoluteRange = (
      startMicros: number,
      endMicros: number,
      calendarPeriod: string | null,
    ) => {
      selectedType.value = "absolute";
      calendarToken.value = null;
      // A day clicked before the paste would otherwise overwrite the pasted range when the panel closes.
      pendingDay.value = null;
      // An exclusive midnight end shows as the day before's 23:59:59, which reads back as that midnight.
      const midnightEnd = endMicros > startMicros && isZoneMidnight(endMicros);
      writeAbsoluteFields(
        startMicros,
        midnightEnd ? endMicros - MICROS_PER_SECOND : lastInstant(calendarPeriod, endMicros),
      );
      if (calendarPeriod !== null && !midnightEnd) rememberSeededEnd(calendarPeriod, endMicros);
      holdUnshownInstants(startMicros, endMicros);
      if (props.autoApply) {
        saveDate(null);
        recordSelection();
      }
    };

    // A stamp pasted into Start or End fills them; any other paste goes to the bar.
    const onPickerPaste = (event: ClipboardEvent) => {
      if (fields.pasteIntoTimeFields(event)) return;
      typingBar.onBarPaste(event);
    };

    const timezoneFilterFn = (val: string, update: (cb: () => void) => void) => {
      filteredTimezone.value = filterColumns(timezoneOptions, val, update);
    };

    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter((column: any) => column.toLowerCase().includes(value));
      });
      return filteredOptions;
    };

    const optionsFn = (date: string) => {
      const formattedDate = calendarMaxDate.value;
      if (props.disableRelative) {
        return date >= props.minDate && date <= formattedDate;
      }
      return date >= "1999/01/01" && date <= formattedDate;
    };

    // Resolved at the resolved line's clock, so the fields and the line show the same instants.
    const seedAbsoluteFromSelection = () => {
      const range = resolveRelativePeriod(currentRelativePeriod(), tooltipNow.value);
      if (!range) return;
      const { startTime, endTime } = range;
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
      const start = convertUnixTime(startTime);
      const end = convertUnixTime(lastInstant(calendarToken.value, endTime));
      rememberSeededEnd(calendarToken.value, endTime);
      writeSeededFields({
        from: start.date,
        to: end.date,
        startTime: start.time,
        endTime: end.time,
      });
    };

    const setDateType = (type: string) => {
      selectedType.value = type;
      if (props.autoApply) saveDate(type === "absolute" ? "absolute" : "relative-custom");
    };

    // Ctrl+Shift+C opens DevTools off macOS, so there the combo is Alt+Shift+C; the key code survives layouts.
    const isCopyRangeKey = (event: KeyboardEvent) =>
      event.shiftKey &&
      event.code === "KeyC" &&
      (isMacOS()
        ? event.metaKey && !event.ctrlKey && !event.altKey
        : event.altKey && !event.ctrlKey && !event.metaKey);

    // Escape backs out one layer: the list cursor or typed text, a pending day, the calendar, then the panel.
    const onPickerKeydown = (event: KeyboardEvent) => {
      if (isCopyRangeKey(event)) {
        // Handled on the panel so a page's own copy-URL binding of the same combo never wins while it is open.
        event.preventDefault();
        event.stopPropagation();
        copyRange();
        return;
      }
      if (moveListCursorToEnd(event)) return;
      if (event.key !== "Escape") return;
      const target = event.target;
      // A pin's name field cancels its own edit.
      if (
        target instanceof HTMLElement &&
        target.closest("[data-test='date-time-list-pin-name']")
      ) {
        return;
      }
      if (escapeInput(event)) return;
      // A half-picked day is dropped and the calendar stays; caught here so reka never restores its old range.
      if (pendingDay.value !== null) {
        event.preventDefault();
        event.stopPropagation();
        calendarRef.value?.clearPending();
        restoreAppliedSelection();
        pendingDay.value = null;
        calendarPreviewDay.value = null;
        return;
      }
      if (calendarMode.value && !props.disableRelative) {
        event.preventDefault();
        event.stopPropagation();
        closeCalendar();
        return;
      }
      // An open tooltip is the topmost dismissable layer and would take this Escape, so the panel closes itself; the zone list keeps its own Escape.
      if (!isTimezoneSelectOpen.value) {
        event.preventDefault();
        closeMenu();
      }
    };

    // With the cursor in the list, Home and End go to its first and last row instead of the bar's caret.
    const moveListCursorToEnd = (event: KeyboardEvent): boolean => {
      if (listCursor.value < 0 || (event.key !== "Home" && event.key !== "End")) return false;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      const enabled = listRows.value.flatMap((row, index) => (row.disabled ? [] : [index]));
      if (enabled.length === 0) return false;
      event.preventDefault();
      event.stopPropagation();
      listCursor.value = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
      return true;
    };

    // Seconds through days roll up into the largest offered unit that holds the count exactly, so 60m lights the 1h chip.
    const largestExactUnit = (unit: string, value: number): [string, number] => {
      if (!(unit in EXACT_UNIT_SECONDS)) return [unit, value];
      const seconds = value * EXACT_UNIT_SECONDS[unit];
      const fit = Object.entries(EXACT_UNIT_SECONDS).find(
        ([candidate, size]) =>
          seconds % size === 0 && relativePeriods.some((option) => option.value === candidate),
      );
      return fit ? [fit[0], seconds / fit[1]] : [unit, value];
    };

    // The per-unit maxima follow the restriction alone, so a period typed while the selection is absolute is still capped.
    const computeRelativeMaxima = () => {
      const limitSeconds = props.queryRangeRestrictionInHour * 3_600;
      relativePeriodsMaxValue.value = Object.fromEntries(
        periodUnits.map((unit) => {
          if (!(limitSeconds > 0)) return [unit, 0];
          const max = Math.floor(limitSeconds / UNIT_SECONDS[unit]);
          return [unit, max >= 1 ? max : -1];
        }),
      );
    };

    // Limits arrive after mount, so a clamp here is never the user's pick.
    const computeRelativePeriod = () => {
      markProgrammaticDateChange();
      computeRelativeMaxima();
      const periodBefore = currentRelativePeriod();
      if (selectedType.value === "relative") {
        if (calendarExceedsRestriction(calendarToken.value)) {
          // Clamped like a too-long rolling range: to the largest window the page allows.
          const unit = [...periodUnits].reverse().find((u) => relativePeriodsMaxValue.value[u] > 0);
          if (unit) {
            setRelativeDate(unit, relativePeriodsMaxValue.value[unit]);
          } else {
            calendarToken.value = null;
            if (props.autoApply) saveDate("relative");
          }
        }

        if (props.queryRangeRestrictionInHour > 0) {
          const maxRelativeValue = relativePeriodsMaxValue.value[relativePeriod.value];

          try {
            if (maxRelativeValue !== -1 && relativeValue.value > maxRelativeValue) {
              setRelativeDate(...largestExactUnit(relativePeriod.value, maxRelativeValue));
            } else if (maxRelativeValue === -1) {
              const periodIndex = periodUnits.indexOf(relativePeriod.value);
              for (let i = periodIndex; i >= 0; i--) {
                if (relativePeriodsMaxValue.value[periodUnits[i]] > -1) {
                  setRelativeDate(periodUnits[i], 1);
                  break;
                }
              }
            }
          } catch (e) {
            console.log("Error while setting relative date", e);
          }
        }
        if (currentRelativePeriod() !== periodBefore) limits.showRestrictionToast();
      }
    };

    const showOnlyAbsolute = () => {
      if (props.disableRelative) {
        setDateType("absolute");
      }
    };

    const onHide = () => {
      emit("hide");
    };

    const onShow = () => {
      emit("show");
    };

    const recordSelection = () => {
      if (!showRail.value) return;
      if (selectedType.value === "relative") {
        recordEntry({ relative: currentRelativePeriod() });
        return;
      }
      const { startUTC, endUTC } = getUTCTimeStamp();
      recordEntry({ startUs: startUTC, endUs: endUTC });
    };

    // An auto-applied selection is final only when the panel closes, not after every edit.
    let rangeKeyAtOpen: string | null = null;

    // While the open panel holds a relative selection, Start/End show the range it resolves to.
    watch(
      () => [
        menuOpen.value,
        selectedType.value,
        calendarToken.value,
        relativePeriod.value,
        relativeValue.value,
        zone.value,
        tooltipNow.value,
      ],
      () => {
        if (!menuOpen.value || selectedType.value !== "relative" || timeFieldFocused.value) return;
        if (calendarToken.value === null && !isValidCustomValue(relativeValue.value)) return;
        seedAbsoluteFromSelection();
      },
    );

    // Calendar labels name a day, the rail ends "so far" ranges at now and a live trigger shows its dates, so the clock runs only then.
    const needsClock = computed(
      () =>
        menuOpen.value ||
        (datesShown.value && appliedType.value === "relative") ||
        (props.calendarPresets &&
          (calendarToken.value !== null || appliedCalendarToken.value !== null)),
    );
    let clockTick: ReturnType<typeof setTimeout> | null = null;
    const stopClock = () => {
      if (clockTick !== null) clearTimeout(clockTick);
      clockTick = null;
    };
    // Ticks on the minute, so minute-precision dates turn over with the page's now, not up to a minute late.
    const tickClock = () => {
      refreshTooltipNow();
      clockTick = setTimeout(tickClock, 60_000 - (Date.now() % 60_000) + 50);
    };
    const syncClock = () => {
      if (!needsClock.value) return stopClock();
      if (clockTick !== null) return;
      tickClock();
    };
    watch(needsClock, syncClock, { immediate: true });
    onActivated(syncClock);
    onDeactivated(stopClock);
    onBeforeUnmount(stopClock);
    onBeforeUnmount(cancelPendingRead);
    // OPopover's content is reka's dialog, which takes no attributes from here.
    watch(menuEl, (panel) => panel?.closest("[role='dialog']")?.setAttribute("aria-modal", "true"));

    const onMenuOpenChange = (open: boolean) => {
      if (open) {
        refreshTooltipNow();
        pendingDay.value = null;
        fields.forgetEndCut();
        clearInput();
        clearTimeFieldErrors();
        listCursor.value = -1;
        editingPinRowId.value = null;
        calendarPreviewDay.value = null;
        zoneRedrawn.value = false;
        // A dates-only picker has no list, so its calendar is the panel.
        calendarMode.value = props.disableRelative;
        appliedSinceOpen = false;
        absoluteAtOpen = fields.snapshotFields();
        rangeKeyAtOpen = selectionKey.value;
        entryAtOpen = appliedHistoryEntry();
        onBeforeShow();
        onShow();
      } else {
        pendingDay.value = null;
        clearInput();
        listCursor.value = -1;
        editingPinRowId.value = null;
        restoreAppliedSelection();
        // A typed period applied by Enter is recorded here, once the panel it was typed in closes.
        if (props.autoApply && appliedSinceOpen && selectionKey.value !== rangeKeyAtOpen) {
          recordSelection();
        }
        onBeforeHide();
        onHide();
      }
    };

    // Typing lands in the bar, which leads the Tab order; on a touch screen, where focusing it raises the keyboard, reka's default focus stays.
    const onPopoverOpenAutoFocus = (event: Event) => {
      const touch = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const box = touch
        ? null
        : document.querySelector<HTMLElement>(
            "#date-time-menu [data-test='date-time-input-field']",
          );
      // With no bar, reka's default focus stays inside the panel, or ⌘V would never reach it.
      if (!box) return;
      event.preventDefault();
      box.focus();
    };

    // A pick closes the panel the way a user dismissal does, so listeners waiting on hide still run.
    // Reka returns focus only on its own dismissals, so focus inside the panel goes back to the trigger here.
    const closeMenu = () => {
      if (!menuOpen.value) return;
      const hadFocus = !!menuEl.value?.contains(document.activeElement);
      menuOpen.value = false;
      onMenuOpenChange(false);
      nextTick(() => {
        if (hadFocus && !menuOpen.value) triggerElement.value?.focus();
      });
    };

    const openMenu = () => {
      if (menuOpen.value || props.disable) return;
      menuOpen.value = true;
      onMenuOpenChange(true);
    };

    const applyAndClose = () => {
      clearUndo();
      commitPendingDay();
      saveDate(null);
      recordSelection();
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const openCalendar = () => {
      calendarMode.value = true;
      listCursor.value = -1;
      editingPinRowId.value = null;
    };

    // Leaving the calendar keeps whatever it applied; a half-picked day is dropped.
    const closeCalendar = () => {
      calendarMode.value = false;
      typedFieldTime.value = null;
      clearTimeFieldErrors();
      pendingDay.value = null;
      calendarPreviewDay.value = null;
      nextTick(() => inputBar.value?.focus());
    };

    const applyCalendarItem = (id: string) => {
      const preset = CALENDAR_RAIL_ITEMS.find((item) => item.id === id);
      if (!preset) return;
      clearUndo();
      selectedType.value = "relative";
      calendarToken.value = preset.token;
      calendarName.value = null;
      pendingDay.value = null;
      saveDate("relative");
      recordSelection();
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    // A chip applies at once, like a row, and is the only control that lights for the range it applied.
    const pickChip = (value: string, rerun = false) => {
      const rolling = parseRollingPeriod(value);
      if (!rolling) return;
      clearUndo();
      selectedType.value = "relative";
      calendarToken.value = null;
      pendingDay.value = null;
      relativePeriod.value = rolling.unit;
      relativeValue.value = rolling.value;
      lastValidCustomValue.value = rolling.value;
      saveDate("relative", rerun);
      recordSelection();
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const onChipToggle = (value: unknown) => {
      const chip = typeof value === "string" && value ? value : litChip.value;
      if (chip) pickChip(chip);
    };
    // A click on the lit chip applies it again and asks the page to re-run the same range.
    const onChipReselect = () => {
      if (litChip.value) pickChip(litChip.value, true);
    };

    const applyRecentPeriod = (period: string) => {
      selectedType.value = "relative";
      pendingDay.value = null;
      if (parseCalendarToken(period)) {
        calendarToken.value = period;
        calendarName.value = null;
      } else {
        calendarToken.value = null;
        readRelativeTime(period);
      }
      saveDate("relative");
      recordEntry({ relative: period });
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const applyHistoryEntry = (entry: TimeRangeHistoryEntry) => {
      clearUndo();
      if (isRelativeHistoryEntry(entry)) {
        applyRecentPeriod(entry.relative);
        return;
      }
      const range = limits.boundedRange(entry.startUs, entry.endUs);
      if (!range) return;
      const start = convertUnixTime(range.start);
      // An exclusive midnight end shows as the previous day's last second, as the row label does.
      const endsAtMidnight =
        range.end % MICROS_PER_SECOND === 0 && convertUnixTime(range.end).time === "00:00:00";
      const end = convertUnixTime(endsAtMidnight ? range.end - 1 : range.end);
      if (endsAtMidnight) rememberShownEnd(range.end);
      else fields.forgetSeededEnd();
      // Saved once below, so the auto-apply date watcher must not save it a second time.
      writeSeededFields({
        from: start.date,
        to: end.date,
        startTime: start.time,
        endTime: end.time,
      });
      holdUnshownInstants(range.start, range.end);
      selectedType.value = "absolute";
      calendarToken.value = null;
      saveDate("absolute");
      recordEntry(entry);
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const applyRecentRange = (id: string) => {
      const entry = rail.recentEntry(id);
      if (entry) applyHistoryEntry(entry);
    };

    // Row ids carry what they apply: a pin id, a Recent index or a calendar preset id.
    function pickListRow(index: number) {
      const row = listRows.value[index];
      if (!row || row.disabled) return;
      if (row.kind === "pinned") {
        const pin = rail.pinOf(row.id);
        if (pin) applyHistoryEntry(pin.range);
      } else if (row.kind === "recent") applyRecentRange(row.id.slice("recent-".length));
      else if (row.kind === "calendar") applyCalendarItem(row.id.slice("calendar-".length));
    }

    const {
      clearUndo,
      clearUndoForPageRange,
      captureUndo,
      undoRange,
      shiftTimeRange,
      isNextShiftDisabled,
      goLive,
      zoomOut,
      zoomOutBlocked,
      showUndo,
      undoTooltip,
      liveDurationLabel,
      stepTooltip,
    } = useTimeRangeStepping(props, {
      clock,
      limits,
      fields,
      selectedType,
      calendarToken,
      relativePeriod,
      relativeValue,
      pendingDay,
      pendingRange,
      triggerLabel,
      appliedSelection: () => appliedSelection,
      emittingOwnChange: () => emittingOwnChange,
      lastPayload: () => datePayload.value as Partial<ConsumableDateTime>,
      normalizedCount,
      largestExactUnit,
      setRelativeDate,
      saveDate,
      getConsumableDateTime,
      openMenu,
      closeMenu,
      onUndo: (step) => emit("on:undo", step),
    });

    // A badge when the zone differs from the browser's, or always where the page asks (dashboards, print).
    // Offset at the range's start, so a summer range opened in winter still shows its summer offset.
    const zoneBadgeText = computed(() => {
      if (!zone.value || props.hideRelativeTimezone) return "";
      const startUs = triggerRange.value?.startUs;
      const atMs = startUs !== undefined ? Math.floor(startUs / 1000) : tooltipNow.value;
      if (props.zoneBadge === "always") return formatZoneOffset(zone.value, atMs);
      return zone.value !== browserTz ? formatZoneBadge(zone.value, atMs) : "";
    });

    const zoneShortLabel = computed(() => {
      const offset = zoneOffset(zone.value, tooltipNow.value);
      if (zone.value === "UTC" || offset === "+00:00") return "UTC";
      return offset ? `UTC${offset}` : zone.value;
    });

    const retentionFloorDay = limits.retentionFloorDay;

    const weekStart = computed(() => weekStartsOn());

    // From a live range the calendar has no start yet, so there is nothing to apply.
    const needsStartDate = computed(
      () =>
        calendarMode.value &&
        !props.disableRelative &&
        selectedType.value === "relative" &&
        pendingDay.value === null,
    );
    // From a live range nothing is picked yet, so Start and End stay empty rather than echo the live dates.
    const fieldsBlank = computed(() => needsStartDate.value);
    // The days a calendar pick would apply, and those its pointer or focus previews, against the page's limits.
    const calendarLimit = computed<{ selection: string | null; preview: string | null }>(() => {
      if (!calendarMode.value || selectedType.value !== "absolute") {
        return { selection: null, preview: null };
      }
      const range = pendingRange.value;
      const selection = range ? limits.limitReason(range.startTime, range.endTime) : null;
      const pending = pendingDay.value;
      const hovered = calendarPreviewDay.value;
      if (pending === null || hovered === null) return { selection, preview: null };
      const [from, to] = pending <= hovered ? [pending, hovered] : [hovered, pending];
      const preview = limits.limitReason(
        absoluteToMicros(from, selectedTime.value.startTime),
        endFieldToMicros(to, "23:59:59"),
      );
      return { selection, preview };
    });

    // Text in the bar is what Apply applies, so a reading Enter would refuse leaves Apply off.
    const barBlockReason = computed<I18nText | null>(() => {
      if (!inputText.value.trim()) return null;
      if (inputError.value) return inputErrorText.value;
      const plan = typingBar.inputPlan.value;
      if (plan?.kind === "refused" || plan?.kind === "restricted") return plan.message;
      if (plan) return null;
      if (typingBar.inputFuture.value) return t("common.timeRangeStartInFuture");
      if (typingBar.inputReversed.value) return t("common.timeRangeEndBeforeStart");
      return t("common.timeRangeInputError");
    });
    // A readable bar is what Apply applies, so it needs no calendar pick first.
    const barApplies = computed(
      () => inputText.value.trim() !== "" && barBlockReason.value === null,
    );

    const applyDisabled = computed(
      () =>
        barBlockReason.value !== null ||
        (needsStartDate.value && !barApplies.value) ||
        unreadableFields.value.start ||
        unreadableFields.value.end ||
        calendarLimit.value.selection !== null,
    );

    const applyBlockedReason = computed<I18nText | undefined>(() => {
      if (barBlockReason.value) return barBlockReason.value;
      if (needsStartDate.value && !barApplies.value) return t("dateTime.pickStartDate");
      const reason = calendarLimit.value.selection;
      return reason ? raw(reason) : undefined;
    });

    const onApplyClick = () => {
      if (inputText.value.trim()) applyTypedReading();
      else applyAndClose();
    };

    // The native change fires after keydown, so blurring commits the typed text before Apply reads it.
    const onTimeFieldEnter = (event: KeyboardEvent) => {
      const field = event.target as HTMLInputElement | null;
      field?.blur();
      nextTick(() => {
        if (timeFieldError.value === null && !applyDisabled.value) applyAndClose();
        else field?.focus();
      });
    };

    const summaryError = computed<{ message: I18nText; examples?: I18nText } | null>(() => {
      if (inputError.value) {
        return {
          message: inputErrorText.value,
          examples: inputRefusal.value ? undefined : t("common.timeRangeInputExamples"),
        };
      }
      if (timeFieldError.value) return { message: timeFieldError.value.message };
      if (unreadableFields.value.start || unreadableFields.value.end) {
        return {
          message: t("components.time.invalid", { format: raw("HH:MM") }),
          examples: t("common.timeFieldExamples"),
        };
      }
      const limit = calendarLimit.value.preview ?? calendarLimit.value.selection;
      return limit ? { message: raw(limit) } : null;
    });

    const showLiveButton = computed(
      () =>
        !props.disableRelative &&
        selectedType.value === "absolute" &&
        previewLine.value === null &&
        resolvedLine.value.fixed === true,
    );

    const rowGroupName = (row: TimeRangeListRow): I18nText => {
      if (row.kind === "pinned") return t("dateTime.groupPinned");
      if (row.kind === "recent") return t("common.timeRangeRecent");
      if (row.kind === "calendar") return t("common.timeRangeCalendar");
      return t("dateTime.groupSuggestions");
    };

    // The range a row applies, live when it is a period, for its spoken kind and length.
    const rowRange = (
      row: TimeRangeListRow,
    ): { startUs: number; endUs: number; live: boolean } | null => {
      let entry: TimeRangeHistoryEntry | null = row.period ? { relative: row.period } : null;
      if (row.kind === "pinned") entry = rail.pinOf(row.id)?.range ?? null;
      else if (row.kind === "recent")
        entry = rail.recentEntry(row.id.slice("recent-".length)) ?? null;
      if (!entry) return null;
      if (!isRelativeHistoryEntry(entry)) return { ...entry, live: false };
      const range = resolveRelativePeriod(entry.relative, tooltipNow.value);
      return range ? { startUs: range.startTime, endUs: range.endTime, live: true } : null;
    };

    // Spoken in the panel: the preview, or the cursor row with its kind, length, group and place.
    const panelSpeech = computed(() => {
      const row = activeRow.value >= 0 ? shownRows.value[activeRow.value] : null;
      if (row) {
        const position = t("dateTime.rowPosition", {
          n: activeRow.value + 1,
          total: shownRows.value.length,
        });
        const range = rowRange(row);
        const head = [
          row.label,
          range ? kindText(range.live) : "",
          range ? formatRangeDuration(range.startUs, range.endUs) : "",
          row.reason ? row.meta : "",
        ];
        const place = [String(rowGroupName(row)), String(position)].join(", ");
        return `${head.filter(Boolean).join(", ")}. ${place}.`;
      }
      const line = previewLine.value;
      if (!line) return "";
      const kind = line.live ? kindText(true) : line.fixed ? kindText(false) : "";
      return [line.name, line.range, kind, line.duration, line.note].filter(Boolean).join(", ");
    });

    onMounted(() => {
      if (!props.defaultOpen) return;
      // The click that mounted this picker must finish first, or the popover reads it as an outside click.
      nextTick(() => {
        menuOpen.value = true;
        onMenuOpenChange(true);
      });
    });

    return {
      raw,
      t,
      POPOVER_COLLISION_PADDING,
      menuOpen,
      onMenuOpenChange,
      onPopoverOpenAutoFocus,
      datetimeBtn,
      getImageURL,
      setRelativeDate,
      relativePeriods,
      showRail,
      applyCalendarItem,
      applyRecentRange,
      removeRecentRange,
      applyAndClose,
      pendingDay,
      calendarToken,
      calendarTooltip,
      triggerTooltip,
      refreshTooltipNow,
      saveDate,
      onBeforeShow,
      selectedType,
      selectedTime,
      selectedDate,
      relativePeriod,
      relativeValue,
      displayValue,
      triggerLabel,
      triggerParts,
      copyRange,
      pasteRange,
      onPickerPaste,
      refresh,
      dateLocale,
      resetTime,
      onTimezoneChange,
      timezone,
      filteredTimezone,
      timezoneFilterFn,
      setCustomDate,
      setSavedDate,
      optionsFn,
      setDateType,
      shiftTimeRange,
      zoomOut,
      goLive,
      inputText,
      inputError,
      inputErrorText,
      inputAsUtc,
      inputRefusal,
      onInputEdit,
      onInputKeydown,
      onBarFocusOut,
      inputBar,
      timeFieldError,
      unreadableFields,
      toggleAsUtc,
      asUtcLabel,
      resolvedLine,
      previewLine,
      shownLine,
      suggestionsOpen,
      suggestionRows,
      activeSuggestion,
      applySuggestion,
      startDayLabel,
      endDayLabel,
      inputErrorId,
      onCalendarStartDate,
      onCalendarEndDate,
      onCalendarPendingDay,
      onStartTimeEdit,
      onEndTimeEdit,
      onTimeFieldBlur,
      onTimeFieldTyping,
      typedFieldTime,
      groupEl,
      timeFieldFocused,
      isNextShiftDisabled,
      onPickerKeydown,
      getConsumableDateTime,
      setAbsoluteTime,
      setRelativeTime,
      getDisplayValue,
      relativePeriodsMaxValue,
      computeRelativePeriod,
      onBeforeHide,
      showOnlyAbsolute,
      onShow,
      onHide,
      calendarMinDate,
      calendarMaxDate,
      timezoneSelectOptions,
      zoneQuery,
      isTimezoneSelectOpen,
      listId,
      calendarMode,
      openCalendar,
      closeCalendar,
      typing,
      shownRows,
      activeRow,
      listCursor,
      pickShownRow,
      pinRecentRow,
      unpinRow,
      removeRecentRow,
      renamePin,
      cancelPinName,
      editingPinRowId,
      showChips,
      chipItems,
      litChip,
      onChipToggle,
      onChipReselect,
      emptyExamples,
      bodyRows,
      cursorRow,
      pickBodyRow,
      pickChip,
      undoRange,
      showUndo,
      undoTooltip,
      zoneBadgeText,
      zoneShortLabel,
      openMenu,
      isMobile,
      intlLocale,
      weekStart,
      retentionFloorDay,
      calendarRef,
      calendarPreviewDay,
      applyDisabled,
      applyBlockedReason,
      needsStartDate,
      fieldsBlank,
      zoomOutBlocked,
      menuEl,
      onTimeFieldInvalid,
      onTimeFieldEnter,
      onApplyClick,
      summaryError,
      showLiveButton,
      liveDurationLabel,
      stepTooltip,
      panelSpeech,
      appliedSpeech,
      triggerAriaLabel,
      triggerElement,
      triggerTooltipOpen,
      onTriggerHover,
      copyDisabled,
      copyShortcut,
      chipsNotes,
      listHeading,
      setCursorRow,
    };
  },
  computed: {
    relativePeriodWatch() {
      return this.queryRangeRestrictionInHour;
    },
  },
  watch: {
    relativePeriodWatch() {
      this.computeRelativePeriod();
    },
  },
});
</script>
