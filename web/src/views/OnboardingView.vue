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

<!-- Cloud onboarding: a focus-mode page (route meta `focusMode`), so the app header shows with no side menu. -->
<template>
  <div class="bg-surface-base flex h-full min-h-0 flex-col" data-test="onboarding-view">
    <!-- The page never scrolls sideways; a step that needs to scrolls inside itself. -->
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <OnboardingStepChoose
        v-if="resolved.step === 'choose'"
        :choices="choices"
        :can-invite="canInvite"
        @pick="pick"
        @leave="leave"
        @agent="goTo(['agent'])"
        @invite="inviteOpen = true"
      />
      <OnboardingStepRows
        v-else-if="resolved.step === 'rows'"
        :choice="resolved.choice"
        @open="open"
        @back="goTo([])"
        @agent="goTo(['agent'])"
      />
      <OnboardingStepWhich
        v-else-if="resolved.step === 'which'"
        :choices="choices"
        :choice="resolved.choice"
        :row="resolved.row"
        @open="open"
        @back="goTo([resolved.choice.id])"
        @agent="goTo(['agent'])"
      />
      <OnboardingStepTraces
        v-else-if="resolved.step === 'traces'"
        :choice="resolved.choice"
        :row="resolved.row"
        :traces="resolved.traces"
        :picked="tracePresets"
        @pick="openTraced"
        @back="goTo([resolved.choice.id])"
      />
      <OnboardingStepGuide
        v-else-if="resolved.step === 'guide'"
        :key="segments.join('/')"
        :choice="resolved.choice"
        :row="resolved.row"
        :guide="resolved.guide"
        :can-invite="canInvite"
        @back="guideBack"
        @invite="inviteOpen = true"
        @agent="goTo(['agent'])"
      />
      <OnboardingAgentSetup v-else-if="resolved.step === 'agent'" @back="agentBack" />
    </div>

    <InviteMembersDialog v-if="canInvite" v-model:open="inviteOpen" @invite-sent="invited" />
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { useIsOrgAdmin } from "@/components/ai-assistant/share/useChatShareDialog";
import InviteMembersDialog from "@/components/iam/users/InviteMembersDialog.vue";
import {
  SETUP_CARD_ONBOARDING,
  type SetupCardPresets,
} from "@/components/ingestion/setupCard/types";
import OnboardingAgentSetup from "@/components/onboarding/OnboardingAgentSetup.vue";
import OnboardingStepChoose from "@/components/onboarding/OnboardingStepChoose.vue";
import OnboardingStepRows from "@/components/onboarding/OnboardingStepRows.vue";
import OnboardingStepWhich from "@/components/onboarding/OnboardingStepWhich.vue";
import OnboardingStepGuide from "@/components/onboarding/OnboardingStepGuide.vue";
import OnboardingStepTraces from "@/components/onboarding/OnboardingStepTraces.vue";
import {
  buildChoices,
  cardGuidePath,
  guidePath,
  readTraces,
  resolvePath,
  tracesQuery,
  type OnboardingChoiceId,
  type OnboardingGuide,
  type OnboardingRow,
} from "@/components/onboarding/onboardingChoices";
import {
  ONBOARDING_SKIP,
  recordStartBounded,
  startPending,
  suppressConnectPrompt,
} from "@/components/onboarding/onboardingFlow";
import type { FirstSourceId } from "@/components/login/firstSourceOptions";
import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import analytics from "@/services/product_analytics";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// The app header can take the user out too (logo, org menu). recordStart runs once, so after Skip or a pick this does nothing.
onBeforeRouteLeave((to) => {
  if (to.name !== "onboarding") void recordStartBounded(org.value, email.value, undefined, true);
});

const orgQuery = computed(() => ({ org_identifier: store.state.selectedOrganization?.identifier }));

// Read before any step records the start: a user who came back from inside the app is not skipping sign-up.
const fromFirstLogin = startPending(store.state.userInfo?.email);

// Built in a computed so the copy follows a locale change.
const choices = computed(() =>
  buildChoices(t, { profiling: store.state.zoConfig?.profiling_enabled === true }),
);

const segments = computed(() => {
  const path = route.params.path;
  return Array.isArray(path) ? path : path ? [path] : [];
});
const resolved = computed(() => resolvePath(choices.value, segments.value));

// A guide's tracing answer (from the traces step) lives in the URL query, so Back and a reload
// keep it. Every guide's setup card gets it; the Kubernetes card shows only the chosen tracing.
const tracePresets = computed(() => readTraces(route.query));
provide(SETUP_CARD_ONBOARDING, tracePresets);

watch(
  resolved,
  (step) => {
    if (step.step === "redirect") {
      router.replace({ name: "onboarding", params: { path: step.path }, query: orgQuery.value });
    } else if (step.step === "guide") {
      // Every guide renders here. Arriving by URL records nothing.
      suppressConnectPrompt(store.state.userInfo?.email);
    } else if (step.step === "agent") {
      // Every way in (step 1, a guide, a row, a data page's intro) lands here, so the start is recorded here.
      suppressConnectPrompt(store.state.userInfo?.email);
      void recordStartBounded(
        store.state.selectedOrganization?.identifier ?? "",
        store.state.userInfo?.email,
        undefined,
        false,
      );
    }
  },
  { immediate: true },
);

// A guide and the coding agent page wait for data on the page itself.
const watchingForData = computed(
  () => resolved.value.step === "agent" || resolved.value.step === "guide",
);

const email = computed<string | undefined>(() => store.state.userInfo?.email);
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

// The store flag is unreliable (an org with only synthetic checks sets it), so read the stream
// lists; internal and synthetic streams do not count as data.
const { hasUserData } = useOrgHasUserData(org);
watch(
  hasUserData,
  (has) => {
    if (has === true) store.dispatch("setIsDataIngested", true);
  },
  { immediate: true },
);

// Onboarding is for orgs with no data yet; the answer can arrive after the page opens.
// A page that waits for data stays, so its first record shows the success panel instead of bouncing Home.
watch(
  [hasUserData, watchingForData],
  ([has, watching]) => {
    if (has === true && !watching) router.replace({ name: "home", query: orgQuery.value });
  },
  { immediate: true },
);

// Only admins and root can invite: the server's per-org flag, else the member list as a fallback.
const canInvite = useIsOrgAdmin(org, ref(true));
const inviteOpen = ref(false);
const invited = () => recordStartBounded(org.value, email.value, undefined, false);

const goTo = (path: string[], query: Record<string, string> = {}) =>
  router.push({ name: "onboarding", params: { path }, query: { ...orgQuery.value, ...query } });

const pick = (id: OnboardingChoiceId) => goTo([id]);

// The agent page opens from step 1, a guide or a data page's intro, so Back returns there;
// a page opened directly goes to step 1.
const agentBack = () => (router.options.history.state.back ? router.back() : goTo([]));

// The one place a guide opens: record the start, mute the connect popup, then go.
// A guide opens at `path`, inside onboarding, so nothing waits on the record.
const launch = async (
  id: string,
  route: string,
  firstSource: FirstSourceId | undefined,
  choice?: OnboardingChoiceId,
  path?: string[],
  query?: Record<string, string>,
) => {
  analytics.track("onboarding_guide_opened", {
    choice,
    row: id,
    route,
  });
  suppressConnectPrompt(email.value);
  if (path) {
    void recordStartBounded(org.value, email.value, firstSource, false);
    goTo(path, query);
    return;
  }
  await recordStartBounded(org.value, email.value, firstSource, false);
  router.push({ name: route, query: orgQuery.value });
};

const open = ({
  row,
  guide,
  choice,
}: {
  row: OnboardingRow;
  guide?: OnboardingGuide;
  choice?: OnboardingChoiceId;
}) => {
  const route = guide?.route ?? row.route;
  const step = resolved.value;
  const choiceId = choice ?? ("choice" in step ? step.choice.id : undefined);
  // A row that asks about traces opens that step; the guide opens from its answer.
  if (row.traces && choiceId) {
    goTo([choiceId, row.id, "traces"]);
    return;
  }
  const path = choiceId ? guidePath(choiceId, row, guide) : undefined;
  if (route) launch(row.id, route, guide ? guide.firstSource : row.firstSource, choiceId, path);
  else if (choiceId) goTo([choiceId, row.id]);
};

// The traces step's answer opens the guide, with the answer in its URL.
const openTraced = (answer: SetupCardPresets) => {
  const at = resolved.value;
  if (at.step !== "traces" || !at.row.route) return;
  analytics.track("onboarding_trace_choice", {
    traces: answer.traces,
    languages: answer.languages,
  });
  const path = [at.choice.id, at.row.id];
  launch(at.row.id, at.row.route, at.row.firstSource, at.choice.id, path, tracesQuery(answer));
};

// A guide whose row asks about traces goes back to that step, which shows the answer again.
const guideBack = () => {
  const at = resolved.value;
  if (at.step !== "guide") return;
  if (at.row.traces) goTo([at.choice.id, at.row.id, "traces"], tracesQuery(tracePresets.value));
  else goTo(at.row.route ? [at.choice.id] : [at.choice.id, at.row.id]);
};

// Every exit records the start; only a data-source pick ("Not sure?") also pins a first source.
const leave = async ({
  id,
  route,
  firstSource,
}: {
  id: string;
  route: string;
  firstSource?: FirstSourceId;
}) => {
  if (firstSource) launch(id, route, firstSource, undefined, cardGuidePath(choices.value, route));
  else {
    await recordStartBounded(org.value, email.value, undefined, false);
    router.push({ name: route, query: orgQuery.value });
  }
};

const skip = async () => {
  analytics.track(fromFirstLogin ? "onboarding_skipped" : "onboarding_left", {
    step: resolved.value.step,
  });
  try {
    await recordStartBounded(org.value, email.value, undefined, true);
  } finally {
    router.push({ name: "home", query: orgQuery.value });
  }
};
provide(ONBOARDING_SKIP, skip);
</script>
