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

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import {
  linkAllMutation,
  slackLinkingQuery,
  updateLinkingMutation,
} from "@/services/slack.queries";
import { useI18nTyped } from "@/types/i18n";
import type { InstallationView } from "@/types/slack";
import SlackLinkedPeople from "./SlackLinkedPeople.vue";
import SlackOncallUnlinked from "./SlackOncallUnlinked.vue";
import { makeLinkingSchema, type LinkingForm } from "./SlackSettings.schema";

const props = defineProps<{ installation: InstallationView }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const id = computed(() => props.installation.id);
// Linking is installation-wide, so on a managed workspace it is the instance admin's.
const managed = computed(() => props.installation.managed);

const linking = useQuery(() => slackLinkingQuery(org.value, id.value));
const update = useMutation(() => updateLinkingMutation(org.value, id.value));
const linkAll = useMutation(() => linkAllMutation(org.value, id.value));

const editing = ref(false);
const peopleOpen = ref(false);
const schema = makeLinkingSchema(t);

const view = computed(() => linking.data.value ?? null);
const domainsText = computed(() => (view.value?.domains ?? []).join(", "));
const summary = computed(() => {
  const current = view.value;
  if (!current) return "";
  if (!current.enabled) return t("slackApp.linking.offSummary");
  return current.source === "mapping"
    ? t("slackApp.linking.mappedSummary", { domains: domainsText.value })
    : t("slackApp.linking.manualSummary", { domains: domainsText.value });
});
const noDomains = computed(() => !!view.value?.enabled && !view.value.domains.length);
const autoCount = computed(() =>
  view.value ? view.value.counts.email + view.value.counts.admin_bulk : 0,
);
const matches = computed(() => (managed.value ? 0 : (view.value?.counts.matches_not_linked ?? 0)));
const mapped = computed(() => view.value?.source === "mapping");
// Under a mapping `domains` are the org's mapped ones; the editor edits the manual list beside them.
const formDefaults = computed<LinkingForm>(() => ({
  enabled: view.value?.enabled ?? true,
  domains: [...((mapped.value ? view.value?.manual_domains : view.value?.domains) ?? [])],
}));

// Under a mapping the view's domains are the mapping's, so the toggle must not write them as the manual list.
const toggle = (value: unknown): void => {
  const enabled = value === true;
  const current = view.value;
  if (!current) return;
  update.mutate(current.source === "mapping" ? { enabled } : { enabled, domains: current.domains });
};

const saveDomains = async (value: LinkingForm): Promise<void> => {
  await update.mutateAsync({ enabled: value.enabled, domains: value.domains });
  editing.value = false;
  toast({ variant: "success", message: t("slackApp.linking.saved") });
};

const runLinkAll = async (): Promise<void> => {
  try {
    const result = await linkAll.mutateAsync();
    toast({
      variant: "success",
      message: result.complete
        ? t("slackApp.linking.linkAllDone", { count: result.linked }, result.linked)
        : t("slackApp.linking.linkAllRunning", { count: result.linked }),
    });
  } catch {
    /* the mutation already toasted the refusal */
  }
};
</script>

<template>
  <section class="flex flex-col gap-3" data-test="slack-linking">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <h2 class="text-text-heading m-0 text-lg font-semibold">
          {{ t("slackApp.linking.title") }}
        </h2>
        <p class="text-text-secondary m-0 text-sm">
          {{
            managed ? t("slackApp.linking.setByInstanceAdmin") : t("slackApp.linking.removedUsers")
          }}
        </p>
      </div>
      <OButton
        v-if="!managed"
        variant="ghost-primary"
        size="sm"
        data-test="slack-linking-manage"
        @click="peopleOpen = true"
      >
        {{ t("slackApp.linking.manage") }}
      </OButton>
    </div>

    <OSkeleton v-if="linking.isPending.value" class="h-32 w-full" />
    <OEmptyState
      v-else-if="linking.isError.value"
      size="compact"
      preset="load-error"
      :backdrop="false"
      data-test="slack-linking-error"
      @action="linking.refetch()"
    />
    <OCard v-else-if="view" variant="outlined" class="divide-border-default divide-y">
      <div class="flex flex-col gap-3 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-text-heading text-sm font-medium">
              {{ t("slackApp.linking.auto") }}
            </span>
            <span
              v-if="managed"
              class="text-text-secondary text-sm"
              data-test="slack-linking-counts"
            >
              {{
                t("slackApp.linking.managedCounts", {
                  linked: autoCount + view.counts.oidc,
                  auto: autoCount,
                  manual: view.counts.oidc,
                })
              }}
            </span>
            <template v-else>
              <span
                v-if="noDomains"
                class="text-status-warning-text text-sm"
                data-test="slack-linking-no-domains"
              >
                {{ t("slackApp.linking.noDomains") }}
                <template v-if="view.counts.skipped_domain > 0">
                  ·
                  {{
                    t(
                      "slackApp.linking.skippedDomain",
                      { count: view.counts.skipped_domain },
                      view.counts.skipped_domain,
                    )
                  }}
                </template>
              </span>
              <span v-else class="text-text-secondary text-sm" data-test="slack-linking-summary">
                {{ summary }}
              </span>
              <span class="text-text-secondary text-xs" data-test="slack-linking-counts">
                {{ t("slackApp.linking.counts", { auto: autoCount, oidc: view.counts.oidc }) }}
              </span>
            </template>
          </div>
          <div class="flex items-center gap-2">
            <OButton
              v-if="!editing && !managed"
              variant="outline"
              size="sm"
              data-test="slack-linking-edit"
              @click="editing = true"
            >
              {{ t("slackApp.linking.editDomains") }}
            </OButton>
            <OSwitch
              :model-value="view.enabled"
              :label="view.enabled ? t('slackApp.linking.on') : t('slackApp.linking.off')"
              label-position="left"
              :disabled="managed || update.isPending.value"
              data-test="slack-linking-switch"
              @update:model-value="toggle"
            />
          </div>
        </div>
        <p v-if="view.source === 'mapping' && !managed" class="text-text-secondary m-0 text-xs">
          {{ t("slackApp.linking.mappedReadonly") }}
        </p>
        <OForm
          v-if="editing && !managed"
          :schema="schema"
          :default-values="formDefaults"
          class="flex flex-col gap-3"
          data-test="slack-linking-form"
          @submit="saveDomains"
        >
          <div class="flex flex-col gap-1">
            <span class="text-text-label text-compact font-medium">{{
              mapped ? t("slackApp.linking.manualForUnmapped") : t("slackApp.linking.domains")
            }}</span>
            <OFormTagInput name="domains" data-test="slack-linking-domains" />
          </div>
          <p class="text-text-secondary m-0 text-xs">{{ t("slackApp.linking.domainsHelp") }}</p>
          <div class="flex gap-2">
            <OButton variant="outline" size="sm-action" @click="editing = false">
              {{ t("common.cancel") }}
            </OButton>
            <OButton variant="primary" size="sm-action" type="submit">
              {{ t("common.save") }}
            </OButton>
          </div>
        </OForm>
      </div>

      <div
        v-if="matches > 0"
        class="flex flex-wrap items-center justify-between gap-3 p-4"
        data-test="slack-linking-matches"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-heading text-sm font-medium">
            {{ t("slackApp.linking.matches", { count: matches }, matches) }}
          </span>
          <span class="text-text-secondary text-xs">{{ t("slackApp.linking.matchesHelp") }}</span>
        </div>
        <OButton
          variant="outline"
          size="sm-action"
          :loading="linkAll.isPending.value"
          @click="runLinkAll"
        >
          {{ t("slackApp.linking.linkAllMatches", { count: matches }) }}
        </OButton>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-heading text-sm font-medium">
            {{ t("slackApp.linking.appHome") }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t("slackApp.linking.appHomeDescription") }}
          </span>
        </div>
        <OTag variant="success-soft" :label="t('slackApp.linking.enabled')" />
      </div>
    </OCard>

    <SlackOncallUnlinked :installation="installation" />

    <SlackLinkedPeople v-model:open="peopleOpen" :installation-id="installation.id" />
  </section>
</template>
