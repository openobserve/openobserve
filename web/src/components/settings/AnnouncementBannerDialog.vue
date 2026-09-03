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
  <ODialog
    :open="open"
    size="lg"
    :title="isNew ? t('announcements.form.addTitle') : t('announcements.form.editTitle')"
    :sub-title="t('announcements.form.subtitle')"
    :form-id="FORM_ID"
    :primary-button-label="t('announcements.form.apply')"
    :secondary-button-label="t('announcements.settings.cancel')"
    data-test="announcements-banner-dialog"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormInput
        name="message"
        type="textarea"
        :rows="3"
        :label="t('announcements.form.message')"
        :placeholder="t('announcements.form.messagePlaceholder')"
        :help-text="t('announcements.form.messageHelp')"
        required
        data-test="announcements-banner-dialog-message"
      />

      <div class="grid grid-cols-2 gap-4">
        <OFormSelect
          name="variant"
          :label="t('announcements.form.severity')"
          :options="variantOptions"
          :help-text="t('announcements.form.severityHelp')"
          data-test="announcements-banner-dialog-variant"
        />
        <OFormSelect
          name="schedule"
          :label="t('announcements.form.schedule')"
          :options="scheduleOptions"
          data-test="announcements-banner-dialog-schedule"
        />
      </div>

      <OFormInput
        v-if="schedule === 'duration'"
        name="duration"
        :label="t('announcements.form.duration')"
        :placeholder="t('announcements.form.durationPlaceholder')"
        :help-text="t('announcements.form.durationHelp')"
        field-width="sm"
        data-test="announcements-banner-dialog-duration"
      />

      <div v-if="schedule === 'window'" class="flex flex-col gap-2">
        <div class="grid grid-cols-2 gap-4">
          <OFormInput
            name="startsAt"
            type="datetime-local"
            :label="t('announcements.form.startsAt')"
            data-test="announcements-banner-dialog-starts-at"
          />
          <OFormInput
            name="endsAt"
            type="datetime-local"
            :label="t('announcements.form.endsAt')"
            data-test="announcements-banner-dialog-ends-at"
          />
        </div>
        <!-- The picker is in the author's own zone; saying so avoids a notice
             scheduled hours off by someone assuming it means UTC. -->
        <span class="text-text-secondary text-xs">
          {{ t("announcements.form.timezoneHint", { zone: timeZone }) }}
        </span>
      </div>

      <OFormSwitch
        name="dismissible"
        :label="t('announcements.form.dismissible')"
        data-test="announcements-banner-dialog-dismissible"
      />

      <div class="flex flex-col gap-4">
        <OFormSwitch
          name="hasCta"
          :label="t('announcements.form.hasCta')"
          data-test="announcements-banner-dialog-has-cta"
        />
        <div v-if="hasCta" class="grid grid-cols-2 gap-4">
          <OFormInput
            name="ctaText"
            :label="t('announcements.form.ctaText')"
            :placeholder="t('announcements.form.ctaTextPlaceholder')"
            data-test="announcements-banner-dialog-cta-text"
          />
          <OFormInput
            name="ctaUrl"
            :label="t('announcements.form.ctaUrl')"
            :placeholder="t('announcements.form.ctaUrlPlaceholder')"
            data-test="announcements-banner-dialog-cta-url"
          />
        </div>
      </div>

      <OFormSelect
        name="orgs"
        multiple
        :label="t('announcements.form.orgs')"
        :options="orgOptions"
        :placeholder="t('announcements.form.orgsAll')"
        :help-text="t('announcements.form.orgsHelp')"
        data-test="announcements-banner-dialog-orgs"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { useI18nTyped } from "@/types/i18n";
import { makeBannerSchema, type BannerForm } from "./AnnouncementBannerDialog.schema";
import { VARIANTS, type BannerDraft } from "./announcementDrafts";

const props = defineProps<{
  open: boolean;
  /** The banner being edited. Mounted fresh per edit, so this seeds the form once. */
  draft: BannerDraft;
  isNew: boolean;
  orgOptions: SelectOption[];
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "save", _draft: BannerDraft): void;
}>();

const { t } = useI18nTyped();

const FORM_ID = "announcement-banner-form";

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const variantOptions = computed<SelectOption[]>(() =>
  VARIANTS.map((variant) => ({
    label: t(`announcements.variants.${variant}`),
    value: variant,
  })),
);

const scheduleOptions = computed<SelectOption[]>(() => [
  { label: t("announcements.form.scheduleAlways"), value: "always" },
  { label: t("announcements.form.scheduleDuration"), value: "duration" },
  { label: t("announcements.form.scheduleWindow"), value: "window" },
]);

const form = useOForm<BannerForm>({
  defaultValues: { ...props.draft } as BannerForm,
  // Passed as the schema itself, never a computed — useOForm hands this straight
  // to TanStack's validator slot, where a ref never resolves and the submit hangs.
  schema: makeBannerSchema(t),
  onSubmit: (values) => {
    // Explicit keys: the draft shape is what the list and the JSON writer read,
    // and a spread would carry whatever the schema happened to hold.
    emit("save", {
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
    });
    emit("update:open", false);
  },
});

// Drive the conditional sections from the one form, never a mirrored ref.
const schedule = form.useStore((state) => state.values.schedule);
const hasCta = form.useStore((state) => state.values.hasCta);

// Exposed so a test can drive the real submit — the footer button lives in the
// teleported dialog, out of the wrapper's reach.
defineExpose({ form });
</script>
