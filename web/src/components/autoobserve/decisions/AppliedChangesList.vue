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
  <ul
    v-if="entries.length"
    class="flex flex-col gap-2"
    :aria-label="t('insight.decisions.applied.title')"
    data-test="autoobserve-applied-list"
  >
    <li
      v-for="entry in entries"
      :key="entry.view.decision_id"
      class="border-border-subtle bg-surface-base rounded-default flex items-start gap-2 border px-3 py-2.5"
      data-test="autoobserve-applied-row"
    >
      <OIcon name="check" size="sm" class="text-text-secondary mt-0.5 shrink-0" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <OTruncatedText class="text-text-heading text-sm font-medium">
          <a
            v-if="alertHref(entry)"
            :href="alertHref(entry)!"
            target="_blank"
            rel="noopener noreferrer"
            class="text-text-link hover:underline"
            data-test="autoobserve-applied-alert-link"
            >{{ entry.title }}</a
          >
          <template v-else>{{ entry.title }}</template>
        </OTruncatedText>
        <p class="text-text-secondary text-xs" data-test="autoobserve-applied-detail">
          {{ detailOf(entry) }}
        </p>
      </div>
      <OTag
        v-if="entry.view.state === 'undone'"
        variant="default"
        size="sm"
        :label="t('insight.decisions.applied.undone')"
        data-test="autoobserve-applied-undone"
      />
      <OButton
        v-else
        variant="ghost-primary"
        size="xs"
        :loading="route.isUndoing(entry.view.decision_id)"
        data-test="autoobserve-applied-undo"
        @click="undo(entry)"
      >
        {{ t("insight.decisions.undo") }}
      </OButton>
    </li>
  </ul>
  <slot v-else />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useOrgId } from "@/composables/query";
import { useRouter } from "vue-router";
import {
  appliedDecisionsQuery,
  useDecisionRoute,
} from "@/composables/autoobserve/useDecisionRoute";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { applyCopy } from "@/components/alert_calibration/applySuggestion";
import { decisionCopy } from "../insight/insightCopy";
import { useAppliedChanges, type AppliedEntry } from "./appliedChanges";

const { t, locale } = useI18nTyped();
const store = useStore();
const orgId = useOrgId();
const route = useDecisionRoute();
const router = useRouter();

const listed = useQuery(() => ({
  ...appliedDecisionsQuery(orgId.value),
  enabled: route.enabled.value,
}));

const entries = useAppliedChanges(orgId, () => listed.data.value ?? []);

/** A new tab, so this list stays where it was; a session row from an older server names no alert. */
const alertHref = (entry: AppliedEntry): string | null => {
  const alertId = entry.view.change?.alert.id ?? entry.alertId;
  if (!router || !alertId) return null;
  return router.resolve({
    name: "alertDetail",
    params: { alert_id: alertId },
    query: { org_identifier: entry.org },
  }).href;
};

const copy = computed(() => applyCopy(t, locale.value));

const detailOf = (entry: AppliedEntry): I18nText => {
  const changes = copy.value.appliedLines(entry.fields);
  const me = store.state.userInfo?.email;
  const params = (actor: string, at: number) => ({
    actor: actor === me ? t("insight.decisions.applied.you") : raw(actor),
    when: decisionCopy(t, locale.value).when(at),
  });
  const { view } = entry;
  if (view.state !== "undone")
    return raw(
      [
        ...changes,
        String(t("insight.decisions.applied.by", params(view.actor, view.decided_at))),
      ].join(" · "),
    );
  // Without undone_at the server moved decided_at and actor to the undo, so they describe the undo.
  const lines =
    view.undone_at != null
      ? [
          t("insight.decisions.applied.by", params(view.actor, view.decided_at)),
          t(
            "insight.decisions.applied.undoneBy",
            params(view.undone_by ?? view.actor, view.undone_at),
          ),
        ]
      : [t("insight.decisions.applied.undoneBy", params(view.actor, view.decided_at))];
  return raw([...changes, ...lines.map(String)].join(" · "));
};

function undo(entry: AppliedEntry) {
  void route.undo([{ org: entry.org, view: entry.view, title: entry.title }]);
}
</script>
