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
    :open="session.welcomeOpen.value"
    size="xl"
    :aria-title="headerTitle"
    :show-close="false"
    data-test="sample-welcome-dialog"
    @update:open="(open) => !open && dismiss()"
  >
    <!-- one fixed height for every step, so the centered dialog never jumps between them -->
    <div class="flex h-[30rem] max-h-[calc(90vh-4rem)] flex-col gap-5" :data-view="view">
      <div class="flex items-center gap-3">
        <span
          v-if="view === 'progress' || view === 'ready'"
          class="rounded-surface flex size-12 shrink-0 items-center justify-center"
          :class="headerTint"
        >
          <OIcon :name="headerIcon" size="md" :class="{ 'animate-spin': view === 'progress' }" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h2 class="text-text-heading m-0 text-2xl" data-test="sample-welcome-title">
              {{ headerTitle }}
            </h2>
            <div
              v-if="askHeard && view === 'choose'"
              class="flex flex-wrap items-center gap-2"
              data-test="onboarding-hear-about-us"
            >
              <label
                for="onboarding-hear-about-us"
                class="text-text-heading text-base font-medium whitespace-nowrap"
                >{{ t("login.getStarted.heard.label") }}</label
              >
              <OSelect
                id="onboarding-hear-about-us"
                v-model="heardFrom"
                :options="heardOptions"
                :aria-label="t('login.getStarted.heard.label')"
                :placeholder="t('login.getStarted.heard.placeholder')"
                size="xs"
                width="sm"
                data-test="onboarding-hear-about-us-select"
              />
              <span
                role="status"
                class="text-status-success-text flex items-center gap-1 text-xs"
                data-test="onboarding-hear-about-us-thanks"
              >
                <template v-if="heardFrom">
                  <OIcon name="check" size="xs" />
                  {{ t("login.getStarted.heard.thanks") }}
                </template>
              </span>
            </div>
          </div>
          <span v-if="view !== 'choose' && headerBody" class="text-text-secondary text-sm">{{
            headerBody
          }}</span>
        </div>
        <OButton
          variant="ghost"
          size="icon-sm"
          class="-me-1 shrink-0"
          :aria-label="t('common.close')"
          data-test="sample-welcome-close"
          @click="dismiss"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>

      <WelcomeChoices
        v-if="view === 'choose'"
        class="min-h-0 flex-1"
        @browse="browseAll"
        @pick="openGuide"
        @sample="pickSample"
        @skip="skip"
      />

      <template v-else-if="view === 'progress' || view === 'ready'">
        <SampleDataProgress class="min-h-0 flex-1" :done="view === 'ready'" />
        <div class="mt-auto flex flex-wrap items-center justify-end gap-2">
          <OButton
            v-if="view === 'progress'"
            variant="outline"
            size="sm"
            data-test="sample-welcome-background"
            @click="close"
          >
            {{ t("sampleData.welcome.continueInBackground") }}
          </OButton>
          <template v-else>
            <OButton variant="outline" size="sm" data-test="sample-welcome-own-way" @click="close">
              {{ t("sampleData.welcome.ready.ownWay") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm"
              data-test="sample-welcome-start-tour"
              @click="startTour"
            >
              {{ t("sampleData.welcome.ready.startTour") }}
            </OButton>
          </template>
        </div>
      </template>

      <template v-else>
        <div
          role="alert"
          class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center"
          data-test="sample-welcome-error"
        >
          <span
            class="rounded-surface bg-icon-chip-error-bg text-icon-chip-error-text flex size-12 items-center justify-center"
          >
            <OIcon name="error" size="md" />
          </span>
          <p v-if="session.forbidden.value" class="text-text-body m-0 max-w-md text-sm">
            {{ t("sampleData.loadForbidden") }}
          </p>
          <p v-else class="text-text-body m-0 max-w-md text-sm">
            {{ t("sampleData.welcome.errorBody") }}
          </p>
          <p
            v-if="session.error.value && !session.forbidden.value"
            class="text-text-secondary m-0 max-w-md text-xs"
          >
            {{ session.error.value }}
          </p>
        </div>
        <div class="mt-auto flex justify-end gap-2">
          <OButton variant="ghost" size="sm" @click="close">{{ t("common.cancel") }}</OButton>
          <OButton
            variant="primary"
            size="sm"
            :disabled="session.removing.value"
            data-test="sample-welcome-retry"
            @click="load"
          >
            {{ t("common.retry") }}
          </OButton>
        </div>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import config from "@/aws-exports";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import WelcomeChoices from "./WelcomeChoices.vue";
import {
  firstSourceOption,
  writeFirstSource,
  type FirstSourceId,
} from "@/components/login/firstSourceOptions";
import { heardFromOptions } from "@/components/login/heardFrom";
import billings from "@/services/billings";
import analytics from "@/services/product_analytics";
import { markSlackInviteOffered } from "@/utils/slackCommunityInvite";
import { isFirstLoginOf, redirectPending } from "@/components/onboarding/onboardingFlow";
import { flowsKnown, sampleDataFlowOn } from "@/utils/firstRunFlow";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useI18nTyped } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { fetchHasUserStreams } from "@/composables/sampleData/useSampleDataPresence";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import SampleDataProgress from "@/components/sampleData/SampleDataProgress.vue";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const view = computed<"choose" | "progress" | "ready" | "error">(() => {
  if (session.loadingOrg.value === org.value) {
    if (session.status.value === "loading") return "progress";
    if (session.status.value === "loaded") return "ready";
    if (session.status.value === "failed") return "error";
  }
  return "choose";
});

const headerIcon = computed<IconName>(() =>
  view.value === "ready" ? "check-circle" : "progress-activity",
);
const headerTint = computed(() => {
  if (view.value === "ready") return "bg-icon-chip-success-bg text-status-success-text";
  return "bg-ingest-tint-purple text-ingest-accent-purple";
});

const headerTitle = computed(() => {
  if (view.value === "progress") return t("sampleData.welcome.progress.title");
  if (view.value === "ready") return t("sampleData.welcome.ready.title");
  if (view.value === "error") return t("sampleData.toast.loadFailed");
  return t("login.getStarted.title");
});
const headerBody = computed(() =>
  view.value === "progress" ? t("sampleData.welcome.progress.body") : undefined,
);

const close = () => {
  if (org.value) session.markWelcomeSeen(org.value);
  session.closeWelcome();
};

const startTourFor = (target: string) => session.startTourAndShow(target, () => org.value, router);

const load = () => session.loadInDialog(org.value, store.state.zoConfig?.ingest_allowed_upto);

const startTour = () => startTourFor(org.value);

const firstLogin = () => isFirstLoginOf(store.state.userInfo?.email);

// the onboarding flow's codes and labels, so one answer is one value in the attribution data
const heardOptions = computed(() => heardFromOptions(t));
const heardFrom = ref<string>();
// cloud only, on a first login: the answer goes to the cloud billing attribution endpoint
const askHeard = ref(false);
watch(
  session.welcomeOpen,
  (open) => {
    if (!open) return;
    heardFrom.value = undefined;
    askHeard.value = config.isCloud === "true" && firstLogin();
  },
  { immediate: true },
);

// Records the answer; telemetry goes out once, for a new cloud user's first login only.
const finish = (firstSource?: FirstSourceId) => {
  const id = org.value;
  if (firstSource) writeFirstSource(id, firstSource);
  const wasFirstLogin = firstLogin();
  try {
    localStorage.removeItem("isFirstTimeLogin");
  } catch {
    // blocked storage must not keep the dialog open
  }
  if (config.isCloud !== "true" || !wasFirstLogin) return;
  const skipped = !firstSource;
  const from = heardFrom.value ?? "";
  // The backend still requires from and company; empty strings are its "no answer".
  billings
    .submit_new_user_info(id, { from, company: "", first_source: firstSource, skipped })
    .catch((error: unknown) => console.warn("SampleDataWelcome: new user info not sent:", error));
  analytics.track("onboarding_get_started_submitted", {
    first_source: firstSource ?? null,
    heard_from: heardFrom.value ?? null,
    skipped,
  });
  if (skipped) analytics.track("onboarding_questions_skipped", { first_source: null });
};

const skip = () => {
  finish();
  close();
};

// only the choices are still unanswered; every later view already picked sample data
const dismiss = () => (view.value === "choose" ? skip() : close());

// picking sample data is the go-ahead, so the load starts without the confirm step
const pickSample = () => {
  if (session.removing.value) return;
  finish("sample");
  load();
};

const openGuide = (id: FirstSourceId) => {
  finish(id);
  const name = redirectPending(route.name as string | undefined)
    ? undefined
    : firstSourceOption(id)?.route;
  close();
  if (name) router.push({ name, query: { org_identifier: org.value } }).catch(() => {});
};

const browseAll = () => {
  finish();
  close();
  if (!redirectPending(route.name as string | undefined)) {
    router.push({ name: "ingestion", query: { org_identifier: org.value } }).catch(() => {});
  }
};

const flowOn = () => sampleDataFlowOn(store.state.zoConfig);

// the switches come only with the full org config; unmounting also ends the wait for it
let configArrived!: () => void;
const fullConfig = new Promise<void>((resolve) => (configArrived = resolve));
watch(
  () => flowsKnown(store.state.zoConfig),
  (known) => known && configArrived(),
  { immediate: true },
);

let greetToken = 0;

const maybeGreet = async () => {
  const token = ++greetToken;
  const id = org.value;
  // a newer check, an org switch, leaving Home or a switch-off makes an answer stale
  const stale = () =>
    token !== greetToken || id !== org.value || route.name !== "home" || !flowOn();
  if (store.state.kioskMode || (flowsKnown(store.state.zoConfig) && !flowOn())) return;
  // a tour left open in another org is hidden here, so only this org's tour holds the welcome back
  if (!id || route.name !== "home" || session.welcomeSeen(id) || session.tour.value?.org === id) {
    return;
  }
  if (session.status.value === "loading") return;
  // the Slack invite waits on this count, so it also covers the wait for the full config
  session.welcomeDeciding.value++;
  try {
    await fullConfig;
    if (stale()) return;
    const hasData = await fetchHasUserStreams(id);
    if (stale()) return;
    // the Slack invite day-2 clock starts on the first Home visit, data or not
    if (config.isCloud === "true") {
      markSlackInviteOffered(store.state.userInfo?.email ?? "anonymous");
    }
    if (hasData) {
      // an org with data never shows the welcome, so its first-login state ends here
      localStorage.removeItem("isFirstTimeLogin");
      return;
    }
    session.openWelcome();
  } catch {
    // an org whose streams cannot be read gets no welcome
  } finally {
    session.welcomeDeciding.value--;
  }
};

// every entry point loads through the session, so this one host announces the result
watch(session.status, (now, before) => {
  if (before !== "loading" || (now !== "loaded" && now !== "failed")) return;
  const target = session.loadingOrg.value;
  // the dialog's error view and the dock cover the current org
  if (now === "failed") {
    if (target !== org.value)
      toast({ variant: "error", message: t("sampleData.toast.loadFailed") });
    return;
  }
  if (target === org.value) store.dispatch("setIsDataIngested", true);
  // the corner dock announces a finished load for this org; only a load left behind in another org needs a toast
  if (session.welcomeOpen.value || target === org.value) return;
  toast({
    variant: "success",
    message: t("sampleData.toast.loaded"),
    action: { label: t("sampleData.welcome.ready.startTour"), handler: () => startTourFor(target) },
  });
});

// a load in another org holds the welcome back, so check again once it ends
watch([org, () => route.name, () => session.status.value === "loading", flowOn], maybeGreet);
// a deployment that turns the flow off gets no welcome, and closing it records no skip
watch(flowOn, (on) => !on && session.closeWelcome());
onMounted(maybeGreet);
onBeforeUnmount(() => {
  greetToken++;
  configArrived();
});
</script>
