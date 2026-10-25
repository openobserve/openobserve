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
    :title="t('alerts.startSheet.title')"
    :sub-title="t('alerts.startSheet.subtitle')"
    data-test="alert-start-sheet"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-5">
      <OBanner
        v-if="hasData === false"
        variant="info"
        :content="t('alerts.startSheet.noData')"
        data-test="alert-start-sheet-no-data"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="alert-start-sheet-ingest"
            @click="goToIngestion"
            >{{ t("alerts.startSheet.ingestData") }}</OButton
          >
        </template>
      </OBanner>

      <section v-if="loading || suggestions.length" class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-medium">
          {{ t("alerts.startSheet.suggestedHeading") }}
        </h3>
        <div v-if="loading" class="flex gap-3">
          <OSkeleton v-for="n in 3" :key="n" class="h-16 flex-1" />
        </div>
        <div v-else class="flex flex-wrap gap-3">
          <AlertSuggestionCard
            v-for="suggestion in suggestions"
            :key="suggestion.key"
            :suggestion="suggestion"
            @choose="choose"
          />
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-medium">
          {{ t("alerts.startSheet.intentsHeading") }}
        </h3>
        <div v-if="loading" class="flex flex-wrap gap-3">
          <OSkeleton v-for="n in 6" :key="n" class="h-12 basis-56" />
        </div>
        <div v-else class="flex flex-wrap gap-3">
          <EmptyStateActionCard
            v-for="choice in choices"
            :key="choice.intent.id"
            size="compact"
            :icon="INTENT_ICONS[choice.intent.id]"
            :label="t(choice.intent.titleKey)"
            :sublabel="intentSublabel(choice)"
            :unavailable="!choice.prefill"
            :data-test="`alert-start-sheet-intent-${choice.intent.id}`"
            @click="choice.prefill && choose(choice.prefill)"
          />
        </div>
      </section>

      <section
        v-if="!libraryHidden"
        class="flex flex-col gap-2"
        data-test="alert-start-sheet-library"
      >
        <h3 class="text-text-heading text-sm font-medium">
          {{ t("alerts.startSheet.libraryHeading") }}
        </h3>
        <OSearchInput
          v-model="librarySearch"
          :placeholder="t('alerts.startSheet.librarySearchPlaceholder')"
          :debounce="200"
          data-test="alert-start-sheet-library-search"
        />
        <p
          v-if="libraryFailed"
          class="text-text-secondary text-xs"
          data-test="alert-start-sheet-library-failed"
        >
          {{ t("alerts.startSheet.libraryFailed") }}
        </p>
        <div v-else-if="searchTerms.length" class="flex flex-wrap gap-3">
          <EmptyStateActionCard
            v-for="entry in libraryMatches"
            :key="entry.id"
            size="compact"
            icon="menu-book"
            :label="entry.title"
            :sublabel="entry.description"
            data-test="alert-start-sheet-library-result"
            @click="chooseLibraryEntry(entry)"
          />
          <p
            v-if="manifest && !libraryMatches.length"
            class="text-text-secondary text-xs"
            data-test="alert-start-sheet-library-empty"
          >
            {{ t("alerts.startSheet.libraryNoMatch") }}
          </p>
        </div>
        <div>
          <OButton
            variant="ghost-primary"
            size="sm"
            data-test="alert-start-sheet-library-browse"
            @click="browseLibrary"
            >{{ t("alerts.startSheet.libraryBrowse") }}</OButton
          >
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-text-heading text-sm font-medium">
          {{ t("alerts.startSheet.otherHeading") }}
        </h3>
        <div class="flex flex-wrap gap-3">
          <EmptyStateActionCard
            size="compact"
            icon="upload-file"
            :label="t('alerts.startSheet.import')"
            :sublabel="t('alerts.startSheet.importDesc')"
            data-test="alert-start-sheet-import"
            @click="emit('import')"
          />
          <EmptyStateActionCard
            size="compact"
            icon="add"
            :label="t('alerts.startSheet.blank')"
            :sublabel="t('alerts.startSheet.blankDesc')"
            data-test="alert-start-sheet-blank"
            @click="emit('blank')"
          />
        </div>
      </section>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import AlertSuggestionCard from "@/components/alerts/AlertSuggestionCard.vue";
import { useAlertSuggestions } from "@/composables/alerts/useAlertSuggestions";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { AlertPrefill, AlertPrefillStreamCandidate } from "@/ts/interfaces/alertPrefill";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import type { IntentId } from "@/utils/alerts/intents";
import { matchesSearchWords, searchWords } from "@/utils/alerts/librarySearch";
import { buildPrefillFromLibrary } from "@/utils/alerts/prefill/fromLibrary";
import type { IntentChoice } from "@/utils/alerts/startSuggestions";

const props = defineProps<{
  open: boolean;
  initialStream?: AlertPrefillStreamCandidate;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  choose: [prefill: AlertPrefill];
  import: [];
  blank: [];
}>();

const INTENT_ICONS: Record<IntentId, IconName> = {
  errors_increase: "error-outline",
  requests_get_slow: "speed",
  data_stops_arriving: "hourglass-empty",
  message_appears: "manage-search",
  metric_crosses_limit: "show-chart",
  something_unusual: "auto-awesome",
};
const LIBRARY_RESULT_LIMIT = 5;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { loading, hasData, choices, suggestions, load } = useAlertSuggestions(
  () => props.initialStream,
);
const { manifest, loadManifest, loadAlertFile } = useAlertLibrary();

const librarySearch = ref("");
const libraryFailed = ref(false);

// Raw split, as AlertSectionTabs reads the same flag.
const libraryHidden = computed(() =>
  (store.state.zoConfig?.custom_hide_menus ?? "").split(",").includes("alertLibrary"),
);
const searchTerms = computed(() => searchWords(librarySearch.value));
const libraryMatches = computed<AlertLibraryEntry[]>(() =>
  (manifest.value?.alerts ?? [])
    .filter((entry: AlertLibraryEntry) => matchesSearchWords(entry, searchTerms.value))
    .slice(0, LIBRARY_RESULT_LIMIT),
);

const intentSublabel = (choice: IntentChoice): I18nText => {
  if (choice.stream) return t("alerts.startSheet.intentOn", { stream: choice.stream.name });
  return hasData.value === false
    ? t("alerts.startSheet.intentNoData")
    : t("alerts.startSheet.intentNoStream");
};

const choose = (prefill: AlertPrefill) => emit("choose", prefill);

const chooseLibraryEntry = async (entry: AlertLibraryEntry) => {
  try {
    const file = await loadAlertFile(entry);
    choose(buildPrefillFromLibrary({ entry, file }));
  } catch {
    toast({ variant: "error", message: t("alerts.startSheet.libraryFailed") });
  }
};

const orgQuery = () => ({ org_identifier: store.state.selectedOrganization?.identifier });

const browseLibrary = () => {
  emit("update:open", false);
  void router.push({
    name: "alertLibrary",
    query: { ...orgQuery(), ...(librarySearch.value.trim() ? { q: librarySearch.value } : {}) },
  });
};

const goToIngestion = () => {
  emit("update:open", false);
  void router.push({ name: "ingestion", query: orgQuery() });
};

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    librarySearch.value = "";
    void load();
  },
  { immediate: true },
);

watch(searchTerms, (terms) => {
  if (!terms.length || manifest.value || libraryHidden.value) return;
  libraryFailed.value = false;
  loadManifest().catch(() => {
    libraryFailed.value = true;
  });
});
</script>
