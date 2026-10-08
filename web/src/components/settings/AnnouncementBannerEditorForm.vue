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
  <OForm :id="FORM_ID" :form="form" class="h-full w-full">
    <OPageLayout
      bleed
      :title="isNew ? t('announcements.editor.addTitle') : t('announcements.editor.editTitle')"
      :subtitle="storedStatusLabel"
      :back="{
        label: t('announcements.settings.label'),
        onClick: goBack,
        dataTest: 'announcement-editor-back',
      }"
      :title-overflow="isMobile ? 'visible' : 'truncate'"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="announcement-editor-cancel"
          @click="goBack"
          >{{ t("common.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          :form="FORM_ID"
          :loading="isPending"
          data-test="announcement-editor-save"
          >{{ saveLabel }}</OButton
        >
      </template>

      <OSplitter
        v-model="splitPct"
        class="h-full"
        unit="%"
        :horizontal="isMobile"
        :limits="[35, 70]"
        separator-class="field-list-separator"
      >
        <template #before>
          <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5 max-md:px-4">
            <OBanner
              v-if="saveError"
              variant="error-soft"
              icon="error"
              inline-actions
              data-test="announcement-editor-error"
            >
              {{ saveError }}
              <template v-if="conflict" #actions>
                <OButton
                  variant="outline"
                  size="sm"
                  data-test="announcement-editor-reload"
                  @click="reload"
                  >{{ t("announcements.editor.reload") }}</OButton
                >
              </template>
            </OBanner>

            <OFormSection :title="t('announcements.editor.sections.message')">
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2" data-test="announcement-editor-message-field">
                  <div
                    class="flex flex-wrap items-center gap-1"
                    data-test="announcement-editor-toolbar"
                  >
                    <OButton
                      v-for="action in formatActions"
                      :key="action.format"
                      variant="ghost"
                      size="icon-sm"
                      :icon-left="action.icon"
                      :aria-label="action.label"
                      :title="action.label"
                      :data-test="`announcement-editor-toolbar-${action.format}`"
                      @click="applyFormat(action.format)"
                    />
                    <OPopover side="bottom" align="start" content-class="p-1.5">
                      <template #trigger>
                        <OButton
                          variant="ghost"
                          size="icon-sm"
                          icon-left="add-reaction"
                          :aria-label="t('announcements.editor.toolbar.emoji')"
                          :title="t('announcements.editor.toolbar.emoji')"
                          data-test="announcement-editor-toolbar-emoji"
                        />
                      </template>
                      <div
                        class="grid grid-cols-6 gap-0.5"
                        data-test="announcement-editor-emoji-grid"
                      >
                        <OButton
                          v-for="emoji in EMOJIS"
                          :key="emoji.name"
                          variant="ghost"
                          size="icon-sm"
                          :aria-label="t(`announcements.editor.emoji.${emoji.name}`)"
                          :title="t(`announcements.editor.emoji.${emoji.name}`)"
                          :data-test="`announcement-editor-emoji-${emoji.name}`"
                          @click="insertEmoji(emoji.char)"
                          >{{ raw(emoji.char) }}</OButton
                        >
                      </div>
                    </OPopover>
                  </div>
                  <div ref="messageFieldRef">
                    <OFormInput
                      name="message"
                      type="textarea"
                      :rows="3"
                      :label="t('announcements.form.message')"
                      :placeholder="t('announcements.form.messagePlaceholder')"
                      :help-text="t('announcements.editor.messageHelp')"
                      required
                      data-test="announcement-editor-message"
                    />
                  </div>
                  <span
                    :class="[
                      'self-end text-xs',
                      messageLength > MESSAGE_MAX_LENGTH
                        ? 'text-input-error-text'
                        : 'text-text-secondary',
                    ]"
                    data-test="announcement-editor-message-count"
                  >
                    {{
                      t("announcements.editor.characters", {
                        count: messageLength,
                        max: MESSAGE_MAX_LENGTH,
                      })
                    }}
                  </span>
                </div>

                <OFormSwitch
                  name="hasCta"
                  :label="t('announcements.form.hasCta')"
                  data-test="announcement-editor-has-cta"
                />
                <div v-if="values.hasCta" class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                  <OFormInput
                    name="ctaText"
                    :label="t('announcements.form.ctaText')"
                    :placeholder="t('announcements.form.ctaTextPlaceholder')"
                    data-test="announcement-editor-cta-text"
                  />
                  <OFormInput
                    name="ctaUrl"
                    :label="t('announcements.form.ctaUrl')"
                    :placeholder="t('announcements.form.ctaUrlPlaceholder')"
                    data-test="announcement-editor-cta-url"
                  />
                </div>
              </div>
            </OFormSection>

            <OFormSection :title="t('announcements.editor.sections.style')">
              <div class="flex flex-col gap-5" data-test="announcement-editor-style">
                <OOptionGroup
                  :model-value="styleChoice"
                  type="radio"
                  :label="t('announcements.form.styleChoice')"
                  :options="styleOptions"
                  data-test="announcement-editor-variant"
                  @update:model-value="chooseStyle"
                />

                <OFormToggleGroup
                  name="textSize"
                  :label="t('announcements.form.textSize')"
                  data-test="announcement-editor-text-size"
                >
                  <OToggleGroupItem
                    v-for="option in textSizeOptions"
                    :key="option.value"
                    :value="option.value"
                    size="sm"
                    :data-test="`announcement-editor-text-size-${option.value}`"
                  >
                    {{ option.label }}
                  </OToggleGroupItem>
                </OFormToggleGroup>

                <div class="flex flex-col gap-2">
                  <span class="text-text-label text-xs font-medium">
                    {{ t("announcements.form.icon") }}
                  </span>
                  <div
                    class="flex flex-wrap items-center gap-1"
                    role="radiogroup"
                    :aria-label="t('announcements.form.icon')"
                    data-test="announcement-editor-icon"
                  >
                    <OButton
                      variant="outline"
                      size="xs"
                      role="radio"
                      :active="!values.icon"
                      :aria-checked="!values.icon"
                      data-test="announcement-editor-icon-default"
                      @click="form.setFieldValue('icon', '')"
                      >{{ t("announcements.form.iconDefault") }}</OButton
                    >
                    <OButton
                      v-for="icon in BANNER_ICONS"
                      :key="icon"
                      variant="outline"
                      size="icon-sm"
                      role="radio"
                      :icon-left="icon"
                      :active="values.icon === icon"
                      :aria-checked="values.icon === icon"
                      :aria-label="icon"
                      :title="icon"
                      :data-test="`announcement-editor-icon-${icon}`"
                      @click="form.setFieldValue('icon', icon)"
                    />
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <span class="text-text-label text-xs font-medium">
                    {{ t("announcements.form.color") }}
                  </span>
                  <AnnouncementColorSwatches
                    :model-value="colorChoice"
                    data-test="announcement-editor-color"
                    @update:model-value="chooseColor"
                  />
                  <span class="text-text-secondary text-xs">
                    {{ t("announcements.form.colorHelp") }}
                  </span>
                </div>

                <div
                  v-if="colorChoice === CUSTOM_CHOICE"
                  class="grid grid-cols-2 gap-4 max-md:grid-cols-1"
                >
                  <OFormColor
                    name="colorLight"
                    clearable
                    :label="t('announcements.form.colorLight')"
                    data-test="announcement-editor-color-light"
                  />
                  <OFormColor
                    name="colorDark"
                    clearable
                    :label="t('announcements.form.colorDark')"
                    data-test="announcement-editor-color-dark"
                  />
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="bookmark-add"
                    data-test="announcement-editor-save-style"
                    @click="openSaveStyle"
                    >{{ t("announcements.styles.saveAs") }}</OButton
                  >
                  <OButton
                    v-if="selectedStyle"
                    variant="ghost-destructive"
                    size="sm"
                    icon-left="delete"
                    data-test="announcement-editor-delete-style"
                    @click="deleteStyleOpen = true"
                    >{{ t("announcements.styles.delete", { name: selectedStyle.name }) }}</OButton
                  >
                </div>
              </div>
            </OFormSection>

            <OFormSection :title="t('announcements.editor.sections.whoWhen')">
              <div class="flex flex-col gap-4">
                <OOptionGroup
                  :model-value="audience"
                  type="radio"
                  orientation="horizontal"
                  :label="t('announcements.form.orgs')"
                  :options="audienceOptions"
                  data-test="announcement-editor-audience"
                  @update:model-value="chooseAudience"
                />
                <OFormSelect
                  v-if="audience === 'some'"
                  name="orgs"
                  multiple
                  :label="t('announcements.editor.orgsPick')"
                  :options="orgOptions"
                  data-test="announcement-editor-orgs"
                />

                <OFormSelect
                  name="schedule"
                  :label="t('announcements.form.schedule')"
                  :options="scheduleOptions"
                  data-test="announcement-editor-schedule"
                />
                <div v-if="values.schedule === 'duration'" class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-end gap-2">
                    <OFormInput
                      name="duration"
                      :label="t('announcements.form.duration')"
                      :placeholder="t('announcements.form.durationPlaceholder')"
                      field-width="sm"
                      data-test="announcement-editor-duration"
                    />
                    <OButton
                      v-for="span in DURATION_PICKS"
                      :key="span"
                      variant="outline"
                      size="sm"
                      :active="values.duration === span"
                      :data-test="`announcement-editor-duration-${span}`"
                      @click="form.setFieldValue('duration', span)"
                      >{{ raw(span) }}</OButton
                    >
                  </div>
                  <span class="text-text-secondary text-xs">{{ durationHint }}</span>
                </div>
                <div v-if="values.schedule === 'window'" class="flex flex-col gap-2">
                  <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    <OFormInput
                      name="startsAt"
                      type="datetime-local"
                      :label="t('announcements.form.startsAt')"
                      data-test="announcement-editor-starts-at"
                    />
                    <OFormInput
                      name="endsAt"
                      type="datetime-local"
                      :label="t('announcements.form.endsAt')"
                      data-test="announcement-editor-ends-at"
                    />
                  </div>
                  <span class="text-text-secondary text-xs">
                    {{ t("announcements.form.timezoneHint", { zone: timeZone }) }}
                  </span>
                </div>

                <OFormSwitch
                  name="dismissible"
                  :label="t('announcements.form.dismissible')"
                  data-test="announcement-editor-dismissible"
                />
                <OSwitch
                  v-if="!isNew && values.dismissible"
                  v-model="resetDismissals"
                  :label="t('announcements.editor.resetDismissals')"
                  data-test="announcement-editor-reset-dismissals"
                />
              </div>
            </OFormSection>
          </div>
        </template>

        <template #after>
          <div class="bg-surface-subtle h-full min-h-0 overflow-y-auto p-5 max-md:p-4">
            <AnnouncementBannerPreviewPanel
              :banner="previewBanner"
              :hidden="hiddenByCritical"
              data-test="announcement-editor-preview"
            />
          </div>
        </template>
      </OSplitter>
    </OPageLayout>
  </OForm>

  <ODialog
    v-model:open="saveStyleOpen"
    size="sm"
    :title="t('announcements.styles.saveTitle')"
    :sub-title="
      t('announcements.styles.saveHint', {
        severity: t(`announcements.variants.${values.variant}`),
      })
    "
    :primary-button-label="t('announcements.styles.saveConfirm')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!styleName.trim()"
    :primary-button-loading="isPending"
    data-test="announcement-editor-save-style-dialog"
    @click:secondary="saveStyleOpen = false"
    @click:primary="saveStyle"
  >
    <OInput
      v-model="styleName"
      :label="t('announcements.styles.name')"
      :placeholder="t('announcements.styles.namePlaceholder')"
      :error-message="styleError || undefined"
      data-test="announcement-editor-style-name"
    />
  </ODialog>

  <ODialog
    v-model:open="deleteStyleOpen"
    size="sm"
    :title="t('announcements.styles.deleteTitle', { name: selectedStyle?.name ?? '' })"
    :sub-title="t('announcements.styles.deleteHint')"
    :primary-button-label="t('common.delete')"
    primary-button-variant="destructive"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="isPending"
    data-test="announcement-editor-delete-style-dialog"
    @click:secondary="deleteStyleOpen = false"
    @click:primary="deleteStyle"
  />

  <ODialog
    v-model:open="leaveOpen"
    size="sm"
    :title="t('announcements.editor.leaveTitle')"
    :sub-title="t('announcements.editor.leaveMessage')"
    :primary-button-label="t('announcements.editor.leaveConfirm')"
    primary-button-variant="destructive"
    :secondary-button-label="t('announcements.editor.keepEditing')"
    data-test="announcement-editor-leave-dialog"
    @update:open="(open: boolean) => !open && resolveLeave(false)"
    @click:secondary="resolveLeave(false)"
    @click:primary="resolveLeave(true)"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { useStore } from "vuex";

import { BANNER_COLOR_PRESETS } from "@/constants/themes";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OFormColor from "@/lib/forms/Color/OFormColor.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OOptionGroup from "@/lib/forms/OptionGroup/OOptionGroup.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  BANNER_ICONS,
  CUSTOM_CHOICE,
  DEFAULT_CHOICE,
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  colorChoiceFor,
} from "@/utils/announcementAppearance";
import {
  applyMessageFormat,
  insertAtCaret,
  type FormattedText,
  type MessageFormat,
} from "@/utils/announcementMarkdown";
import type { BannerVariantName } from "@/utils/announcementOrder";
import {
  MESSAGE_MAX_LENGTH,
  makeBannerSchema,
  type BannerForm,
} from "./AnnouncementBannerEditor.schema";
import AnnouncementBannerPreviewPanel, {
  type PreviewBanner,
} from "./AnnouncementBannerPreviewPanel.vue";
import AnnouncementColorSwatches from "./AnnouncementColorSwatches.vue";
import {
  VARIANTS,
  authoredFromDraft,
  authoredFromStyle,
  bannerStatus,
  isHiddenByCritical,
  newBannerId,
  parseDurationMs,
  type BannerDraft,
  type BannerStyle,
} from "./announcementDrafts";
import {
  AnnouncementConflictError,
  sameAuthored,
  useAnnouncementConfigUpdate,
} from "./useAnnouncementConfigUpdate";

const props = defineProps<{
  /** The banner being edited, already converted from the stored config. */
  draft: BannerDraft;
  /** Its position in the stored list, or null for a new banner. */
  index: number | null;
  /** Every other stored banner, to tell whether a critical one hides this promotion. */
  others: BannerDraft[];
  /** The banner exactly as stored when the editor opened, to detect a concurrent change on save. */
  original: Record<string, unknown> | null;
  /** Saved styles; refreshed in place when one is added or deleted. */
  styles: BannerStyle[];
}>();

const emit = defineEmits<{ (_e: "reload"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { isMobile } = useBreakpoint();
const { update, isPending } = useAnnouncementConfigUpdate();

const FORM_ID = "announcement-banner-editor-form";
const STYLE_CHOICE_PREFIX = "style:";
const DURATION_PICKS = ["1h", "4h", "1d", "1w"];

const EMOJIS = [
  { name: "siren", char: "🚨" },
  { name: "fire", char: "🔥" },
  { name: "warning", char: "⚠️" },
  { name: "check", char: "✅" },
  { name: "cross", char: "❌" },
  { name: "chart", char: "📈" },
  { name: "bell", char: "🔔" },
  { name: "clock", char: "⏱️" },
  { name: "party", char: "🎉" },
  { name: "tools", char: "🛠️" },
  { name: "megaphone", char: "📣" },
  { name: "info", char: "ℹ️" },
] as const;

// Captured once: the parent's copies refresh when a style is saved, and the conflict check must not move with them.
const index = props.index;
const original = props.original;

const isNew = computed(() => index === null);
const splitPct = ref(55);
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const saveError = ref<I18nText | "">("");
const conflict = ref(false);
const resetDismissals = ref(false);

const VARIANT_HELP_KEYS = {
  info: "announcements.editor.variantHelp.info",
  warning: "announcements.editor.variantHelp.warning",
  critical: "announcements.editor.variantHelp.critical",
  promo: "announcements.editor.variantHelp.promo",
} as const;

const TEXT_SIZE_LABEL_KEYS = {
  small: "announcements.form.textSizeSmall",
  medium: "announcements.form.textSizeMedium",
  large: "announcements.form.textSizeLarge",
} as const;

const textSizeOptions = computed(() =>
  TEXT_SIZES.map((size) => ({ label: t(TEXT_SIZE_LABEL_KEYS[size]), value: size })),
);

const scheduleOptions = computed<SelectOption[]>(() => [
  { label: t("announcements.form.scheduleAlways"), value: "always" },
  { label: t("announcements.form.scheduleDuration"), value: "duration" },
  { label: t("announcements.form.scheduleWindow"), value: "window" },
]);

/** Picking from the real org list beats typing identifiers that silently match nothing. */
const orgOptions = computed<SelectOption[]>(() =>
  (store.state.organizations ?? []).map((org: { identifier: string; name?: string }) => ({
    label:
      org.name && org.name !== org.identifier
        ? t("announcements.editor.orgOption", { name: org.name, id: org.identifier })
        : raw(org.identifier),
    value: org.identifier,
  })),
);

const audienceOptions = computed(() => [
  { label: t("announcements.form.orgsAll"), value: "all" },
  { label: t("announcements.editor.orgsSome"), value: "some" },
]);

// Which audience radio is lit is view state; the org list itself lives only in the form.
const audience = ref<"all" | "some">(props.draft.orgs.length ? "some" : "all");

const chooseAudience = (value: unknown) => {
  audience.value = value === "some" ? "some" : "all";
  if (audience.value === "all") form.setFieldValue("orgs", []);
};

const draftFromValues = (values: BannerForm): BannerDraft => ({
  id: values.id ?? "",
  message: values.message,
  variant: values.variant,
  schedule: values.schedule,
  duration: values.duration ?? "",
  startsAt: values.startsAt ?? "",
  endsAt: values.endsAt ?? "",
  dismissible: values.dismissible,
  hasCta: values.hasCta,
  ctaText: values.ctaText ?? "",
  ctaUrl: values.ctaUrl ?? "",
  orgs: values.orgs ?? [],
  textSize: values.textSize,
  colorLight: values.colorLight?.trim() ?? "",
  colorDark: values.colorDark?.trim() ?? "",
  icon: values.icon ?? "",
  styleId: values.styleId ?? "",
});

let leavingAfterSave = false;

const form = useOForm<BannerForm>({
  defaultValues: { ...props.draft } as BannerForm,
  // Passed as the schema itself, never a computed — a ref never resolves in TanStack's validator slot.
  schema: makeBannerSchema(t),
  onSubmit: async (values) => {
    saveError.value = "";
    conflict.value = false;
    const draft = draftFromValues(values);
    if (isNew.value && !draft.id) draft.id = newBannerId();
    if (resetDismissals.value) draft.id = newBannerId();
    const banner = authoredFromDraft(draft);

    try {
      await update((latest) => {
        const banners = [...latest.banners];
        if (index === null) {
          banners.push(banner);
        } else if (sameAuthored(banners[index], original)) {
          banners[index] = banner;
        } else {
          throw new AnnouncementConflictError();
        }
        return { ...latest, banners };
      });
      toast({ variant: "success", message: savedMessage(draft) });
      leavingAfterSave = true;
      goBack();
    } catch (error: any) {
      conflict.value = error instanceof AnnouncementConflictError;
      saveError.value = conflict.value
        ? t("announcements.editor.conflict")
        : raw(error?.response?.data?.message) || t("announcements.settings.saveFailed");
    }
  },
});

const values = form.useStore((state) => state.values);
const isDirty = form.useStore((state) => state.isDirty);

const messageLength = computed(() => (values.value.message ?? "").length);

const STATUS_LABEL_KEYS = {
  live: "announcements.editor.statusLive",
  scheduled: "announcements.editor.statusScheduled",
  ended: "announcements.editor.statusEnded",
} as const;

const storedStatusLabel = computed(() =>
  isNew.value ? undefined : t(STATUS_LABEL_KEYS[bannerStatus(props.draft)]),
);

const pendingStatus = computed(() => bannerStatus(draftFromValues(values.value)));

const saveLabel = computed(() => {
  if (pendingStatus.value === "live") return t("announcements.editor.publishNow");
  if (pendingStatus.value === "scheduled") return t("announcements.editor.schedule");
  return t("common.save");
});

const formatStamp = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const durationHint = computed(() => {
  const ms = parseDurationMs(values.value.duration ?? "");
  return ms
    ? t("announcements.form.durationEnds", { time: formatStamp(Date.now() + ms) })
    : t("announcements.form.durationHelp");
});

const savedMessage = (draft: BannerDraft): I18nText => {
  const status = bannerStatus(draft);
  if (status === "scheduled") {
    return t("announcements.editor.savedScheduled", {
      time: formatStamp(new Date(draft.startsAt).getTime()),
    });
  }
  if (status === "ended") return t("announcements.editor.savedEnded");
  return draft.orgs.length
    ? t("announcements.editor.savedLiveSome", { count: draft.orgs.length }, draft.orgs.length)
    : t("announcements.editor.savedLiveAll");
};

// An outage notice should stay up by default; the author can still allow dismissing it.
watch(
  () => values.value.variant,
  (variant, previous) => {
    if (variant === "critical" && previous !== "critical") form.setFieldValue("dismissible", false);
  },
);

const previewBanner = computed<PreviewBanner>(() => ({
  message: values.value.message ?? "",
  variant: values.value.variant,
  textSize: values.value.textSize,
  colorLight: values.value.colorLight ?? "",
  colorDark: values.value.colorDark ?? "",
  icon: values.value.icon ?? "",
  ctaText: values.value.hasCta ? (values.value.ctaText ?? "") : "",
  dismissible: values.value.dismissible,
}));

const hiddenByCritical = computed(() =>
  isHiddenByCritical(draftFromValues(values.value), props.others),
);

// ── Style ─────────────────────────────────────────────────────────────────

const selectedStyle = computed(() => props.styles.find((s) => s.id === values.value.styleId));

const styleChoice = computed(() =>
  selectedStyle.value ? `${STYLE_CHOICE_PREFIX}${selectedStyle.value.id}` : values.value.variant,
);

const styleOptions = computed(() => [
  ...VARIANTS.map((variant) => ({
    label: t("announcements.editor.variantOption", {
      name: t(`announcements.variants.${variant}`),
      help: t(VARIANT_HELP_KEYS[variant]),
    }),
    value: variant,
  })),
  ...props.styles.map((style) => ({
    label: t("announcements.styles.option", {
      name: style.name,
      severity: t(`announcements.variants.${style.base}`),
    }),
    value: `${STYLE_CHOICE_PREFIX}${style.id}`,
  })),
]);

// Which swatch is lit is view state; the colours themselves live only in the form.
const colorChoice = ref(colorChoiceFor(props.draft.colorLight, props.draft.colorDark));

const applyLook = (look: Pick<BannerStyle, "icon" | "textSize" | "colorLight" | "colorDark">) => {
  form.setFieldValue("icon", look.icon);
  form.setFieldValue("textSize", look.textSize);
  form.setFieldValue("colorLight", look.colorLight);
  form.setFieldValue("colorDark", look.colorDark);
  colorChoice.value = colorChoiceFor(look.colorLight, look.colorDark);
};

const chooseStyle = (choice: unknown) => {
  const value = String(choice);
  const style = props.styles.find((s) => `${STYLE_CHOICE_PREFIX}${s.id}` === value);
  if (style) {
    form.setFieldValue("variant", style.base);
    applyLook(style);
    form.setFieldValue("styleId", style.id);
    return;
  }
  form.setFieldValue("variant", value as BannerVariantName);
  form.setFieldValue("styleId", "");
  applyLook({ icon: "", textSize: DEFAULT_TEXT_SIZE, colorLight: "", colorDark: "" });
};

// A banner restyled after picking a saved style no longer matches it, so stop labelling it with that name.
watch(
  () => [values.value.icon, values.value.textSize, values.value.colorLight, values.value.colorDark],
  () => {
    const style = selectedStyle.value;
    if (!style) return;
    const v = values.value;
    const same =
      (v.icon ?? "") === style.icon &&
      v.textSize === style.textSize &&
      (v.colorLight ?? "").toUpperCase() === style.colorLight.toUpperCase() &&
      (v.colorDark ?? "").toUpperCase() === style.colorDark.toUpperCase();
    if (!same) form.setFieldValue("styleId", "");
  },
);

const chooseColor = (choice: string) => {
  colorChoice.value = choice;
  if (choice === CUSTOM_CHOICE) return;

  const preset = BANNER_COLOR_PRESETS.find((p) => p.key === choice);
  form.setFieldValue("colorLight", choice === DEFAULT_CHOICE ? "" : (preset?.light ?? ""));
  form.setFieldValue("colorDark", choice === DEFAULT_CHOICE ? "" : (preset?.dark ?? ""));
};

const saveStyleOpen = ref(false);
const deleteStyleOpen = ref(false);
const styleName = ref("");
const styleError = ref<I18nText | "">("");

const openSaveStyle = () => {
  styleName.value = "";
  styleError.value = "";
  saveStyleOpen.value = true;
};

const saveStyle = async () => {
  const name = styleName.value.trim();
  const v = values.value;
  const style: BannerStyle = {
    id: newBannerId("style"),
    name,
    base: v.variant,
    icon: v.icon ?? "",
    textSize: v.textSize,
    colorLight: v.colorLight?.trim() ?? "",
    colorDark: v.colorDark?.trim() ?? "",
  };

  try {
    await update((latest) => ({ ...latest, styles: [...latest.styles, authoredFromStyle(style)] }));
    form.setFieldValue("styleId", style.id);
    saveStyleOpen.value = false;
    toast({ variant: "success", message: t("announcements.styles.saved", { name }) });
  } catch (error: any) {
    styleError.value =
      raw(error?.response?.data?.message) || t("announcements.settings.saveFailed");
  }
};

const deleteStyle = async () => {
  const style = selectedStyle.value;
  if (!style) return;
  try {
    await update((latest) => ({
      ...latest,
      styles: latest.styles.filter((s) => s.id !== style.id),
    }));
    form.setFieldValue("styleId", "");
    toast({ variant: "success", message: t("announcements.styles.deleted", { name: style.name }) });
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("announcements.settings.saveFailed"),
    });
  } finally {
    deleteStyleOpen.value = false;
  }
};

// ── Message toolbar ───────────────────────────────────────────────────────

const messageFieldRef = ref<HTMLElement | null>(null);

const formatActions = computed<{ format: MessageFormat; icon: IconName; label: I18nText }[]>(() => [
  { format: "bold", icon: "format-bold", label: t("announcements.editor.toolbar.bold") },
  { format: "italic", icon: "format-italic", label: t("announcements.editor.toolbar.italic") },
  { format: "code", icon: "code", label: t("announcements.editor.toolbar.code") },
  { format: "link", icon: "link", label: t("announcements.editor.toolbar.link") },
]);

const messageTextarea = () => messageFieldRef.value?.querySelector("textarea") ?? null;

const writeMessage = async (next: FormattedText) => {
  form.setFieldValue("message", next.value);
  await nextTick();
  const textarea = messageTextarea();
  textarea?.focus();
  textarea?.setSelectionRange(next.selectionStart, next.selectionEnd);
};

const selection = () => {
  const textarea = messageTextarea();
  const value = values.value.message ?? "";
  return {
    value,
    start: textarea?.selectionStart ?? value.length,
    end: textarea?.selectionEnd ?? value.length,
  };
};

const applyFormat = (format: MessageFormat) => {
  const { value, start, end } = selection();
  void writeMessage(
    applyMessageFormat(value, start, end, format, t("announcements.editor.toolbar.placeholder")),
  );
};

const insertEmoji = (emoji: string) => {
  const { value, start, end } = selection();
  void writeMessage(insertAtCaret(value, start, end, emoji));
};

// ── Leaving ───────────────────────────────────────────────────────────────

const leaveOpen = ref(false);
let leaveResolve: ((proceed: boolean) => void) | null = null;

const resolveLeave = (proceed: boolean) => {
  leaveOpen.value = false;
  leaveResolve?.(proceed);
  leaveResolve = null;
};

const hasUnsavedChanges = () =>
  !leavingAfterSave &&
  (isDirty.value ||
    resetDismissals.value ||
    (audience.value === "some") !== !!props.draft.orgs.length);

// A reload or tab close skips the router, so the browser's own prompt has to cover it.
const warnOnUnload = (event: BeforeUnloadEvent) => {
  if (hasUnsavedChanges()) event.preventDefault();
};

onMounted(() => window.addEventListener("beforeunload", warnOnUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnOnUnload));

onBeforeRouteLeave(() => {
  if (!hasUnsavedChanges()) return true;
  return new Promise<boolean>((resolve) => {
    leaveResolve = resolve;
    leaveOpen.value = true;
  });
});

const reload = () => {
  leavingAfterSave = true;
  emit("reload");
};

const goBack = () => {
  void router.push({
    name: "announcementBanners",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

// Exposed so a test can drive the real submit and the toolbar without a browser selection.
defineExpose({ form, applyFormat, insertEmoji, chooseStyle });
</script>
