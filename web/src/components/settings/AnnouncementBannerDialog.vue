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
  <q-dialog
    :model-value="open"
    data-test="announcements-banner-dialog"
    @update:model-value="$emit('update:open', $event)"
  >
    <q-card class="announcement-dialog-card">
      <q-card-section class="announcement-dialog-header">
        <div class="text-h6">
          {{ isNew ? t("announcements.form.addTitle") : t("announcements.form.editTitle") }}
        </div>
        <div class="announcement-dialog-subtitle">
          {{ t("announcements.form.subtitle") }}
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="announcement-dialog-body">
        <div class="announcement-dialog-field">
          <q-input
            v-model="form.message"
            type="textarea"
            rows="3"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            hide-bottom-space
            :label="t('announcements.form.message')"
            :placeholder="t('announcements.form.messagePlaceholder')"
            :error="!!errors.message"
            :error-message="errors.message"
            data-test="announcements-banner-dialog-message"
          />
          <span class="announcement-dialog-hint">
            {{ t("announcements.form.messageHelp") }}
          </span>
        </div>

        <div class="announcement-dialog-grid">
          <div class="announcement-dialog-field">
            <q-select
              v-model="form.variant"
              class="showLabelOnTop no-case"
              stack-label
              borderless
              dense
              hide-bottom-space
              emit-value
              map-options
              :label="t('announcements.form.severity')"
              :options="variantOptions"
              data-test="announcements-banner-dialog-variant"
            />
            <span class="announcement-dialog-hint">
              {{ t("announcements.form.severityHelp") }}
            </span>
          </div>
          <div class="announcement-dialog-field">
            <q-select
              v-model="form.schedule"
              class="showLabelOnTop no-case"
              stack-label
              borderless
              dense
              hide-bottom-space
              emit-value
              map-options
              :label="t('announcements.form.schedule')"
              :options="scheduleOptions"
              data-test="announcements-banner-dialog-schedule"
            />
          </div>
        </div>

        <div v-if="form.schedule === 'duration'" class="announcement-dialog-field">
          <q-input
            v-model="form.duration"
            class="showLabelOnTop announcement-dialog-narrow"
            stack-label
            borderless
            dense
            hide-bottom-space
            :label="t('announcements.form.duration')"
            :placeholder="t('announcements.form.durationPlaceholder')"
            :error="!!errors.duration"
            :error-message="errors.duration"
            data-test="announcements-banner-dialog-duration"
          />
          <span class="announcement-dialog-hint">
            {{ t("announcements.form.durationHelp") }}
          </span>
        </div>

        <div v-if="form.schedule === 'window'" class="announcement-dialog-field">
          <div class="announcement-dialog-grid">
            <q-input
              v-model="form.startsAt"
              type="datetime-local"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              hide-bottom-space
              :label="t('announcements.form.startsAt')"
              :error="!!errors.startsAt"
              :error-message="errors.startsAt"
              data-test="announcements-banner-dialog-starts-at"
            />
            <q-input
              v-model="form.endsAt"
              type="datetime-local"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              hide-bottom-space
              :label="t('announcements.form.endsAt')"
              :error="!!errors.endsAt"
              :error-message="errors.endsAt"
              data-test="announcements-banner-dialog-ends-at"
            />
          </div>
          <!-- The picker is in the author's own zone; saying so avoids a notice
               scheduled hours off by someone assuming it means UTC. -->
          <span class="announcement-dialog-hint">
            {{ t("announcements.form.timezoneHint", { zone: timeZone }) }}
          </span>
        </div>

        <q-toggle
          v-model="form.dismissible"
          size="lg"
          class="o2-toggle-button-lg"
          :label="t('announcements.form.dismissible')"
          data-test="announcements-banner-dialog-dismissible"
        />

        <q-toggle
          v-model="form.hasCta"
          size="lg"
          class="o2-toggle-button-lg"
          :label="t('announcements.form.hasCta')"
          data-test="announcements-banner-dialog-has-cta"
        />

        <div v-if="form.hasCta" class="announcement-dialog-grid">
          <q-input
            v-model="form.ctaText"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            hide-bottom-space
            :label="t('announcements.form.ctaText')"
            :placeholder="t('announcements.form.ctaTextPlaceholder')"
            :error="!!errors.ctaText"
            :error-message="errors.ctaText"
            data-test="announcements-banner-dialog-cta-text"
          />
          <q-input
            v-model="form.ctaUrl"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            hide-bottom-space
            :label="t('announcements.form.ctaUrl')"
            :placeholder="t('announcements.form.ctaUrlPlaceholder')"
            :error="!!errors.ctaUrl"
            :error-message="errors.ctaUrl"
            data-test="announcements-banner-dialog-cta-url"
          />
        </div>

        <div class="announcement-dialog-field">
          <q-select
            v-model="form.orgs"
            class="showLabelOnTop no-case"
            stack-label
            borderless
            dense
            hide-bottom-space
            multiple
            use-chips
            emit-value
            map-options
            :label="t('announcements.form.orgs')"
            :options="orgOptions"
            :placeholder="t('announcements.form.orgsAll')"
            data-test="announcements-banner-dialog-orgs"
          />
          <span class="announcement-dialog-hint">
            {{ t("announcements.form.orgsHelp") }}
          </span>
        </div>
      </q-card-section>

      <q-separator />

      <q-card-actions align="right" class="tw:gap-2">
        <q-btn
          no-caps
          size="md"
          class="o2-secondary-button tw:h-[36px]"
          :label="t('announcements.settings.cancel')"
          data-test="announcements-banner-dialog-cancel"
          @click="$emit('update:open', false)"
        />
        <q-btn
          no-caps
          size="md"
          class="o2-primary-button no-border tw:h-[36px]"
          :label="t('announcements.form.apply')"
          data-test="announcements-banner-dialog-apply"
          @click="submit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import { validateBanner, type BannerErrors } from "./AnnouncementBannerDialog.validation";
import { VARIANTS, type BannerDraft } from "./announcementDrafts";

const props = defineProps<{
  open: boolean;
  /** The banner being edited. Mounted fresh per edit, so this seeds the form once. */
  draft: BannerDraft;
  isNew: boolean;
  orgOptions: { label: string; value: string }[];
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "save", _draft: BannerDraft): void;
}>();

const { t } = useI18n();

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Seeded once from the prop, so cancelling leaves the list untouched. */
const form = reactive<BannerDraft>({ ...props.draft });

const errors = ref<BannerErrors>({});

const variantOptions = computed(() =>
  VARIANTS.map((variant) => ({
    label: t(`announcements.variants.${variant}`),
    value: variant,
  })),
);

const scheduleOptions = computed(() => [
  { label: t("announcements.form.scheduleAlways"), value: "always" },
  { label: t("announcements.form.scheduleDuration"), value: "duration" },
  { label: t("announcements.form.scheduleWindow"), value: "window" },
]);

const submit = () => {
  errors.value = validateBanner(form, t);
  if (Object.keys(errors.value).length) return;

  // Explicit keys: the draft shape is what the list and the JSON writer read,
  // and a spread would carry whatever the form happened to hold.
  emit("save", {
    id: form.id ?? "",
    message: form.message,
    variant: form.variant,
    schedule: form.schedule,
    duration: form.duration ?? "",
    startsAt: form.startsAt ?? "",
    endsAt: form.endsAt ?? "",
    dismissible: form.dismissible,
    hasCta: form.hasCta,
    ctaText: form.ctaText ?? "",
    ctaUrl: form.ctaUrl ?? "",
    orgs: form.orgs ?? [],
  });
  emit("update:open", false);
};

// Exposed so a test can drive the real submit — the footer button lives in the
// teleported dialog, out of the wrapper's reach.
defineExpose({ form, errors, submit });
</script>

<style scoped lang="scss">
.announcement-dialog-card {
  width: 640px;
  max-width: 90vw;
}

.announcement-dialog-header {
  padding-bottom: 0.5rem;
}

.announcement-dialog-subtitle {
  font-size: 0.8125rem;
  opacity: 0.7;
}

.announcement-dialog-body {
  display: flex;
  flex-direction: column;
  /* Tight, because `showLabelOnTop` already reserves 32px above every control
     for its label — the old 1.25rem on top of that read as drifting apart. */
  gap: 0.25rem;
  max-height: 60vh;
  overflow-y: auto;
}

.announcement-dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.announcement-dialog-field {
  display: flex;
  flex-direction: column;
}

.announcement-dialog-narrow {
  max-width: 12rem;
}

.announcement-dialog-hint {
  font-size: 0.75rem;
  opacity: 0.7;
  /* Sits directly under its control rather than in Quasar's bottom slot, which
     `hide-bottom-space` collapses. */
  margin-top: 0.25rem;
}

/* `showLabelOnTop` lifts the label out of the control with
   `translate(-0.75rem, -175%)`, which cancels the 12px of left padding Quasar
   normally puts on `.q-field__control`. On a `borderless` field that padding is
   already 0, so the shift overshoots and the label hangs 12px left of the box.
   Drop the horizontal half of the transform and keep the vertical lift. */
.announcement-dialog-body {
  :deep(.q-field--labeled.showLabelOnTop) {
    &.q-field--float .q-field__label {
      transform: translateY(-175%);
    }

    /* The same rule zeroes the native's padding, which leaves the text and
       placeholder flush against the border. Put the inset back. */
    .q-field__native {
      padding: 4px 8px !important;
    }

    textarea.q-field__native {
      padding: 8px !important;
    }
  }
}
</style>
