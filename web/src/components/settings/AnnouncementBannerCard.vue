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
    class="rounded-default border-border-default bg-surface-base flex items-start gap-3 border p-3"
    :data-test="`announcements-banner-card-${index}`"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <p class="text-text-heading line-clamp-2 text-sm">{{ raw(draft.message) }}</p>

      <!-- The four things an author checks before publishing: how loud it is, when
           it runs, who sees it, and whether it can be dismissed. Plain text rather
           than badges — the preview above already carries the colour. -->
      <div class="text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{{ t(`announcements.variants.${draft.variant}`) }}</span>
        <span>{{ scheduleSummary }}</span>
        <span>{{ audienceSummary }}</span>
        <span v-if="!draft.dismissible">{{ t("announcements.card.notDismissible") }}</span>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <OButton
        variant="ghost"
        size="sm"
        icon-left="edit"
        :aria-label="t('announcements.card.edit')"
        :data-test="`announcements-banner-card-edit-${index}`"
        @click="$emit('edit')"
      />
      <OButton
        variant="ghost"
        size="sm"
        icon-left="delete"
        :aria-label="t('announcements.card.remove')"
        :data-test="`announcements-banner-card-remove-${index}`"
        @click="$emit('remove')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { BannerDraft } from "./announcementDrafts";

const props = defineProps<{ draft: BannerDraft; index: number }>();

defineEmits<{ (_e: "edit"): void; (_e: "remove"): void }>();

const { t } = useI18nTyped();

const formatStamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const scheduleSummary = computed(() => {
  const { schedule, startsAt, endsAt, duration } = props.draft;

  if (schedule === "duration") {
    return t("announcements.card.forDuration", { duration: duration });
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

const audienceSummary = computed(() =>
  props.draft.orgs.length
    ? t("announcements.card.someOrgs", { count: props.draft.orgs.length })
    : t("announcements.card.allOrgs"),
);
</script>
