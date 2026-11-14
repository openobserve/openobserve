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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useFormCounts } from "@/lib/forms/SaveBar/formCounts";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import {
  linkAllMutation,
  slackLinkingQuery,
  updateLinkingMutation,
} from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { InstallationView } from "@/types/slack";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import SlackLinkedPeople from "./SlackLinkedPeople.vue";
import { useSlackReadOnly } from "./slackReadOnly";
import { useSavedBaseline, useSlackSavePart } from "./slackSaveBar";
import { makeLinkingSchema, type LinkingForm } from "./SlackSettings.schema";

const props = defineProps<{ installation: InstallationView }>();
const readOnly = useSlackReadOnly();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const id = computed(() => props.installation.id);
// Linking is installation-wide, so on a managed workspace it is the instance admin's.
const managed = computed(() => props.installation.managed);

const linking = useQuery(() => slackLinkingQuery(org.value, id.value));
const update = useMutation(() => updateLinkingMutation(org.value, id.value));
const linkAll = useMutation(() => linkAllMutation(org.value, id.value));

const peopleOpen = ref(false);

const view = computed(() => linking.data.value ?? null);
const domainsText = computed(() => (view.value?.domains ?? []).join(", "));
const summary = computed(() => {
  const current = view.value;
  if (!current) return "";
  if (!current.enabled) return t("slackApp.linking.offSummary");
  // Only a mapping's domains need saying: the typed-in ones are in the row below.
  return current.source === "mapping"
    ? t("slackApp.linking.mappedSummary", { domains: domainsText.value })
    : "";
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

const sameDomains = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((domain, index) => domain === b[index]);

const save = async (value: LinkingForm): Promise<void> => {
  const domainsChanged = !sameDomains(value.domains, baseline.baseline.value.domains);
  // Under a mapping an untouched manual list is not written back, so the switch alone sends only itself.
  const body =
    mapped.value && !domainsChanged
      ? { enabled: value.enabled }
      : { enabled: value.enabled, domains: value.domains };
  await baseline.save(() => update.mutateAsync(body));
  toast({ variant: "success", message: t("slackApp.linking.saved") });
};

const form = useOForm<LinkingForm>({
  defaultValues: formDefaults.value,
  schema: makeLinkingSchema(t),
  validateOn: "leave",
  onSubmit: save,
});
const values = form.useStore((s) => s.values);
const baseline = useSavedBaseline(form, values, () => formDefaults.value);
const { errors } = useFormCounts(form);
const changes = computed(() => {
  if (!view.value || managed.value) return 0;
  return baseline.changed.value.length;
});

useSlackSavePart({
  changes: () => changes.value,
  errors: () => errors.value,
  save: async () => {
    try {
      await form.handleSubmit();
    } catch {
      return false;
    }
    return form.state.isValid && changes.value === 0;
  },
  discard: baseline.discard,
});

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
  <OFormSection
    variant="plain"
    :title="t('slackApp.linking.title')"
    :description="
      managed ? t('slackApp.linking.setByInstanceAdmin') : t('slackApp.linking.removedUsers')
    "
    data-test="slack-linking"
  >
    <template v-if="!managed" #actions>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="manage-accounts"
        data-test="slack-linking-manage"
        @click="peopleOpen = true"
      >
        {{ t("slackApp.linking.manage") }}
      </OButton>
    </template>

    <OSkeleton v-if="linking.isPending.value" class="h-32 w-full" />
    <OEmptyState
      v-else-if="linking.isError.value"
      size="compact"
      preset="load-error"
      :backdrop="false"
      data-test="slack-linking-error"
      @action="linking.refetch()"
    />
    <OForm v-else-if="view" :form="form" novalidate data-test="slack-linking-form">
      <OSettingRow
        control-at="end"
        :label="t('slackApp.linking.auto')"
        data-test="slack-linking-auto"
      >
        <template #description>
          <span v-if="managed" data-test="slack-linking-counts">
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
              class="text-status-warning-text block"
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
            <span v-else-if="summary" class="block" data-test="slack-linking-summary">
              {{ summary }}
            </span>
            <span class="block" data-test="slack-linking-counts">
              {{ t("slackApp.linking.counts", { auto: autoCount, oidc: view.counts.oidc }) }}
            </span>
          </template>
        </template>
        <span data-test="slack-linking-switch">
          <OFormSwitch
            name="enabled"
            off-tone="neutral"
            state-text
            :disabled="managed || readOnly"
            :aria-label="t('slackApp.linking.auto')"
          />
          <OTooltip v-if="readOnly" side="bottom" :content="t('slackApp.connect.permissionHint')" />
        </span>
      </OSettingRow>

      <OSettingRow
        v-if="!managed"
        control-at="end"
        :label="mapped ? t('slackApp.linking.manualForUnmapped') : t('slackApp.linking.domains')"
        data-test="slack-linking-domains-row"
      >
        <template #description>
          {{ t("slackApp.linking.domainsHelp") }}
          <span v-if="mapped" class="block">{{ t("slackApp.linking.mappedReadonly") }}</span>
        </template>
        <OFormTagInput
          v-if="!readOnly"
          name="domains"
          class="w-full"
          :aria-label="
            mapped ? t('slackApp.linking.manualForUnmapped') : t('slackApp.linking.domains')
          "
          data-test="slack-linking-domains"
        />
        <span v-else class="text-text-body text-sm" data-test="slack-linking-domains-readonly">
          {{ raw(baseline.baseline.value.domains.join(", ") || "—") }}
          <OTooltip side="bottom" :content="t('slackApp.connect.permissionHint')" />
        </span>
      </OSettingRow>

      <OSettingRow
        v-if="matches > 0"
        control-at="end"
        :label="t('slackApp.linking.matches', { count: matches }, matches)"
        :description="t('slackApp.linking.matchesHelp')"
        data-test="slack-linking-matches"
      >
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="link"
          :loading="linkAll.isPending.value"
          :disabled="readOnly"
          @click="runLinkAll"
        >
          {{ t("slackApp.linking.linkAllMatches", { count: matches }) }}
        </OButton>
      </OSettingRow>

      <OSettingRow control-at="end" :label="t('slackApp.linking.appHome')">
        <OTag variant="success-soft" :label="t('slackApp.linking.enabled')" />
      </OSettingRow>
    </OForm>

    <SlackLinkedPeople v-model:open="peopleOpen" :installation-id="installation.id" />
  </OFormSection>
</template>
