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
  <div class="announcement-card" :data-test="`announcements-banner-card-${index}`">
    <div class="announcement-card-body">
      <p class="announcement-card-message">{{ draft.message }}</p>

      <!-- The four things an author checks before publishing: how loud it is, when
           it runs, who sees it, and whether it can be dismissed. Plain text rather
           than badges — the preview above already carries the colour. -->
      <div class="announcement-card-meta">
        <span>{{ t(`announcements.variants.${draft.variant}`) }}</span>
        <span>{{ scheduleSummary }}</span>
        <span>{{ audienceSummary }}</span>
        <span v-if="!draft.dismissible">{{ t("announcements.card.notDismissible") }}</span>
      </div>
    </div>

    <div class="announcement-card-actions">
      <q-btn
        flat
        dense
        round
        size="sm"
        icon="edit"
        :title="t('announcements.card.edit')"
        :aria-label="t('announcements.card.edit')"
        :data-test="`announcements-banner-card-edit-${index}`"
        @click="$emit('edit')"
      />
      <q-btn
        flat
        dense
        round
        size="sm"
        icon="delete"
        :title="t('announcements.card.remove')"
        :aria-label="t('announcements.card.remove')"
        :data-test="`announcements-banner-card-remove-${index}`"
        @click="$emit('remove')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { BannerDraft } from "./announcementDrafts";

const props = defineProps<{ draft: BannerDraft; index: number }>();

defineEmits<{ (_e: "edit"): void; (_e: "remove"): void }>();

const { t } = useI18n();

const formatStamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const scheduleSummary = computed(() => {
  const { schedule, startsAt, endsAt, duration } = props.draft;

  if (schedule === "duration") {
    return t("announcements.card.forDuration", { duration });
  }
  if (schedule === "window") {
    if (startsAt && endsAt) {
      return t("announcements.card.between", {
        from: formatStamp(startsAt),
        to: formatStamp(endsAt),
      });
    }
    if (startsAt) return t("announcements.card.from", { from: formatStamp(startsAt) });
    if (endsAt) return t("announcements.card.until", { to: formatStamp(endsAt) });
  }
  return t("announcements.card.always");
});

const audienceSummary = computed(() => {
  const count = props.draft.orgs.length;
  return count
    ? t("announcements.card.someOrgs", { count }, count)
    : t("announcements.card.allOrgs");
});
</script>

<style scoped lang="scss">
.announcement-card {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
}

.announcement-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.announcement-card-message {
  margin: 0;
  font-size: 0.875rem;
  /* Two lines is enough to recognise a banner; the preview shows it in full. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.announcement-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  font-size: 0.75rem;
  opacity: 0.7;
}

.announcement-card-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
</style>
