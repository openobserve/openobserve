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
  <div class="announcement-list" data-test="announcement-banners-settings">
    <div class="announcement-list-header">
      <div>
        <div class="q-table__title tw:font-[600]" data-test="announcement-banners-title">
          {{ t("announcements.list.title") }}
        </div>
        <div class="announcement-list-subtitle">{{ t("announcements.list.subtitle") }}</div>
      </div>
      <q-btn
        no-caps
        flat
        class="o2-primary-button tw:h-[36px]"
        :label="t('announcements.list.addBanner')"
        data-test="announcement-banners-add-btn"
        @click="openEditor()"
      />
    </div>

    <div v-if="errorMessage" class="announcement-list-error" data-test="announcement-banners-error">
      <q-icon name="error" size="16px" />
      <span>{{ errorMessage }}</span>
    </div>

    <div v-if="!isLoaded" class="announcement-list-placeholder">
      {{ t("announcements.list.loading") }}
    </div>

    <template v-else>
      <section class="announcement-list-section">
        <div class="announcement-list-section-title">{{ t("announcements.list.liveNow") }}</div>
        <div class="announcement-list-live" data-test="announcement-banners-preview">
          <AnnouncementBannerStrip
            v-for="(banner, position) in liveBanners"
            :key="position"
            :banner="banner"
            :mode="themeMode"
            preview
          />
          <div
            v-if="!liveBanners.length"
            class="announcement-list-live-empty"
            data-test="announcement-banners-preview-empty"
          >
            {{ t("announcements.list.liveNowEmpty") }}
          </div>
        </div>
      </section>

      <section class="announcement-list-section">
        <div class="announcement-list-section-title">{{ t("announcements.list.allBanners") }}</div>

        <div
          v-if="!rows.length"
          class="announcement-list-empty"
          data-test="announcement-banners-list-empty"
        >
          <q-icon name="campaign" size="2.5rem" class="announcement-list-empty-icon" />
          <div class="announcement-list-empty-title">{{ t("announcements.list.emptyTitle") }}</div>
          <div class="announcement-list-empty-hint">{{ t("announcements.list.emptyHint") }}</div>
          <q-btn
            no-caps
            flat
            class="o2-primary-button tw:h-[36px]"
            :label="t('announcements.list.addBanner')"
            data-test="announcement-banners-empty-add-btn"
            @click="openEditor()"
          />
        </div>

        <q-table
          v-else
          :rows="rows"
          :columns="columns"
          row-key="index"
          flat
          hide-pagination
          :rows-per-page-options="[0]"
          :pagination="{ rowsPerPage: 0 }"
          class="o2-quasar-table o2-row-md"
          data-test="announcement-banners-list"
          @row-click="(_event: Event, row: ListRow) => openEditor({ index: row.index })"
        >
          <template #body-cell-message="props">
            <q-td :props="props" class="announcement-list-message-cell">
              <span
                class="announcement-list-message"
                :data-test="`announcement-banners-row-message-${props.row.index}`"
                v-html="props.row.messageHtml"
              />
            </q-td>
          </template>
          <template #body-cell-severity="props">
            <q-td :props="props">
              <span class="announcement-list-severity">
                <span
                  class="announcement-list-dot"
                  :class="`announcement-list-dot--${props.row.draft.variant}`"
                />
                {{ t(`announcements.variants.${props.row.draft.variant}`) }}
              </span>
            </q-td>
          </template>
          <template #body-cell-status="props">
            <q-td :props="props">
              <span
                class="announcement-list-status"
                :class="`announcement-list-status--${props.row.status}`"
                :data-test="`announcement-banners-row-status-${props.row.index}`"
              >
                {{ props.row.statusLabel }}
              </span>
            </q-td>
          </template>
          <template #body-cell-actions="props">
            <q-td :props="props" class="announcement-list-actions">
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="edit"
                :title="t('announcements.list.edit')"
                :aria-label="t('announcements.list.edit')"
                :data-test="`announcement-banners-row-edit-${props.row.index}`"
                @click.stop="openEditor({ index: props.row.index })"
              />
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="content_copy"
                :title="t('announcements.list.duplicate')"
                :aria-label="t('announcements.list.duplicate')"
                :data-test="`announcement-banners-row-duplicate-${props.row.index}`"
                @click.stop="openEditor({ duplicate: props.row.index })"
              />
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="delete"
                :title="t('announcements.list.delete')"
                :aria-label="t('announcements.list.delete')"
                :data-test="`announcement-banners-row-delete-${props.row.index}`"
                @click.stop="pendingDelete = props.row.index"
              />
            </q-td>
          </template>
        </q-table>
      </section>
    </template>

    <q-dialog
      :model-value="pendingDelete != null"
      data-test="announcement-banners-delete-dialog"
      @update:model-value="(open: boolean) => !open && (pendingDelete = null)"
    >
      <q-card class="announcement-list-delete-card">
        <q-card-section>
          <div class="text-h6">{{ t("announcements.list.deleteTitle") }}</div>
          <div
            class="announcement-list-delete-body"
            data-test="announcement-banners-delete-message"
          >
            {{ t("announcements.list.deleteMessage", { message: pendingDeleteExcerpt }) }}
          </div>
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <q-btn
            no-caps
            flat
            class="o2-secondary-button"
            :label="t('announcements.list.deleteCancel')"
            data-test="announcement-banners-delete-cancel"
            @click="pendingDelete = null"
          />
          <q-btn
            no-caps
            unelevated
            color="negative"
            :label="t('announcements.list.deleteConfirm')"
            data-test="announcement-banners-delete-confirm"
            @click="confirmDelete"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar, type QTableColumn } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import AnnouncementBannerStrip from "@/components/announcements/AnnouncementBannerStrip.vue";
import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
import announcements from "@/services/announcements";
import { presetFor, type ThemeMode } from "@/utils/announcementAppearance";
import { renderBannerMarkdown } from "@/utils/announcementMarkdown";
import { orderBanners } from "@/utils/announcementOrder";
import {
  formatSpan,
  formatStamp,
  isShowingNow,
  isUnchangedAt,
  listStatuses,
  remainingMs,
  removeBanner,
  type ListStatus,
} from "./announcementConfig";
import {
  indexedDraftsFromConfig,
  previewFromDraft,
  type BannerDraft,
  type IndexedDraft,
} from "./announcementDrafts";

interface ListRow {
  index: number;
  draft: BannerDraft;
  messageHtml: string;
  status: ListStatus;
  statusLabel: string;
  schedule: string;
  audience: string;
  appearance: string;
}

const { t } = useI18n();
const q = useQuasar();
const { notifyConfigChanged } = useAnnouncementDraftPreview();
const router = useRouter();
const store = useStore();

const entries = ref<IndexedDraft[]>([]);
const isLoaded = ref(false);
const errorMessage = ref("");
const pendingDelete = ref<number | null>(null);
const nowMs = ref(Date.now());

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

const themeMode = computed<ThemeMode>(() => (store.state.theme === "dark" ? "dark" : "light"));

const PHONE_HIDDEN_COLUMNS = ["severity", "schedule", "audience", "appearance"];

const DELETE_EXCERPT_LENGTH = 60;

const COLUMN_STYLES: Record<string, string | undefined> = {
  schedule: "white-space: normal; min-width: 11rem",
  status: "white-space: normal; min-width: 5rem",
};

const columns = computed<QTableColumn[]>(() =>
  (["message", "severity", "status", "schedule", "audience", "appearance"] as const)
    .map(
      (name): QTableColumn => ({
        name,
        field: name,
        label: t(`announcements.list.columns.${name}`),
        align: "left",
        classes: PHONE_HIDDEN_COLUMNS.includes(name) ? "gt-xs" : undefined,
        headerClasses: PHONE_HIDDEN_COLUMNS.includes(name) ? "gt-xs" : undefined,
        style: COLUMN_STYLES[name],
      }),
    )
    .concat({
      name: "actions",
      field: "index",
      label: t("announcements.list.columns.actions"),
      align: "center",
    }),
);

const scheduleSummary = ({ schedule, startsAt, endsAt, duration }: BannerDraft) => {
  if (schedule === "duration") return t("announcements.list.forDuration", { duration });
  if (schedule === "window" && startsAt && endsAt) {
    return t("announcements.list.between", {
      from: formatStamp(startsAt),
      to: formatStamp(endsAt, true),
    });
  }
  if (schedule === "window" && startsAt) {
    return t("announcements.list.from", { from: formatStamp(startsAt, true) });
  }
  if (schedule === "window" && endsAt) {
    return t("announcements.list.until", { to: formatStamp(endsAt, true) });
  }
  return t("announcements.list.always");
};

const audienceSummary = ({ orgs }: BannerDraft) =>
  orgs.length
    ? t("announcements.list.someOrgs", { count: orgs.length }, orgs.length)
    : t("announcements.list.allOrgs");

const appearanceSummary = ({ textSize, colorLight, colorDark }: BannerDraft) => {
  const size = t(`announcements.editor.textSizes.${textSize}`);
  if (!colorLight && !colorDark) return `${size} · ${t("announcements.list.colorSeverity")}`;
  const preset = presetFor(colorLight, colorDark);
  const color = preset
    ? t(`announcements.editor.colorPresets.${preset.key}`)
    : t("announcements.list.colorCustom");
  return `${size} · ${color}`;
};

const statusLabel = (status: ListStatus, draft: BannerDraft) => {
  const remaining = remainingMs(draft, nowMs.value);
  return status === "live" && remaining != null
    ? t("announcements.list.liveEndsIn", { span: formatSpan(remaining) })
    : t(`announcements.list.status.${status}`);
};

const statuses = computed(() => listStatuses(entries.value, nowMs.value));

const rows = computed<ListRow[]>(() =>
  entries.value.map(({ index, draft }) => ({
    index,
    draft,
    messageHtml: renderBannerMarkdown(draft.message),
    status: statuses.value.get(index) ?? "live",
    statusLabel: statusLabel(statuses.value.get(index) ?? "live", draft),
    schedule: scheduleSummary(draft),
    audience: audienceSummary(draft),
    appearance: appearanceSummary(draft),
  })),
);

const liveBanners = computed(() =>
  orderBanners(
    entries.value
      .filter(({ draft }) => isShowingNow(draft, nowMs.value))
      .map(({ draft }) => previewFromDraft(draft)),
  ),
);

const pendingDeleteExcerpt = computed(() => {
  const entry = entries.value.find(({ index }) => index === pendingDelete.value);
  const text = (entry?.draft.message ?? "").replace(/[*_`~]|\[|\]\([^)]*\)/g, "").trim();
  return text.length > DELETE_EXCERPT_LENGTH
    ? `${text.slice(0, DELETE_EXCERPT_LENGTH).trimEnd()}…`
    : text;
});

const serverMessage = (error: any, fallback: string) =>
  error?.response?.data?.message || error?.response?.data?.error || fallback;

const openEditor = (query: { index?: number; duplicate?: number } = {}) => {
  router.push({
    name: "announcementBannerEditor",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      ...Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])),
    },
  });
};

const load = async () => {
  try {
    const response = await announcements.getConfig(metaOrg.value);
    entries.value = indexedDraftsFromConfig(response?.data);
    nowMs.value = Date.now();
    errorMessage.value = "";
  } catch (error: any) {
    errorMessage.value = serverMessage(error, t("announcements.list.loadFailed"));
  } finally {
    isLoaded.value = true;
  }
};

const confirmDelete = async () => {
  const index = pendingDelete.value;
  pendingDelete.value = null;
  if (index == null) return;
  const original = entries.value.find((entry) => entry.index === index)?.raw;

  try {
    const latest = (await announcements.getConfig(metaOrg.value))?.data;
    if (!isUnchangedAt(latest, index, original)) {
      q.notify({ type: "negative", message: t("announcements.list.conflict"), timeout: 5000 });
      await load();
      return;
    }
    await announcements.setConfig(metaOrg.value, removeBanner(latest, index));
    notifyConfigChanged();
    q.notify({ type: "positive", message: t("announcements.list.deleted"), timeout: 2000 });
    await load();
  } catch (error: any) {
    q.notify({
      type: "negative",
      message: serverMessage(error, t("announcements.list.deleteFailed")),
      timeout: 5000,
    });
  }
};

onMounted(load);

defineExpose({ rows, liveBanners, confirmDelete, pendingDelete, reload: load });
</script>

<style scoped lang="scss">
.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 1rem;
}

.announcement-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
}

.announcement-list-subtitle {
  font-size: 0.8125rem;
  opacity: 0.7;
}

.announcement-list-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 1rem;
  padding: 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

.announcement-list-placeholder {
  padding: 2rem 0;
  text-align: center;
  font-size: 0.875rem;
  opacity: 0.6;
}

.announcement-list-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 1rem;
}

.announcement-list-section-title {
  font-size: 0.875rem;
  font-weight: 700;
}

.announcement-list-live {
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
  overflow: hidden;
}

.announcement-list-live-empty {
  padding: 0.75rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  opacity: 0.6;
}

.announcement-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
  border: 1px dashed var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
}

.announcement-list-empty-icon {
  opacity: 0.5;
}

.announcement-list-empty-title {
  font-size: 0.9375rem;
  font-weight: 600;
}

.announcement-list-empty-hint {
  font-size: 0.8125rem;
  opacity: 0.7;
}

.announcement-list-message-cell {
  max-width: min(24rem, 30vw);
}

@media (max-width: 599px) {
  .announcement-list :deep(.q-table td),
  .announcement-list :deep(.q-table th) {
    padding-left: 0.375rem;
    padding-right: 0.375rem;
  }
}

.announcement-list-message {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  :deep(a) {
    pointer-events: none;
  }
}

.announcement-list-severity {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.announcement-list-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}

.announcement-list-dot--info {
  background: #2563eb;
}

.announcement-list-dot--warning {
  background: #fbbf24;
}

.announcement-list-dot--critical {
  background: #dc2626;
}

.announcement-list-dot--promo {
  background: #7c3aed;
}

.announcement-list-status {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(128, 128, 128, 0.15);
}

.announcement-list-status--live,
.announcement-list-status--always {
  background: rgba(22, 163, 74, 0.15);
  color: #16a34a;
}

.announcement-list-status--hidden {
  background: rgba(128, 128, 128, 0.15);
  opacity: 0.8;
}

.announcement-list-delete-card {
  width: 28rem;
  max-width: 90vw;
}

.announcement-list-delete-body {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

.announcement-list-status--scheduled {
  background: rgba(37, 99, 235, 0.15);
  color: #2563eb;
}

.announcement-list-actions {
  white-space: nowrap;
}

:deep(tbody tr) {
  cursor: pointer;
}
</style>
