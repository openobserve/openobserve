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
  <OPageLayout constrained data-test="oncall-slack-link-page">
    <div class="flex justify-center py-6">
      <div
        class="rounded-surface bg-surface-base border-border-default flex w-full max-w-104 flex-col items-center gap-3 border p-5 text-center"
      >
        <span
          v-if="stage === 'checking' || stage === 'ready'"
          class="rounded-default bg-accent/8 text-accent grid size-9 place-items-center"
        >
          <OIcon name="slack" size="sm" />
        </span>
        <span
          v-else-if="stage === 'linked'"
          class="rounded-default bg-status-success-bg text-status-success-text grid size-9 place-items-center"
        >
          <OIcon name="check" size="sm" />
        </span>
        <span
          v-else
          class="rounded-default bg-status-error-bg text-status-error-text grid size-9 place-items-center"
        >
          <OIcon name="error-outline" size="sm" />
        </span>

        <OText variant="card-title" data-test="oncall-slack-link-title">{{ title }}</OText>
        <OText variant="meta" data-test="oncall-slack-link-body">{{ body }}</OText>

        <template v-if="stage === 'ready'">
          <OText variant="body-strong" data-test="oncall-slack-link-account">{{ account }}</OText>
          <OBanner v-if="!sameEmail" variant="warning" dense data-test="oncall-slack-link-warning">
            {{ t("oncallSlack.confirmOtherEmail", { email, command: LINK_COMMAND }) }}
          </OBanner>
        </template>

        <OButton
          v-if="stage === 'ready'"
          variant="primary"
          size="sm-action"
          :loading="confirmWrite.isPending.value"
          data-test="oncall-slack-link-confirm"
          @click="confirm"
        >
          {{ t("oncallSlack.confirmButton") }}
        </OButton>
        <OButton
          v-else-if="stage === 'linked'"
          variant="ghost-primary"
          size="xs"
          data-test="oncall-slack-link-go-mine"
          @click="openMine"
        >
          {{ t("oncallSlack.confirmGoMine") }}
        </OButton>

        <p
          v-if="error"
          class="text-status-error-text text-sm"
          role="alert"
          data-test="oncall-slack-link-error"
        >
          {{ error }}
        </p>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import { serverMessageOf } from "@/components/settings/slack";
import { isBadRequest } from "@/components/oncall/slackLink";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { confirmSlackLinkMutation, previewSlackLinkMutation } from "@/services/oncall.queries";
import type { SlackLinkPreview } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

// What `/oncall link` is typed as in Slack; a command, so never translated.
const LINK_COMMAND = raw("/oncall link");
// The command a linked person can now use; a command, so never translated.
const ONCALL_COMMAND = raw("/oncall");

// The page's stages: waiting for the preview, waiting for Confirm, linked, or refused for good.
type Stage = "checking" | "ready" | "linked" | "refused";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

// One query value, whether the URL carried it once or repeated it.
const queryString = (value: unknown): string => {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
};

// LN-1: the org is the link's own, not whichever org the session last had selected.
const org = queryString(route.query.org_identifier);
const token = queryString(route.query.t);
const email = computed(() => raw(String(store.state.userInfo?.email ?? "")));

const previewRead = useMutation(() => previewSlackLinkMutation(org));
const confirmWrite = useMutation(() => confirmSlackLinkMutation(org));

// A URL without its token or org can never pass Confirm, so it reads as refused from the start.
const stage = ref<Stage>(org && token ? "checking" : "refused");
const preview = ref<SlackLinkPreview | null>(null);
const linkedEmail = ref("");
const error = ref<I18nText | null>(null);

// Slack's name and email are the account owner's own text, so they only ever render as text.
const account = computed(() => {
  if (!preview.value) return null;
  const { name, email: slackEmail } = preview.value;
  const who =
    name && slackEmail
      ? t("oncallSlack.confirmAccountBoth", { name: raw(name), email: raw(slackEmail) })
      : raw(name || slackEmail) || t("oncallSlack.confirmAccountUnnamed");
  return t("oncallSlack.confirmAccount", { account: who });
});
const sameEmail = computed(() => preview.value?.same_email === true);

// The heading and sentence shared while the preview runs and once it has answered.
const confirmCopy = () => ({
  title: t("oncallSlack.confirmTitle"),
  body: t("oncallSlack.confirmBody", { email: email.value }),
});

// Each stage's heading and sentence, so no stage can render without both.
const copy: Record<Stage, () => { title: I18nText; body: I18nText }> = {
  checking: confirmCopy,
  ready: confirmCopy,
  linked: () => ({
    title: t("oncallSlack.linkLinkedAs", { email: raw(linkedEmail.value) }),
    body: t("oncallSlack.linkWorks", { command: ONCALL_COMMAND }),
  }),
  refused: () => ({
    title: t("oncallSlack.confirmRefusedTitle"),
    body: t("oncallSlack.confirmRefusedBody", { command: LINK_COMMAND }),
  }),
};
const title = computed(() => copy[stage.value]().title);
const body = computed(() => copy[stage.value]().body);

// LN-6: Confirm appears only once the token's account is named; a 400 is the same refusal Confirm gives.
async function loadPreview() {
  try {
    preview.value = (await previewRead.mutateAsync(token)).data;
    stage.value = "ready";
  } catch (err) {
    if (isBadRequest(err)) {
      stage.value = "refused";
      return;
    }
    error.value = raw(serverMessageOf(err)) || t("oncallSlack.linkStartFailed");
  }
}

if (stage.value === "checking") loadPreview();

// Every failed LN-2 check answers one 400; anything else is passing trouble, so Confirm stays.
async function confirm() {
  error.value = null;
  try {
    linkedEmail.value = (await confirmWrite.mutateAsync(token)).data.email;
    stage.value = "linked";
  } catch (err) {
    if (isBadRequest(err)) {
      stage.value = "refused";
      return;
    }
    error.value = raw(serverMessageOf(err)) || t("oncallSlack.linkStartFailed");
  }
}

function openMine() {
  router.push({ name: "onCallMine", query: { org_identifier: org } });
}
</script>
