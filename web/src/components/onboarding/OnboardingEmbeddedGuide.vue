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

<!-- A Data sources guide page shown inside onboarding: the page itself, with what the Data sources
     page gives it (its route, its props, the RUM token), and its first-event checks reported up. -->
<template>
  <div data-test="onboarding-embedded-guide">
    <div v-if="needsRumToken" class="mb-2 flex justify-end px-3">
      <OButton
        variant="primary"
        size="sm"
        :loading="createRumToken.isPending.value"
        data-test="onboarding-embedded-guide-rum-token"
        @click="generateRumToken"
      >
        {{ t("ingestion.generateRUMTokenLabel") }}
      </OButton>
    </div>
    <OBanner
      v-if="failed"
      variant="error"
      dense
      inline-actions
      class="mx-3 mt-3"
      :content="t('onboarding.guide.loadFailed')"
      data-test="onboarding-embedded-guide-failed"
    >
      <template #actions>
        <OButton
          as="a"
          :href="resolved.href"
          variant="outline"
          size="sm"
          data-test="onboarding-embedded-guide-open-app"
        >
          {{ t("onboarding.guide.openInApp") }}
        </OButton>
      </template>
    </OBanner>
    <!-- Only to a page that declares them, so the email never lands on a page root as an attribute. -->
    <component
      :is="page.component"
      v-if="page"
      v-bind="page.props"
      :curr-org-identifier="page.declares.includes('currOrgIdentifier') ? org : undefined"
      :curr-user-email="page.declares.includes('currUserEmail') ? email : undefined"
      @vue:mounted="pageMounted = true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, shallowRef, watch, type Component } from "vue";
import { useMutation } from "@tanstack/vue-query";
import {
  loadRouteLocation,
  routeLocationKey,
  useRouter,
  type RouteLocationNormalizedLoaded,
} from "vue-router";
import { useStore } from "vuex";

import type {
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import { FIRST_EVENT_REPORTER } from "@/composables/firstEvent/firstEventReporter";
import { queryClient } from "@/composables/query/queryClient";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { createRumTokenMutation, rumTokensQuery } from "@/services/api_keys.queries";
import analytics from "@/services/product_analytics";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  /** The guide's Data sources route; the host keys this component by it. */
  route: string;
  /** Added to that route's query, as a link to the page would carry it (RUM's `platform`). */
  query?: Record<string, string>;
}>();
const emit = defineEmits<{
  state: [state: FirstEventState];
  received: [result: FirstEventResult];
  /** Once the page has rendered: whether it runs a first-event check of its own. */
  status: [has: boolean];
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const email = computed<string>(() => store.state.userInfo?.email ?? "");

// The page reads its own route (its signal, its test stream, a search), so it gets the guide's
// route, not onboarding's.
const resolved = router.resolve({
  name: props.route,
  query: { ...props.query, org_identifier: org.value },
});
const target = resolved as RouteLocationNormalizedLoaded;
provide(routeLocationKey, target);

// Only the guide's own component renders: the Data sources tabs and lists around it stay behind.
const page = shallowRef<{
  component: Component;
  props: Record<string, unknown>;
  /** The page's declared prop names. */
  declares: string[];
}>();
// A page that does not load still gets the org-wide check, and a link to the app page.
const failed = ref(false);
const leaf = target.matched[target.matched.length - 1];
loadRouteLocation({ ...target, matched: [leaf] })
  .then(() => {
    const component = leaf.components?.default as (Component & { props?: unknown }) | undefined;
    const given = leaf.props.default;
    if (!component) return;
    const declared = component.props;
    page.value = {
      component,
      props:
        given === true
          ? { ...target.params }
          : typeof given === "function"
            ? given(target)
            : ((given as Record<string, unknown>) ?? {}),
      declares: Array.isArray(declared) ? declared : Object.keys(declared ?? {}),
    };
  })
  .catch(() => (failed.value = true));

const isRum = props.route === "frontendMonitoring";

// The RUM guide shows its snippet only once the org has a RUM token, which the Data sources page
// reads and offers to generate.
const rumToken = computed<string>(() => store.state.organizationData?.rumToken?.rum_token ?? "");
const rumRead = ref(!isRum);
if (isRum) {
  const asked = org.value;
  void queryClient
    .fetchQuery(rumTokensQuery(asked))
    // the store holds one token: a reply that lands after an org switch belongs to the old org
    .then((res: { data?: unknown }) => {
      if (store.state.selectedOrganization?.identifier === asked)
        void store.dispatch("setRUMToken", res.data);
    })
    .catch(() => {})
    .finally(() => (rumRead.value = true));
}
const needsRumToken = computed(() => isRum && rumRead.value && !rumToken.value);
const createRumToken = useMutation(() => createRumTokenMutation(org.value));
const generateRumToken = () => {
  // The event the Data sources page sends for the same button; `page` says where it was clicked.
  analytics.track("Button Click", {
    button: "Generate RUM Token",
    user_org: org.value,
    user_id: email.value,
    page: "Onboarding",
  });
  return createRumToken
    .mutateAsync()
    .then((res: { data: { data: { new_key: string } } }) =>
      store.dispatch("setRUMToken", { rum_token: res.data.data.new_key }),
    )
    .catch((e: { response?: { status?: number; data?: { message?: string } } }) => {
      if (e?.response?.status === 403) return;
      toast({
        variant: "error",
        message: raw(e?.response?.data?.message) || t("ingestion.errorWhileGeneratingRumToken"),
        timeout: 5000,
      });
    });
};

// Every first-event status on the page reports here, so the onboarding bar mirrors it.
const statuses = ref(0);
provide(FIRST_EVENT_REPORTER, {
  attach: () => {
    statuses.value++;
    return () => statuses.value--;
  },
  state: (s) => emit("state", s),
  detected: (r) => emit("received", r),
});
const pageMounted = ref(false);
watch(
  () => ((pageMounted.value || failed.value) && rumRead.value ? statuses.value > 0 : undefined),
  (has) => {
    if (has !== undefined) emit("status", has);
  },
);
</script>
