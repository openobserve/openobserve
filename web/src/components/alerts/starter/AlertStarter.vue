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

<!-- New alert's button and its starter: the library, bulk add, and the form; the AI pane joins in phase 2. -->
<template>
  <CreateStarter
    ref="starterRef"
    v-model:open="open"
    kind="alert"
    :panes="panes"
    :form-label="t('alertStarter.shell.useForm')"
    :form-choice-label="t('alertStarter.shell.theForm')"
    :opens-with-label="t('alertStarter.shell.opensWith')"
    @open-form="emit('open-form')"
  >
    <template #default="{ open: isOpen, startsWithForm, toggle, start }">
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
      <OButtonGroup v-else-if="startsWithForm" data-test="alert-starter-split">
        <OButton
          variant="primary"
          size="sm"
          :disabled="disabled"
          :aria-label="newLabel"
          data-test="alert-list-add-alert-btn"
          @click="start"
          >{{ t("alerts.add") }}
          <EditorDraftDot
            v-if="hasDraft"
            :saved-at="draftSavedAt ?? null"
            corner
            :tooltip="false"
            data-test="alert-list-add-alert-draft-dot"
          />
          <OTooltip
            :content="t('alertStarter.shell.splitTooltip')"
            shortcut-id="alertsOpenStarter"
          />
        </OButton>
        <OButton
          variant="primary"
          size="icon-toolbar"
          icon-left="expand-more"
          :disabled="disabled"
          :aria-label="t('alertStarter.shell.otherWays')"
          aria-haspopup="dialog"
          :aria-expanded="isOpen"
          data-test="alert-starter-caret"
          @click="toggle"
        >
          <OTooltip :content="t('alertStarter.shell.otherWays')" shortcut-id="alertsOpenStarter" />
        </OButton>
      </OButtonGroup>
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
        @count="onCount"
        @opened="open = false"
      />
    </template>

    <template #footer-end>
      <OButton
        v-if="selected.length && !reviewing"
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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import CreateStarter from "@/components/create-starter/CreateStarter.vue";
import { useStartPreference } from "@/components/create-starter/useStartPreference";
import type {
  ChoiceAvailability,
  StarterPane,
  StarterScope,
} from "@/components/create-starter/createStarter.types";
import AlertLibraryPane from "@/components/alerts/starter/AlertLibraryPane.vue";
import BulkAddReview from "@/components/alerts/starter/BulkAddReview.vue";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { menuState } from "@/utils/featureGate";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";
import { useI18nTyped } from "@/types/i18n";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

// Last count each library pane reported, so a reopened starter shows it from its first frame.
const reportedCounts = ref<Record<string, number | null>>({});

const props = withDefaults(
  defineProps<{
    alertType?: "scheduled" | "anomaly_detection";
    /** "new" is the list's New alert button; "another-way" is step 1's Start another way. */
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
const pref = useStartPreference("alert");

const open = ref(false);
const starterRef = ref<InstanceType<typeof CreateStarter> | null>(null);
const libraryRef = ref<{ entriesById(ids: string[]): AlertLibraryEntry[] } | null>(null);
const selected = ref<string[]>([]);
const scope = ref<StarterScope>({ kind: "all" });
const reviewing = ref(false);
const reviewEntries = ref<AlertLibraryEntry[]>([]);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const countKey = computed(() => `${org.value}:${props.alertType}`);

// The same gates as the header assistant: edition, licence, then the org's own switch.
const aiAvailability = computed<ChoiceAvailability>(() => {
  const zo = store.state.zoConfig ?? {};
  const access = checkFeatureAccess("aiAssistant", buildFeatureGateContext(zo));
  if (!access.allowed) return access.visible ? "locked" : "hidden";
  const state = menuState(zo.features, "ai_assistant", Boolean(zo.ai_enabled));
  return state === "enabled" ? "on" : state;
});

// Raw split, the same rule AlertSectionTabs hides the Library tab by.
const libraryAvailability = computed<ChoiceAvailability>(() =>
  (store.state.zoConfig?.custom_hide_menus ?? "").split(",").includes("alertLibrary")
    ? "hidden"
    : "on",
);

const panes = computed<StarterPane[]>(() => [
  {
    id: "ai",
    label: t("alertStarter.shell.createWithAi"),
    count: null,
    availability: aiAvailability.value,
  },
  {
    id: "library",
    label: t("alertStarter.shell.library"),
    count: reportedCounts.value[countKey.value] ?? null,
    availability: libraryAvailability.value,
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

// A pane reports null while it loads; that must not blank the count kept from the last open.
let countedThisOpen = false;
watch(open, (now) => {
  if (now) countedThisOpen = false;
  else reviewing.value = false;
});
const onCount = (n: number | null) => {
  const kept = reportedCounts.value[countKey.value];
  if (n === null && !countedThisOpen && typeof kept === "number") return;
  if (n !== null) countedThisOpen = true;
  reportedCounts.value = { ...reportedCounts.value, [countKey.value]: n };
};

const review = () => {
  reviewEntries.value = libraryRef.value?.entriesById(selected.value) ?? [];
  reviewing.value = true;
};

const onBulkDone = (created: number) => {
  pref.recordUse("library");
  selected.value = [];
  open.value = false;
  emit("created", created);
};

const resume = () => {
  open.value = false;
  emit("open-form");
};

defineExpose({
  /** `n` and the empty state: honours the stored default. */
  start: () => starterRef.value?.start(),
  /** The caret and Shift N: always the starter. */
  openStarter: () => starterRef.value?.openStarter(),
});
</script>
