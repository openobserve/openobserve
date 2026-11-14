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

<script setup lang="ts">
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type { usePackUpdates } from "@/composables/starterPacks/usePackUpdates";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ updates: ReturnType<typeof usePackUpdates> }>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();

const shown = (value: unknown) =>
  raw(
    value === null || value === undefined
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value),
  );

const apply = async () => {
  if (await props.updates.apply()) open.value = false;
};
</script>

<template>
  <ODrawer
    v-model:open="open"
    size="lg"
    :title="t('starterPacks.update.title')"
    data-test="starter-pack-update-drawer"
  >
    <div class="flex flex-col gap-3 p-3 text-sm">
      <OText variant="meta">{{ t("starterPacks.update.note") }}</OText>
      <OBanner
        v-if="updates.state.value === 'error'"
        variant="error-soft"
        dense
        :content="t('starterPacks.update.failed')"
      />
      <div
        v-for="update in updates.updates.value"
        :key="update.itemId"
        class="border-border-default rounded-default flex flex-col gap-2 border p-3"
        data-test="starter-pack-update-item"
      >
        <strong>{{ update.name }}</strong>
        <OText v-if="!update.rows.length" variant="meta">
          {{ t("starterPacks.update.noFieldChanges") }}
        </OText>
        <div
          v-for="row in update.rows"
          :key="row.field"
          class="border-border-default flex flex-col gap-1 border-t pt-2"
          :data-test="`starter-pack-update-row-${row.field}`"
        >
          <span class="flex items-center justify-between gap-2">
            <OText variant="meta">{{ raw(row.field) }}</OText>
            <OBadge :variant="row.outcome === 'kept' ? 'default-outline' : 'success-outline'">
              {{
                t(
                  row.outcome === "kept"
                    ? "starterPacks.update.kept"
                    : "starterPacks.update.updated",
                )
              }}
            </OBadge>
          </span>
          <div class="grid grid-cols-2 gap-3">
            <span class="flex min-w-0 flex-col break-words">
              <OText variant="meta">{{ t("starterPacks.update.yours") }}</OText>
              {{ shown(row.yours) }}
            </span>
            <span class="flex min-w-0 flex-col break-words">
              <OText variant="meta">{{ t("starterPacks.update.library") }}</OText>
              {{ shown(row.library) }}
            </span>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="open = false">
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="updates.state.value === 'applying'"
          data-test="starter-pack-update-apply-btn"
          @click="apply"
        >
          {{ t("starterPacks.update.apply") }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>
