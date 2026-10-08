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
          :loading="saveConfig.isPending.value"
          data-test="announcement-editor-save"
          >{{ saveLabel }}</OButton
        >
      </template>

      <!-- Phones get one scrolling column; a split leaves neither pane wide enough to use. -->
      <component
        :is="isMobile ? StackedPanes : OSplitter"
        v-bind="
          isMobile
            ? {}
            : { limits: [35, 70], separatorClass: 'field-list-separator', class: 'h-full' }
        "
        v-model="splitPct"
      >
        <template #before>
          <div
            class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5 max-md:h-auto max-md:shrink-0 max-md:overflow-visible max-md:px-4"
          >
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
            </OFormSection>

            <OFormSection :title="t('announcements.editor.sections.severity')">
              <OFormOptionGroup
                name="variant"
                type="radio"
                :options="variantOptions"
                data-test="announcement-editor-variant"
              />
            </OFormSection>

            <OFormSection :title="t('announcements.editor.sections.audience')">
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

            <OFormSection :title="t('announcements.editor.sections.schedule')">
              <div class="flex flex-col gap-4">
                <OFormSelect
                  name="schedule"
                  :label="t('announcements.form.schedule')"
                  :options="scheduleOptions"
                  data-test="announcement-editor-schedule"
                />
                <OFormInput
                  v-if="values.schedule === 'duration'"
                  name="duration"
                  :label="t('announcements.form.duration')"
                  :placeholder="t('announcements.form.durationPlaceholder')"
                  :help-text="t('announcements.editor.durationHelp')"
                  field-width="sm"
                  data-test="announcement-editor-duration"
                />
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
              </div>
            </OFormSection>

            <OFormSection :title="t('announcements.editor.sections.appearance')">
              <div class="flex flex-col gap-5" data-test="announcement-editor-appearance">
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
              </div>
            </OFormSection>

            <OFormSection :title="t('announcements.editor.sections.cta')">
              <div class="flex flex-col gap-4">
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
          </div>
        </template>

        <template #after>
          <div
            class="bg-surface-subtle h-full min-h-0 overflow-y-auto p-5 max-md:h-auto max-md:shrink-0 max-md:overflow-visible max-md:p-4"
          >
            <AnnouncementBannerPreviewPanel
              v-model:in-app="previewInApp"
              :banner="previewBanner"
              :other-banners="otherLiveBanners"
              data-test="announcement-editor-preview"
            />
          </div>
        </template>
      </component>
    </OPageLayout>
  </OForm>

  <ConfirmDialog
    v-model="leaveConfirm.show"
    :title="t('announcements.editor.leaveTitle')"
    :message="t('announcements.editor.leaveMessage')"
    :ok-label="t('announcements.editor.leaveConfirm')"
    :cancel-label="t('announcements.editor.keepEditing')"
    ok-color="destructive"
    @update:ok="resolveLeave(true)"
    @update:cancel="resolveLeave(false)"
  />
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { BANNER_COLOR_PRESETS } from "@/constants/themes";
import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
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
import OFormOptionGroup from "@/lib/forms/OptionGroup/OFormOptionGroup.vue";
import OOptionGroup from "@/lib/forms/OptionGroup/OOptionGroup.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import {
  announcementConfigQuery,
  saveAnnouncementConfigMutation,
} from "@/services/announcements.queries";
import { announcementKeys } from "@/services/announcements.querykeys";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  CUSTOM_CHOICE,
  DEFAULT_CHOICE,
  TEXT_SIZES,
  colorChoiceFor,
} from "@/utils/announcementAppearance";
import {
  applyMessageFormat,
  insertAtCaret,
  type FormattedText,
  type MessageFormat,
} from "@/utils/announcementMarkdown";
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
  bannerStatus,
  withResolvedDuration,
  type BannerDraft,
} from "./announcementDrafts";

const props = defineProps<{
  /** The banner being edited, already converted from the stored config. */
  draft: BannerDraft;
  /** Its position in the stored list, or null for a new banner. */
  index: number | null;
  /** Every other stored banner, for the live-stack preview. */
  others: BannerDraft[];
  /** The banner exactly as stored when the editor opened, to detect a concurrent change on save. */
  original: Record<string, unknown> | null;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const queryClient = useQueryClient();
const { isMobile } = useBreakpoint();

const FORM_ID = "announcement-banner-editor-form";

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

/** One scrolling column holding the splitter's two panes, for phones. */
const StackedPanes = defineComponent({
  setup(_, { slots }) {
    return () =>
      h("div", { class: "flex h-full flex-col overflow-y-auto" }, [
        slots.before?.(),
        slots.after?.(),
      ]);
  },
});

const metaOrg = computed<string>(() => store.state.zoConfig?.meta_org ?? "");
const isNew = computed(() => props.index === null);
const splitPct = ref(55);
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const saveError = ref<I18nText | "">("");
const conflict = ref(false);
const resetDismissals = ref(false);

const saveConfig = useMutation(() => saveAnnouncementConfigMutation(metaOrg.value));
const { setDraft, notifyConfigChanged } = useAnnouncementDraftPreview();
const previewInApp = ref(true);

const VARIANT_HELP_KEYS = {
  info: "announcements.editor.variantHelp.info",
  warning: "announcements.editor.variantHelp.warning",
  critical: "announcements.editor.variantHelp.critical",
  promo: "announcements.editor.variantHelp.promo",
} as const;

const variantOptions = computed(() =>
  VARIANTS.map((variant) => ({
    label: t("announcements.editor.variantOption", {
      name: t(`announcements.variants.${variant}`),
      help: t(VARIANT_HELP_KEYS[variant]),
    }),
    value: variant,
  })),
);

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
});

let leavingAfterSave = false;

const form = useOForm<BannerForm>({
  defaultValues: { ...props.draft } as BannerForm,
  // Passed as the schema itself, never a computed — a ref never resolves in TanStack's validator slot.
  schema: makeBannerSchema(t),
  onSubmit: async (values) => {
    saveError.value = "";
    conflict.value = false;
    const draft = withResolvedDuration(draftFromValues(values));
    if (resetDismissals.value) draft.id = `banner-${Date.now().toString(36)}`;
    const banner = authoredFromDraft(draft);

    try {
      // Re-read rather than trusting the cache, so a banner saved elsewhere meanwhile survives.
      const latest = await queryClient.fetchQuery({
        ...announcementConfigQuery(metaOrg.value),
        staleTime: 0,
      });
      const banners = [...latest.banners];
      if (props.index !== null) {
        if (!sameBanner(banners[props.index], props.original)) {
          conflict.value = true;
          saveError.value = t("announcements.editor.conflict");
          return;
        }
        banners[props.index] = banner;
      } else {
        banners.push(banner);
      }

      await saveConfig.mutateAsync({ banners });
      notifyConfigChanged();
      toast({ variant: "success", message: savedMessage(draft) });
      leavingAfterSave = true;
      goBack();
    } catch (error: any) {
      saveError.value =
        raw(error?.response?.data?.message) || t("announcements.settings.saveFailed");
    }
  },
});

const values = form.useStore((state) => state.values);
const isDirty = form.useStore((state) => state.isDirty);

const messageLength = computed(() => (values.value.message ?? "").length);

// Comparing serialized forms is enough: both sides come straight from the same stored document.
const sameBanner = (a: unknown, b: unknown) =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b);

const STATUS_LABEL_KEYS = {
  live: "announcements.editor.statusLive",
  scheduled: "announcements.editor.statusScheduled",
  ended: "announcements.editor.statusEnded",
} as const;

const storedStatusLabel = computed(() =>
  isNew.value ? undefined : t(STATUS_LABEL_KEYS[bannerStatus(props.draft)]),
);

const pendingStatus = computed(() =>
  bannerStatus(withResolvedDuration(draftFromValues(values.value))),
);

const saveLabel = computed(() => {
  if (pendingStatus.value === "live") return t("announcements.editor.publishNow");
  if (pendingStatus.value === "scheduled") return t("announcements.editor.schedule");
  return t("common.save");
});

const savedMessage = (draft: BannerDraft): I18nText => {
  const status = bannerStatus(draft);
  if (status === "scheduled") {
    return t("announcements.editor.savedScheduled", {
      time: new Date(draft.startsAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
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
  ctaText: values.value.hasCta ? (values.value.ctaText ?? "") : "",
  dismissible: values.value.dismissible,
}));

// The real top bar shows the draft too, so its width, theme and neighbours are exactly what users get.
watch(
  [previewInApp, previewBanner],
  ([inApp, banner]) => {
    setDraft(
      inApp
        ? {
            id: "draft-preview",
            message: raw(banner.message.trim() || t("announcements.preview.empty")),
            variant: banner.variant,
            dismissible: false,
            text_size: banner.textSize,
            colors: { light: banner.colorLight, dark: banner.colorDark },
            cta: banner.ctaText ? { text: raw(banner.ctaText), url: "" } : undefined,
          }
        : null,
      typeof props.original?.message === "string" ? props.original.message : null,
    );
  },
  { immediate: true },
);

onBeforeUnmount(() => setDraft(null));

const otherLiveBanners = computed<PreviewBanner[]>(() =>
  props.others
    .filter((banner) => bannerStatus(banner) === "live")
    .map((banner) => ({ ...banner, ctaText: banner.hasCta ? banner.ctaText : "" })),
);

// ── Colour ────────────────────────────────────────────────────────────────

// Which swatch is lit is view state; the colours themselves live only in the form.
const colorChoice = ref(colorChoiceFor(props.draft.colorLight, props.draft.colorDark));

const chooseColor = (choice: string) => {
  colorChoice.value = choice;
  if (choice === CUSTOM_CHOICE) return;

  const preset = BANNER_COLOR_PRESETS.find((p) => p.key === choice);
  form.setFieldValue("colorLight", choice === DEFAULT_CHOICE ? "" : (preset?.light ?? ""));
  form.setFieldValue("colorDark", choice === DEFAULT_CHOICE ? "" : (preset?.dark ?? ""));
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

const leaveConfirm = ref<{ show: boolean; resolve: ((proceed: boolean) => void) | null }>({
  show: false,
  resolve: null,
});

const resolveLeave = (proceed: boolean) => {
  leaveConfirm.value.show = false;
  leaveConfirm.value.resolve?.(proceed);
  leaveConfirm.value.resolve = null;
};

// A reload or tab close skips the router, so the browser's own prompt has to cover it.
const warnOnUnload = (event: BeforeUnloadEvent) => {
  if (leavingAfterSave || !isDirty.value) return;
  event.preventDefault();
};

onMounted(() => window.addEventListener("beforeunload", warnOnUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnOnUnload));

onBeforeRouteLeave(() => {
  if (leavingAfterSave || !isDirty.value) return true;
  return new Promise<boolean>((resolve) => {
    leaveConfirm.value = { show: true, resolve };
  });
});

const reload = () => {
  leavingAfterSave = true;
  void queryClient.invalidateQueries({ queryKey: announcementKeys.config(metaOrg.value) });
};

const goBack = () => {
  void router.push({
    name: "announcementBanners",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

// Exposed so a test can drive the real submit and the toolbar without a browser selection.
defineExpose({ form, applyFormat, insertEmoji });
</script>
