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
  <ODropdown v-if="shown" v-bind="$attrs" side="bottom" align="end">
    <template #trigger>
      <!-- a phone header hides labelled buttons, so the menu keeps an icon-only trigger there -->
      <OButton
        v-if="isMobile"
        variant="ghost"
        size="icon-toolbar"
        class="text-ingest-accent-purple!"
        :aria-label="t('sampleData.header.label')"
        data-test="header-sample-data-btn"
      >
        <OIcon name="science" size="sm" class="size-5!" />
      </OButton>
      <OButton
        v-else
        variant="outline"
        size="xs"
        class="bg-ingest-tint-purple! text-ingest-accent-purple! border-ingest-accent-purple/40! hover:border-ingest-accent-purple!"
        data-test="header-sample-data-btn"
      >
        <template #icon-left>
          <OIcon name="science" size="sm" />
        </template>
        {{ t("sampleData.header.label") }}
        <span
          aria-hidden="true"
          class="bg-ingest-accent-purple size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
        />
      </OButton>
    </template>
    <div class="min-w-56">
      <ODropdownItem
        v-if="unfinished"
        :disabled="session.removing.value"
        data-test="header-sample-data-finish"
        @select="load"
      >
        {{ t("sampleData.header.finish") }}
      </ODropdownItem>
      <ODropdownItem data-test="header-sample-data-tour" @select="startTour">
        {{ t("sampleData.welcome.ready.startTour") }}
      </ODropdownItem>
      <ODropdownSeparator />
      <ODropdownItem
        variant="destructive"
        :disabled="session.removing.value"
        data-test="header-sample-data-delete"
        @select="askRemove"
      >
        {{ t("sampleData.delete") }}
      </ODropdownItem>
    </div>
  </ODropdown>
  <OButton
    v-else-if="offerTry"
    v-bind="$attrs"
    variant="outline"
    size="xs"
    class="bg-ingest-tint-purple! text-ingest-accent-purple! border-ingest-accent-purple/40! hover:border-ingest-accent-purple! max-md:hidden"
    :disabled="session.removing.value"
    data-test="header-sample-data-try"
    @click="load"
  >
    <template #icon-left>
      <OIcon name="science" size="sm" />
    </template>
    {{ t("sampleData.header.try") }}
  </OButton>

  <ConfirmDialog
    v-model="confirmRemove"
    :title="t('sampleData.removeConfirm.title')"
    :message="t('sampleData.removeConfirm.message')"
    :ok-label="t('sampleData.delete')"
    ok-variant="destructive"
    focus-cancel
    data-test="header-sample-data-delete-dialog"
    @update:ok="removeAll"
    @update:cancel="confirmRemove = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useI18nTyped } from "@/types/i18n";
import { useSampleDataPresence } from "@/composables/sampleData/useSampleDataPresence";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { sampleDataStateQuery } from "@/services/sample_data.queries";
import { sampleDataFlowOn } from "@/utils/firstRunFlow";
import useBreakpoint from "@/composables/useBreakpoint";

// the menu and its confirm dialog are siblings, so the header's class goes to the menu
defineOptions({ inheritAttrs: false });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const session = useSampleDataSession();
const { isMobile } = useBreakpoint();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const presence = useSampleDataPresence(org);
const shown = computed(() => presence.hasSample.value && !store.state.kioskMode);
const state = useQuery(
  computed(() => Object.assign(sampleDataStateQuery(org.value), { enabled: shown.value })),
);
// the window is saved after the telemetry, so a load stopped by a reload or closed tab has none
const unfinished = computed(
  () => state.data.value?.status === "none" && session.status.value !== "loading",
);
// an empty org gets the way in; once it holds data of its own the header stays clear
const offerTry = computed(
  () =>
    sampleDataFlowOn(store.state.zoConfig) &&
    presence.ready.value &&
    !presence.hasRealData.value &&
    !store.state.kioskMode &&
    // one load runs at a time, so a click during another org's load would be dropped
    session.status.value !== "loading",
);
const confirmRemove = ref(false);
// the confirmation belongs to the org that opened it, so an org switch closes it
let removeOrg = "";
const askRemove = () => {
  removeOrg = org.value;
  confirmRemove.value = true;
};
watch(org, () => (confirmRemove.value = false));

const startTour = () => session.startTourAndShow(org.value, () => org.value, router);
// the assets of an earlier run are reused, so this also finishes a stopped load
const load = () => session.loadInDialog(org.value, store.state.zoConfig?.ingest_allowed_upto);

const removeAll = () => {
  confirmRemove.value = false;
  void session.removeInDialog(removeOrg);
};
</script>
