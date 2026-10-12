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
  <ODrawer
    :open="open"
    size="md"
    :title="t('autoobserve2.settingsDrawer.title')"
    data-test="autoobserve2-settings-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #header-right>
      <span
        class="text-status-success-text flex items-center gap-1 text-xs transition-opacity duration-500"
        :class="saved ? 'opacity-100' : 'opacity-0'"
        :aria-hidden="!saved"
        data-test="autoobserve2-settings-saved"
      >
        <OIcon name="check" size="xs" />
        {{ t("autoobserve2.settingsDrawer.saved") }}
      </span>
    </template>
    <div class="flex flex-col gap-8 pb-8">
      <DrawerSection
        :title="t('autoobserve2.settingsDrawer.reach')"
        data-test="autoobserve2-settings-reach"
      >
        <OCheckbox
          v-for="dest in destinations"
          :key="dest.id"
          v-model="reach[dest.id]"
          :label="dest.label"
          :data-test="`autoobserve2-settings-dest-${dest.id}`"
        />
        <p
          v-if="!Object.values(reach).some(Boolean)"
          class="text-status-warning-text flex items-center gap-1.5 text-sm"
          data-test="autoobserve2-settings-no-destination"
        >
          <OIcon name="warning-amber" size="sm" />
          {{ t("autoobserve2.settingsDrawer.noDestination") }}
        </p>
      </DrawerSection>

      <DrawerSection
        :title="t('autoobserve2.settingsDrawer.routing')"
        data-test="autoobserve2-settings-routing"
      >
        <p class="text-text-secondary text-sm leading-relaxed">
          {{ t("autoobserve2.settingsDrawer.routingNote") }}
        </p>
      </DrawerSection>

      <DrawerSection
        :title="t('autoobserve2.settingsDrawer.autonomy')"
        data-test="autoobserve2-settings-autonomy"
      >
        <ORadioGroup v-model="autonomy">
          <ORadio
            v-for="mode in MODES"
            :key="mode"
            :value="mode"
            :label="t(MODE_LABEL[mode])"
            :data-test="`autoobserve2-settings-autonomy-${mode}`"
          />
        </ORadioGroup>
        <p class="text-text-secondary text-sm leading-relaxed">{{ t(MODE_HINT[autonomy]) }}</p>
      </DrawerSection>

      <div class="flex flex-col gap-6" data-test="autoobserve2-settings-advanced">
        <OButton
          variant="ghost-primary"
          size="sm"
          class="self-start"
          :icon-right="advancedOpen ? 'expand-less' : 'expand-more'"
          :aria-expanded="advancedOpen"
          data-test="autoobserve2-settings-advanced-toggle"
          @click="advancedOpen = !advancedOpen"
        >
          {{ t("autoobserve2.settingsDrawer.advanced") }}
        </OButton>
        <div v-if="advancedOpen" class="flex flex-col gap-8">
          <DrawerSection :title="t('autoobserve2.settingsDrawer.perKind')">
            <div
              v-for="kind in kinds"
              :key="kind.id"
              class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
              :data-test="`autoobserve2-settings-kind-${kind.id}`"
            >
              <div class="flex min-w-0 flex-1 basis-48 flex-col">
                <span class="text-text-heading text-sm">{{ t(kind.name) }}</span>
                <span class="text-text-secondary text-xs">
                  {{ say(t, kind.record) }}
                </span>
              </div>
              <OSelect
                v-model="autonomyModes[kind.id]"
                :options="kindOptions(kind)"
                size="sm"
                width="sm"
              />
            </div>
          </DrawerSection>

          <DrawerSection :title="t('autoobserve2.settingsDrawer.digestDay')">
            <OSelect v-model="digestDay" :options="dayOptions" />
          </DrawerSection>
          <DrawerSection :title="t('autoobserve2.settingsDrawer.excluded')">
            <OSelect
              v-model="excluded"
              :placeholder="t('autoobserve2.settingsDrawer.excludedNone')"
              :options="serviceOptions"
              multiple
              searchable
            />
          </DrawerSection>
        </div>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import DrawerSection from "./DrawerSection.vue";
import { useAutonomy, useCompletedFixes } from "./useDecisions";
import { DEFAULT_AUTONOMY } from "../data/facts";
import {
  ALL_SERVICES,
  DESTINATION_OPTIONS,
  settingsKinds,
  say,
  type Autonomy,
  type SettingsKind,
} from "./fixtures";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();

const MODES: Autonomy[] = ["tell", "ask", "fix"];

const MODE_LABEL: Record<Autonomy, I18nKey> = {
  tell: "autoobserve2.settingsDrawer.tell",
  ask: "autoobserve2.settingsDrawer.ask",
  fix: "autoobserve2.settingsDrawer.fix",
};

const MODE_HINT: Record<Autonomy, I18nKey> = {
  tell: "autoobserve2.settingsDrawer.tellHint",
  ask: "autoobserve2.settingsDrawer.askHint",
  fix: "autoobserve2.settingsDrawer.fixHint",
};

const destinations = computed(() =>
  DESTINATION_OPTIONS.map((d) => ({ id: d.id, label: say(t, d.label) })),
);

const reach = reactive<Record<string, boolean>>(
  Object.fromEntries(DESTINATION_OPTIONS.map((d) => [d.id, true])),
);

const autonomy = ref<Autonomy>(DEFAULT_AUTONOMY);

const completedFixes = useCompletedFixes();
const kinds = computed(() => settingsKinds(completedFixes.value));
const autonomyModes = useAutonomy();

const kindOptions = (kind: SettingsKind) =>
  MODES.map((mode) => ({
    value: mode,
    label: t(MODE_LABEL[mode]),
    disabled: mode === "fix" && (!kind.hasRecord || kind.locked),
  }));

const digestDay = ref("friday");
const dayOptions = computed(() =>
  (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((day) => ({
    value: day,
    label: t(`autoobserve2.settingsDrawer.weekdays.${day}`),
  })),
);

const excluded = ref<string[]>([]);
const serviceOptions = ALL_SERVICES.map((name) => ({ value: name, label: raw(name) }));

const SAVED_MS = 2000;

const advancedOpen = ref(false);
const saved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  [reach, autonomy, autonomyModes, digestDay, excluded],
  () => {
    saved.value = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved.value = false), SAVED_MS);
  },
  { deep: true },
);

onBeforeUnmount(() => clearTimeout(savedTimer));
</script>
