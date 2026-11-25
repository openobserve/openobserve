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

<!-- New alert's button and its starter: the library, the AI pane, and the form. -->
<template>
  <CreateStarter
    ref="starterRef"
    v-model:open="open"
    :panes="panes"
    :form-label="t('alertStarter.shell.formName')"
    :form-description="t('alertStarter.shell.formDescription')"
    :title="t('alertStarter.shell.dialogTitle')"
    @open-form="emit('open-form')"
  >
    <template #default="{ open: isOpen, toggle }">
      <OButton
        v-if="trigger === 'another-way'"
        variant="outline"
        size="sm"
        icon-left="swap-horiz"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        data-test="alert-starter-another-way"
        @click="toggle"
        >{{ t("alertStarter.shell.anotherWay") }}</OButton
      >
      <OButton
        v-else
        variant="primary"
        size="sm"
        :disabled="disabled"
        :aria-label="newLabel"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        data-test="alert-list-add-alert-btn"
        @click="toggle"
        >{{ t("alerts.add") }}
        <EditorDraftDot
          v-if="hasDraft"
          :saved-at="draftSavedAt ?? null"
          corner
          data-test="alert-list-add-alert-draft-dot"
        />
      </OButton>
    </template>

    <template v-if="hasDraft && trigger === 'new'" #resume>
      <p
        class="text-text-secondary m-0 flex flex-wrap items-center gap-x-2 text-sm"
        data-test="alert-starter-resume-line"
      >
        <span>{{ draftLine }}</span>
        <OButton variant="link" size="xs" data-test="alert-starter-resume" @click="resume">{{
          t("alertStarter.shell.resume")
        }}</OButton>
      </p>
    </template>

    <template #pane-library>
      <BulkAddReview
        v-if="reviewing"
        :entries="reviewEntries"
        :scope="scope"
        :actions-to="reviewActions"
        @back="reviewing = false"
        @done="onBulkDone"
      />
      <AlertLibraryPane
        v-show="!reviewing"
        ref="libraryRef"
        v-model:selected="selected"
        v-model:scope="scope"
        :alert-type="alertType"
        :note-to="reviewing ? null : libraryNote"
        @opened="open = false"
      />
    </template>

    <template #pane-ai>
      <AlertAiPane v-model:prompt="aiPrompt" :controller="aiDraft" @opened="open = false" />
    </template>

    <template #footer-end="{ pane }">
      <AlertAiActions
        v-if="pane === 'ai'"
        :controller="aiDraft"
        :prompt="aiPrompt"
        @created="onAiCreated"
        @opened="open = false"
      />
      <template v-else>
        <div ref="libraryNote" class="contents" />
        <div v-if="reviewing" ref="reviewActions" class="contents" />
        <OButton
          v-else-if="selected.length"
          variant="primary"
          size="sm"
          data-test="alert-starter-add-selected"
          @click="review"
          >{{
            t("alertStarter.shell.addSelected", { count: selected.length }, selected.length)
          }}</OButton
        >
      </template>
    </template>
  </CreateStarter>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import CreateStarter from "@/components/create-starter/CreateStarter.vue";
import type {
  ChoiceAvailability,
  StarterPane,
  StarterScope,
} from "@/components/create-starter/createStarter.types";
import AlertAiActions from "@/components/alerts/starter/AlertAiActions.vue";
import AlertAiPane from "@/components/alerts/starter/AlertAiPane.vue";
import AlertLibraryPane from "@/components/alerts/starter/AlertLibraryPane.vue";
import BulkAddReview from "@/components/alerts/starter/BulkAddReview.vue";
import { useLibraryReadiness } from "@/components/alerts/starter/libraryPaneData";
import { useAlertAiDraft } from "@/components/alerts/starter/useAlertAiDraft";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { menuState } from "@/utils/featureGate";
import { useFeatureNames } from "@/composables/useFeatureLock";
import { markJustAdded, type JustAddedAlerts } from "@/utils/alerts/justAddedAlerts";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";
import { useI18nTyped } from "@/types/i18n";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

const props = withDefaults(
  defineProps<{
    alertType?: "scheduled" | "anomaly_detection";
    /** "new" is the list's New alert button; "another-way" is the new-alert form header's Start another way. */
    trigger?: "new" | "another-way";
    disabled?: boolean;
    /** An unsaved new alert waits in this browser. */
    hasDraft?: boolean;
    draftSavedAt?: number | null;
  }>(),
  {
    alertType: "scheduled",
    trigger: "new",
    disabled: false,
    hasDraft: false,
    draftSavedAt: null,
  },
);

const emit = defineEmits<{
  /** Open the empty form (or the waiting draft); the host owns the route. */
  "open-form": [];
  /** Alerts were created and wait in `justAddedAlerts` for the list to mark them. */
  created: [];
}>();

const store = useStore();
const { t, locale } = useI18nTyped();
const { featureName } = useFeatureNames();

const open = ref(false);
const starterRef = ref<InstanceType<typeof CreateStarter> | null>(null);
const libraryRef = ref<{ entriesById(ids: string[]): AlertLibraryEntry[] } | null>(null);
const selected = ref<string[]>([]);
const scope = ref<StarterScope>({ kind: "all" });
const reviewing = ref(false);
const reviewEntries = ref<AlertLibraryEntry[]>([]);
const aiPrompt = ref("");
// The bulk review's actions render here, in the panel's footer.
const reviewActions = ref<HTMLElement | null>(null);
const libraryNote = ref<HTMLElement | null>(null);

const router = useRouter();
// The alert lands in the folder on screen, as the form's own Save does.
const aiDraft = useAlertAiDraft(() => String(router?.currentRoute.value.query.folder ?? "default"));

// Read before the starter opens, so the Library count is there from its first frame.
const library = useLibraryReadiness(() => props.alertType);
onMounted(() => library.load());

// The same gates as the header assistant: edition, licence, then the org's own switch.
const aiAccess = computed(() =>
  checkFeatureAccess("aiAssistant", buildFeatureGateContext(store.state.zoConfig ?? {})),
);
const aiAvailability = computed<ChoiceAvailability>(() => {
  const zo = store.state.zoConfig ?? {};
  if (!aiAccess.value.allowed) return aiAccess.value.visible ? "locked" : "hidden";
  const state = menuState(zo.features, "ai_assistant", Boolean(zo.ai_enabled));
  return state === "enabled" ? "on" : state;
});
const aiLockedReason = computed(() =>
  aiAccess.value.allowed
    ? t("featureLock.headerLocked", {
        feature: featureName("ai_assistant") ?? t("featureLock.thisFeature"),
      })
    : t("featureLock.availableInEnterprise", { feature: t("menu.aiAssistant") }),
);

// Raw split, the same rule AlertSectionTabs hides the Library tab by.
const libraryAvailability = computed<ChoiceAvailability>(() =>
  (store.state.zoConfig?.custom_hide_menus ?? "").split(",").includes("alertLibrary")
    ? "hidden"
    : "on",
);

const panes = computed<StarterPane[]>(() => [
  {
    id: "library",
    label: t("alertStarter.shell.library"),
    description: t("alertStarter.shell.libraryDescription"),
    count: library.count.value,
    availability: libraryAvailability.value,
  },
  {
    id: "ai",
    label: t("alertStarter.shell.createWithAi"),
    description: t("alertStarter.shell.aiDescription"),
    count: null,
    availability: aiAvailability.value,
    lockedReason: aiLockedReason.value,
  },
]);

const newLabel = computed(() =>
  props.hasDraft ? t("common.editorDraft.newDot", { label: t("alerts.add") }) : undefined,
);

const draftLine = computed(() =>
  props.draftSavedAt == null
    ? t("alertStarter.shell.draftWaiting")
    : t("alertStarter.shell.draftWaitingSince", {
        date: formatEditorDraftTime(
          props.draftSavedAt,
          locale.value,
          store.state.timezone || undefined,
        ),
      }),
);

watch(open, (now) => {
  if (now) {
    library.load();
    return;
  }
  reviewing.value = false;
  aiPrompt.value = "";
  aiDraft.ai.reset();
});

const review = () => {
  reviewEntries.value = libraryRef.value?.entriesById(selected.value) ?? [];
  reviewing.value = true;
};

const onCreated = (added: JustAddedAlerts) => {
  markJustAdded(added);
  open.value = false;
  emit("created");
};

const onBulkDone = (added: JustAddedAlerts) => {
  selected.value = [];
  onCreated(added);
};

const onAiCreated = (name: string) => onCreated({ folderId: aiDraft.folderId(), names: [name] });

const resume = () => {
  open.value = false;
  emit("open-form");
};

defineExpose({
  /** New alert, `n`, `Shift N` and the empty state: the starter, nothing picked. */
  openStarter: () => starterRef.value?.openStarter(),
});
</script>
