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
    :form-label="t('alertStarter.shell.useForm')"
    :label="t('alertStarter.shell.starterLabel')"
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
        @back="reviewing = false"
        @done="onBulkDone"
      />
      <AlertLibraryPane
        v-show="!reviewing"
        ref="libraryRef"
        v-model:selected="selected"
        v-model:scope="scope"
        :alert-type="alertType"
        @opened="open = false"
      />
    </template>

    <template #pane-ai>
      <AlertAiPane v-model:prompt="aiPrompt" />
    </template>

    <template #footer-end="{ pane }">
      <OTooltip v-if="pane === 'ai'" :content="t('alertStarter.ai.draftUnavailable')">
        <span class="inline-flex">
          <OButton
            variant="primary"
            size="sm"
            icon-left="auto-awesome"
            disabled
            data-test="alert-starter-ai-draft"
            >{{ t("alertStarter.ai.draft") }}</OButton
          >
        </span>
      </OTooltip>
      <OButton
        v-else-if="selected.length && !reviewing"
        variant="primary"
        size="sm"
        data-test="alert-starter-add-selected"
        @click="review"
        >{{
          t("alertStarter.shell.addSelected", { count: selected.length }, selected.length)
        }}</OButton
      >
    </template>
  </CreateStarter>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import CreateStarter from "@/components/create-starter/CreateStarter.vue";
import type {
  ChoiceAvailability,
  StarterPane,
  StarterScope,
} from "@/components/create-starter/createStarter.types";
import AlertAiPane from "@/components/alerts/starter/AlertAiPane.vue";
import AlertLibraryPane from "@/components/alerts/starter/AlertLibraryPane.vue";
import BulkAddReview from "@/components/alerts/starter/BulkAddReview.vue";
import { useLibraryReadiness } from "@/components/alerts/starter/libraryPaneData";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { menuState } from "@/utils/featureGate";
import { useFeatureNames } from "@/composables/useFeatureLock";
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
  created: [count: number];
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
    count: library.count.value,
    availability: libraryAvailability.value,
  },
  {
    id: "ai",
    label: t("alertStarter.shell.createWithAi"),
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
});

const review = () => {
  reviewEntries.value = libraryRef.value?.entriesById(selected.value) ?? [];
  reviewing.value = true;
};

const onBulkDone = (created: number) => {
  selected.value = [];
  open.value = false;
  emit("created", created);
};

const resume = () => {
  open.value = false;
  emit("open-form");
};

defineExpose({
  /** New alert, `n`, `Shift N` and the empty state: the starter, nothing picked. */
  openStarter: () => starterRef.value?.openStarter(),
});
</script>
