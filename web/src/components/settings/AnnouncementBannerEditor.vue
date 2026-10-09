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
  <div class="announcement-editor" data-test="announcement-editor-page">
    <div class="announcement-editor-header">
      <div class="announcement-editor-heading">
        <button
          type="button"
          class="announcement-editor-back el-border el-border-radius"
          :title="t('announcements.editor.back')"
          :aria-label="t('announcements.editor.back')"
          data-test="announcement-editor-back"
          @click="goToList"
        >
          <q-icon name="arrow_back_ios_new" size="1rem" />
        </button>
        <div>
          <div class="text-h6 announcement-editor-title" data-test="announcement-editor-title">
            {{ isNew ? t("announcements.editor.addTitle") : t("announcements.editor.editTitle") }}
          </div>
          <div
            v-if="currentStatus"
            class="announcement-editor-subtitle"
            data-test="announcement-editor-status"
          >
            {{ t("announcements.editor.currentStatus", { status: currentStatus }) }}
          </div>
        </div>
      </div>
      <div class="announcement-editor-actions">
        <q-btn
          no-caps
          flat
          class="o2-secondary-button tw:h-[36px]"
          :label="t('announcements.editor.cancel')"
          :disable="isSaving"
          data-test="announcement-editor-cancel"
          @click="goToList"
        />
        <q-btn
          no-caps
          flat
          class="o2-primary-button no-border tw:h-[36px]"
          :label="saveLabel"
          :loading="isSaving"
          :disable="!isLoaded"
          data-test="announcement-editor-save"
          @click="save"
        />
      </div>
    </div>

    <div
      v-if="errorMessage"
      class="announcement-editor-error"
      data-test="announcement-editor-error"
    >
      <q-icon name="error" size="16px" />
      <span>{{ errorMessage }}</span>
      <q-btn
        v-if="hasConflict"
        flat
        dense
        no-caps
        class="announcement-editor-reload"
        :label="t('announcements.editor.reload')"
        data-test="announcement-editor-reload"
        @click="reload"
      />
    </div>

    <div
      v-if="!isLoaded && !errorMessage"
      class="announcement-editor-loading"
      data-test="announcement-editor-loading"
    >
      <q-spinner-hourglass color="primary" size="2rem" />
    </div>

    <div v-else-if="isLoaded" class="announcement-editor-split">
      <div ref="formRef" class="announcement-editor-form">
        <section class="announcement-editor-section">
          <div class="announcement-editor-section-title">
            {{ t("announcements.editor.messageSection") }} *
          </div>
          <AnnouncementMessageField v-model="form.message" :error="errors.message" />
          <q-toggle
            v-model="form.hasCta"
            class="announcement-editor-switch"
            :label="t('announcements.editor.hasCta')"
            data-test="announcement-editor-has-cta"
          />
          <div v-if="form.hasCta" class="announcement-editor-grid">
            <q-input
              v-model="form.ctaText"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              hide-bottom-space
              :maxlength="CTA_TEXT_MAX + 10"
              :label="t('announcements.editor.ctaText')"
              :placeholder="t('announcements.editor.ctaTextPlaceholder')"
              :error="!!errors.ctaText"
              :error-message="errors.ctaText"
              data-test="announcement-editor-cta-text"
            />
            <q-input
              v-model="form.ctaUrl"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              hide-bottom-space
              :label="t('announcements.editor.ctaUrl')"
              :placeholder="t('announcements.editor.ctaUrlPlaceholder')"
              :error="!!errors.ctaUrl"
              :error-message="errors.ctaUrl"
              data-test="announcement-editor-cta-url"
            />
          </div>
        </section>

        <section class="announcement-editor-section">
          <div class="announcement-editor-section-title">
            {{ t("announcements.editor.styleSection") }}
          </div>
          <q-btn-toggle
            :model-value="styleChoice"
            class="announcement-editor-toggle"
            toggle-color="primary"
            no-caps
            unelevated
            :options="styleOptions"
            data-test="announcement-editor-variant"
            @update:model-value="chooseStyle"
          />
          <span class="announcement-editor-hint" data-test="announcement-editor-variant-help">
            {{
              selectedStyle
                ? t("announcements.editor.styleBehavesAs", {
                    severity: t(`announcements.variants.${selectedStyle.base}`),
                  })
                : t(`announcements.variantHelp.${form.variant}`)
            }}
          </span>
          <AnnouncementAppearanceField
            v-model:text-size="form.textSize"
            v-model:color-light="form.colorLight"
            v-model:color-dark="form.colorDark"
            v-model:icon="form.icon"
            :errors="errors"
          />
          <div class="announcement-editor-style-actions">
            <q-btn
              no-caps
              flat
              dense
              icon="bookmark_add"
              class="o2-secondary-button"
              :label="t('announcements.editor.saveAsStyle')"
              data-test="announcement-editor-save-style"
              @click="openSaveStyle"
            />
            <q-btn
              v-if="selectedStyle"
              no-caps
              flat
              dense
              icon="delete"
              color="negative"
              :label="
                t('announcements.editor.deleteStyle', {
                  name: selectedStyle.name,
                })
              "
              data-test="announcement-editor-delete-style"
              @click="deleteStyleOpen = true"
            />
          </div>
        </section>

        <section class="announcement-editor-section">
          <div class="announcement-editor-section-title">
            {{ t("announcements.editor.whoWhenSection") }}
          </div>
          <div class="announcement-editor-radios">
            <q-radio
              v-model="audience"
              val="all"
              :label="t('announcements.editor.audienceAll')"
              data-test="announcement-editor-audience-all"
            />
            <q-radio
              v-model="audience"
              val="some"
              :label="t('announcements.editor.audienceSome')"
              data-test="announcement-editor-audience-some"
            />
          </div>
          <q-select
            v-if="audience === 'some'"
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
            :label="t('announcements.editor.orgs')"
            :options="orgOptions"
            :error="!!errors.orgs"
            :error-message="errors.orgs"
            data-test="announcement-editor-orgs"
          />

          <span class="announcement-editor-label">{{
            t("announcements.editor.scheduleLabel")
          }}</span>
          <q-btn-toggle
            v-model="form.schedule"
            class="announcement-editor-toggle"
            toggle-color="primary"
            no-caps
            unelevated
            :options="scheduleOptions"
            data-test="announcement-editor-schedule"
          />
          <div v-if="form.schedule === 'duration'" class="announcement-editor-field">
            <div class="announcement-editor-duration-row">
              <q-input
                v-model="form.duration"
                class="showLabelOnTop announcement-editor-narrow"
                stack-label
                borderless
                dense
                hide-bottom-space
                :label="t('announcements.editor.duration')"
                :placeholder="t('announcements.editor.durationPlaceholder')"
                :error="!!errors.duration"
                :error-message="errors.duration"
                data-test="announcement-editor-duration"
              />
              <q-btn
                v-for="span in DURATION_PICKS"
                :key="span"
                no-caps
                dense
                unelevated
                :outline="form.duration !== span"
                color="primary"
                :label="span"
                :data-test="`announcement-editor-duration-${span}`"
                @click="form.duration = span"
              />
            </div>
            <span class="announcement-editor-hint">{{ durationHint }}</span>
          </div>
          <div v-if="form.schedule === 'window'" class="announcement-editor-field">
            <div class="announcement-editor-grid">
              <q-input
                v-model="form.startsAt"
                type="datetime-local"
                class="showLabelOnTop"
                stack-label
                borderless
                dense
                hide-bottom-space
                :label="t('announcements.editor.startsAt')"
                :error="!!errors.startsAt"
                :error-message="errors.startsAt"
                data-test="announcement-editor-starts-at"
              />
              <q-input
                v-model="form.endsAt"
                type="datetime-local"
                class="showLabelOnTop"
                stack-label
                borderless
                dense
                hide-bottom-space
                :label="t('announcements.editor.endsAt')"
                :error="!!errors.endsAt"
                :error-message="errors.endsAt"
                data-test="announcement-editor-ends-at"
              />
            </div>
            <span class="announcement-editor-hint">
              {{ t("announcements.editor.timezoneHint", { zone: timeZone }) }}
            </span>
          </div>

          <q-toggle
            v-model="form.dismissible"
            class="announcement-editor-switch"
            :label="t('announcements.editor.dismissible')"
            data-test="announcement-editor-dismissible"
          />
          <q-toggle
            v-if="!isNew && form.dismissible"
            v-model="resetDismissals"
            class="announcement-editor-switch"
            :label="t('announcements.editor.resetDismissals')"
            data-test="announcement-editor-reset-dismissals"
          />
        </section>
      </div>

      <div class="announcement-editor-preview">
        <AnnouncementBannerPreview :banner="previewBanner" :hidden="hiddenByCritical" />
      </div>
    </div>

    <q-dialog v-model="saveStyleOpen" data-test="announcement-editor-save-style-dialog">
      <q-card class="announcement-editor-leave-card">
        <q-card-section>
          <div class="text-h6">
            {{ t("announcements.editor.saveStyleTitle") }}
          </div>
          <div class="announcement-editor-hint">
            {{
              t("announcements.editor.saveStyleHint", {
                severity: t(`announcements.variants.${form.variant}`),
              })
            }}
          </div>
          <q-input
            v-model="styleName"
            class="showLabelOnTop tw:mt-3"
            stack-label
            borderless
            dense
            hide-bottom-space
            autofocus
            :label="t('announcements.editor.styleName')"
            :placeholder="t('announcements.editor.styleNamePlaceholder')"
            :error="!!styleError"
            :error-message="styleError"
            data-test="announcement-editor-style-name"
          />
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <q-btn
            v-close-popup
            no-caps
            flat
            class="o2-secondary-button"
            :label="t('announcements.editor.cancel')"
          />
          <q-btn
            no-caps
            flat
            class="o2-primary-button no-border"
            :label="t('announcements.editor.saveStyle')"
            :disable="!styleName.trim()"
            :loading="isSaving"
            data-test="announcement-editor-save-style-confirm"
            @click="saveStyle"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="deleteStyleOpen" data-test="announcement-editor-delete-style-dialog">
      <q-card class="announcement-editor-leave-card">
        <q-card-section>
          <div class="text-h6">
            {{
              t("announcements.editor.deleteStyleTitle", {
                name: selectedStyle?.name ?? "",
              })
            }}
          </div>
          <div class="announcement-editor-hint">
            {{ t("announcements.editor.deleteStyleHint") }}
          </div>
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <q-btn
            v-close-popup
            no-caps
            flat
            class="o2-secondary-button"
            :label="t('announcements.editor.cancel')"
          />
          <q-btn
            no-caps
            unelevated
            color="negative"
            :label="t('announcements.list.delete')"
            :loading="isSaving"
            data-test="announcement-editor-delete-style-confirm"
            @click="deleteStyle"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="leaveDialogOpen" data-test="announcement-editor-leave-dialog">
      <q-card class="announcement-editor-leave-card">
        <q-card-section>
          <div class="text-h6">{{ t("announcements.editor.leaveTitle") }}</div>
          <div class="announcement-editor-hint">
            {{ t("announcements.editor.unsavedMessage") }}
          </div>
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <q-btn
            v-close-popup
            no-caps
            flat
            class="o2-secondary-button"
            :label="t('announcements.editor.keepEditing')"
            data-test="announcement-editor-keep-editing"
          />
          <q-btn
            no-caps
            unelevated
            color="negative"
            :label="t('announcements.editor.discard')"
            data-test="announcement-editor-discard"
            @click="discardAndLeave"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { notifyAnnouncementsChanged } from "@/composables/useAnnouncementBanners";
import announcements from "@/services/announcements";
import { DEFAULT_TEXT_SIZE, isBannerIcon, materialIconName } from "@/utils/announcementAppearance";
import type { BannerVariantName } from "@/utils/announcementOrder";
import AnnouncementAppearanceField from "./AnnouncementAppearanceField.vue";
import AnnouncementBannerPreview from "./AnnouncementBannerPreview.vue";
import AnnouncementMessageField from "./AnnouncementMessageField.vue";
import {
  addStyle,
  formatStamp,
  isHiddenByCritical,
  isUnchangedAt,
  listStatuses,
  parseIndexQuery,
  removeStyle,
  saveIntent,
  upsertBanner,
} from "./announcementConfig";
import {
  VARIANTS,
  emptyDraft,
  indexedDraftsFromConfig,
  newBannerId,
  parseDurationMs,
  previewFromDraft,
  stylesFromConfig,
  type BannerDraft,
  type BannerStyle,
  type IndexedDraft,
} from "./announcementDrafts";
import { CTA_TEXT_MAX, validateBanner, type BannerErrors } from "./announcementValidation";

const VARIANT_ICONS: Record<string, string> = {
  info: "info",
  warning: "warning",
  critical: "error",
  promo: "campaign",
};

const STYLE_CHOICE_PREFIX = "style:";
const DURATION_PICKS = ["1h", "4h", "1d", "1w"];

class BannerConflictError extends Error {}

const { t } = useI18n();
const q = useQuasar();
const route = useRoute();
const router = useRouter();
const store = useStore();

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const form = reactive<BannerDraft>(emptyDraft());
const errors = ref<BannerErrors>({});
const errorMessage = ref("");
const hasConflict = ref(false);
const isLoaded = ref(false);
const isSaving = ref(false);
const saveAttempted = ref(false);
const entries = ref<IndexedDraft[]>([]);
const editIndex = ref<number | null>(null);
const savedSnapshot = ref("");
const audience = ref<"all" | "some">("all");
const resetDismissals = ref(false);
const leaveDialogOpen = ref(false);
const pendingLeave = ref("");
const formRef = ref<HTMLElement | null>(null);
const styles = ref<BannerStyle[]>([]);
const saveStyleOpen = ref(false);
const deleteStyleOpen = ref(false);
const styleName = ref("");
const styleError = ref("");
let leaveConfirmed = false;

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

const isNew = computed(() => editIndex.value == null);

const snapshot = () =>
  JSON.stringify({
    form,
    audience: audience.value,
    reset: resetDismissals.value,
  });

const isDirty = computed(() => isLoaded.value && snapshot() !== savedSnapshot.value);

const editedEntry = computed(() => entries.value.find((entry) => entry.index === editIndex.value));

const currentStatus = computed(() => {
  if (editIndex.value == null) return "";
  const status = listStatuses(entries.value, Date.now()).get(editIndex.value);
  return status ? t(`announcements.list.status.${status}`) : "";
});

const intent = computed(() => saveIntent(form, Date.now()));

const saveLabel = computed(() => {
  if (intent.value === "publish") return t("announcements.editor.publishNow");
  if (intent.value === "schedule") return t("announcements.editor.schedule");
  return t("announcements.editor.save");
});

const orgOptions = computed(() =>
  (store.state.organizations ?? []).map((org: { identifier: string; name?: string }) => ({
    label:
      org.name && org.name !== org.identifier ? `${org.name} (${org.identifier})` : org.identifier,
    value: org.identifier,
  })),
);

const selectedStyle = computed(() => styles.value.find((style) => style.id === form.styleId));

const styleChoice = computed(() =>
  selectedStyle.value ? `${STYLE_CHOICE_PREFIX}${selectedStyle.value.id}` : form.variant,
);

const styleOptions = computed(() => [
  ...VARIANTS.map((variant) => ({
    label: t(`announcements.variants.${variant}`),
    icon: VARIANT_ICONS[variant],
    value: variant,
    attrs: { "data-test": `announcement-editor-variant-${variant}` },
  })),
  ...styles.value.map((style) => ({
    label: style.name,
    icon: isBannerIcon(style.icon) ? materialIconName(style.icon) : VARIANT_ICONS[style.base],
    value: `${STYLE_CHOICE_PREFIX}${style.id}`,
    attrs: { "data-test": `announcement-editor-style-${style.id}` },
  })),
]);

const scheduleOptions = computed(() =>
  (["always", "duration", "window"] as const).map((schedule) => ({
    label: t(`announcements.editor.schedule${schedule[0].toUpperCase()}${schedule.slice(1)}`),
    value: schedule,
    attrs: { "data-test": `announcement-editor-schedule-${schedule}` },
  })),
);

const previewBanner = computed(() => previewFromDraft(form));

const hiddenByCritical = computed(() =>
  isHiddenByCritical(
    { ...form, orgs: audience.value === "some" ? form.orgs : [] },
    entries.value.filter((entry) => entry.index !== editIndex.value).map((entry) => entry.draft),
    Date.now(),
  ),
);

const durationHint = computed(() => {
  const ms = parseDurationMs(form.duration ?? "");
  return ms
    ? t("announcements.editor.durationEnds", {
        time: formatStamp(new Date(Date.now() + ms).toISOString()),
      })
    : t("announcements.editor.durationHelp");
});

const serverMessage = (error: any, fallback: string) =>
  error?.response?.data?.message || error?.response?.data?.error || fallback;

const validate = (): BannerErrors => {
  const found = validateBanner(form, t);
  if (audience.value === "some" && !form.orgs.length) {
    found.orgs = t("announcements.editor.orgsRequired");
  }
  return found;
};

const setVariant = (variant: BannerVariantName) => {
  // An outage notice should stay up; the author can still turn dismissal back on.
  if (variant === "critical" && form.variant !== "critical") form.dismissible = false;
  form.variant = variant;
};

const chooseStyle = (choice: string) => {
  const style = styles.value.find((s) => `${STYLE_CHOICE_PREFIX}${s.id}` === choice);
  if (style) {
    setVariant(style.base);
    Object.assign(form, {
      icon: style.icon,
      textSize: style.textSize,
      colorLight: style.colorLight,
      colorDark: style.colorDark,
      styleId: style.id,
    });
    return;
  }
  setVariant(choice as BannerVariantName);
  Object.assign(form, {
    icon: "",
    textSize: DEFAULT_TEXT_SIZE,
    colorLight: "",
    colorDark: "",
    styleId: "",
  });
};

// A banner restyled after picking a saved style no longer matches it, so stop labelling it with that name.
watch(
  () => [form.icon, form.textSize, form.colorLight, form.colorDark],
  () => {
    const style = selectedStyle.value;
    if (!style) return;
    const same =
      form.icon === style.icon &&
      form.textSize === style.textSize &&
      form.colorLight.toUpperCase() === style.colorLight &&
      form.colorDark.toUpperCase() === style.colorDark;
    if (!same) form.styleId = "";
  },
);

const goToList = () => {
  router.push({
    name: "announcementBanners",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

const discardAndLeave = () => {
  leaveConfirmed = true;
  leaveDialogOpen.value = false;
  router.push(pendingLeave.value);
};

const seedForm = (draft: BannerDraft) => {
  Object.assign(form, { ...draft, orgs: [...draft.orgs] });
  audience.value = draft.orgs.length ? "some" : "all";
  resetDismissals.value = false;
  errors.value = {};
  saveAttempted.value = false;
  savedSnapshot.value = snapshot();
};

const load = async () => {
  try {
    const response = await announcements.getConfig(metaOrg.value);
    entries.value = indexedDraftsFromConfig(response?.data);
    styles.value = stylesFromConfig(response?.data);
  } catch (error: any) {
    errorMessage.value = serverMessage(error, t("announcements.list.loadFailed"));
    return;
  }

  const index = parseIndexQuery(route.query.index);
  const duplicate = parseIndexQuery(route.query.duplicate);
  const source = index ?? duplicate;
  const found = entries.value.find((entry) => entry.index === source);

  if (source != null && !found) {
    q.notify({
      type: "negative",
      message: t("announcements.editor.notFound"),
      timeout: 3000,
    });
    leaveConfirmed = true;
    goToList();
    return;
  }

  editIndex.value = index != null && found ? index : null;
  // A copy gets a fresh dismissal key, so dismissing one never hides the other.
  seedForm(
    found ? { ...found.draft, id: index != null ? found.draft.id : newBannerId() } : emptyDraft(),
  );
  isLoaded.value = true;
};

const reload = async () => {
  errorMessage.value = "";
  hasConflict.value = false;
  isLoaded.value = false;
  await load();
};

const savedMessage = () => {
  if (intent.value === "schedule") {
    return t("announcements.editor.savedScheduled", {
      time: formatStamp(form.startsAt, true),
    });
  }
  if (intent.value !== "publish") return t("announcements.editor.saved");
  const count = audience.value === "some" ? form.orgs.length : 0;
  return count
    ? t("announcements.editor.savedLiveSome", { count }, count)
    : t("announcements.editor.savedLiveAll");
};

const draftToSave = (): BannerDraft => ({
  ...form,
  orgs: audience.value === "some" ? [...form.orgs] : [],
  id:
    (resetDismissals.value && form.dismissible) || (isNew.value && !form.id)
      ? newBannerId()
      : form.id,
});

const write = async () => {
  const latest = (await announcements.getConfig(metaOrg.value))?.data;
  const index = editIndex.value;
  if (index != null && !isUnchangedAt(latest, index, editedEntry.value?.raw)) {
    throw new BannerConflictError();
  }
  await announcements.setConfig(metaOrg.value, upsertBanner(latest, index, draftToSave()));
};

const scrollToFirstError = async () => {
  await nextTick();
  formRef.value
    ?.querySelector(".q-field--error")
    ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
};

const save = async () => {
  saveAttempted.value = true;
  errors.value = validate();
  if (Object.keys(errors.value).length) return scrollToFirstError();

  isSaving.value = true;
  errorMessage.value = "";
  hasConflict.value = false;
  try {
    await write();
    notifyAnnouncementsChanged();
    q.notify({ type: "positive", message: savedMessage(), timeout: 3000 });
    leaveConfirmed = true;
    goToList();
  } catch (error: any) {
    hasConflict.value = error instanceof BannerConflictError;
    errorMessage.value = hasConflict.value
      ? t("announcements.editor.conflict")
      : serverMessage(error, t("announcements.editor.saveFailed"));
  } finally {
    isSaving.value = false;
  }
};

const beforeUnload = (event: BeforeUnloadEvent) => {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = t("announcements.editor.unsavedMessage");
};

watch(
  [form, audience],
  () => {
    if (saveAttempted.value) errors.value = validate();
  },
  { deep: true },
);

const openSaveStyle = () => {
  styleName.value = "";
  styleError.value = "";
  saveStyleOpen.value = true;
};

/** Writes only the saved styles, re-reading first so banners saved elsewhere meanwhile survive. */
const writeStyles = async (change: (latest: unknown) => unknown) => {
  isSaving.value = true;
  try {
    const latest = (await announcements.getConfig(metaOrg.value))?.data;
    const next = change(latest);
    await announcements.setConfig(metaOrg.value, next);
    styles.value = stylesFromConfig(next);
  } finally {
    isSaving.value = false;
  }
};

const saveStyle = async () => {
  const style: BannerStyle = {
    id: newBannerId("style"),
    name: styleName.value.trim(),
    base: form.variant,
    icon: form.icon,
    textSize: form.textSize,
    colorLight: form.colorLight.toUpperCase(),
    colorDark: form.colorDark.toUpperCase(),
  };
  try {
    await writeStyles((latest) => addStyle(latest, style));
    form.styleId = style.id;
    saveStyleOpen.value = false;
    q.notify({
      type: "positive",
      message: t("announcements.editor.styleSaved", { name: style.name }),
      timeout: 3000,
    });
  } catch (error: any) {
    styleError.value = serverMessage(error, t("announcements.editor.saveFailed"));
  }
};

const deleteStyle = async () => {
  const style = selectedStyle.value;
  if (!style) return;
  try {
    await writeStyles((latest) => removeStyle(latest, style.id));
    form.styleId = "";
    q.notify({
      type: "positive",
      message: t("announcements.editor.styleDeleted", { name: style.name }),
      timeout: 3000,
    });
  } catch (error: any) {
    q.notify({
      type: "negative",
      message: serverMessage(error, t("announcements.editor.saveFailed")),
    });
  } finally {
    deleteStyleOpen.value = false;
  }
};

onBeforeRouteLeave((to, _from, next) => {
  if (leaveConfirmed || !isDirty.value) return next();
  pendingLeave.value = to.fullPath;
  leaveDialogOpen.value = true;
  next(false);
});

onMounted(() => {
  window.addEventListener("beforeunload", beforeUnload);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", beforeUnload);
});

defineExpose({
  form,
  errors,
  save,
  isDirty,
  audience,
  resetDismissals,
  saveLabel,
  chooseStyle,
  styles,
});
</script>

<style scoped lang="scss">
.announcement-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.announcement-editor-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
}

.announcement-editor-heading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.announcement-editor-title {
  overflow-wrap: anywhere;
}

.announcement-editor-subtitle {
  font-size: 0.8125rem;
  opacity: 0.7;
}

.announcement-editor-back {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.announcement-editor-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

.announcement-editor-reload {
  margin-left: auto;
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
}

.announcement-editor-radios {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1rem;
}

.announcement-editor-switch :deep(.q-toggle__label) {
  padding-left: 0.5rem;
}

.announcement-editor-leave-card {
  width: 26rem;
  max-width: 90vw;
}

.announcement-editor-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.75rem 1rem 0;
  padding: 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

.announcement-editor-loading {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.announcement-editor-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}

.announcement-editor-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1rem;
  overflow-y: auto;
  border-right: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
}

.announcement-editor-preview {
  padding: 1rem;
  overflow-y: auto;
}

.announcement-editor-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.announcement-editor-section-title {
  font-size: 0.875rem;
  font-weight: 700;
}

.announcement-editor-field {
  display: flex;
  flex-direction: column;
}

.announcement-editor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 1rem;
}

.announcement-editor-hint {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  opacity: 0.7;
}

.announcement-editor-toggle {
  align-self: flex-start;
  flex-wrap: wrap;
  max-width: 100%;
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
}

.announcement-editor-narrow {
  max-width: 12rem;
}

.announcement-editor-label {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.announcement-editor-duration-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
}

.announcement-editor-style-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 1023px) {
  .announcement-editor {
    height: auto;
  }

  .announcement-editor-split {
    grid-template-columns: minmax(0, 1fr);
  }

  .announcement-editor-form,
  .announcement-editor-preview {
    overflow-y: visible;
  }

  .announcement-editor-form {
    border-right: none;
    border-bottom: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  }
}

.announcement-editor-form :deep(.q-field--labeled.showLabelOnTop) {
  &.q-field--float .q-field__label {
    transform: translateY(-175%);
  }

  .q-field__native {
    padding: 4px 8px !important;
  }
}
</style>
