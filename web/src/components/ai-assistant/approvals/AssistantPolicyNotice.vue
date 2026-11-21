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
  <div v-if="notice" class="min-w-0" :data-kind="notice.kind" data-test="assistant-policy-notice">
    <OBanner
      variant="default"
      dense
      role="presentation"
      :data-test="
        notice.kind === 'denied' ? 'assistant-permission-denied' : 'assistant-unreviewed-change'
      "
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <p class="text-text-body text-sm break-words">{{ text }}</p>
        <OText v-if="hint" variant="meta" as="p">{{ hint }}</OText>
      </div>
      <template v-if="href" #actions>
        <OButton
          variant="outline"
          size="sm"
          as="a"
          :href="href"
          target="_blank"
          rel="noopener noreferrer"
          :icon-right="assistantGlyph.newTab"
          :aria-label="t('assistant.policy.unreviewedActionName')"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-unreviewed-change-open"
        >
          {{ t("assistant.policy.unreviewedAction") }}
        </OButton>
      </template>
    </OBanner>
  </div>
</template>

<script lang="ts">
// A notice counts once per page load, so a re-render never repeats the event.
const tracked = new Set<string>();
</script>

<script setup lang="ts">
import { computed, inject, onMounted } from "vue";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  approvalTargetHref,
  assistantEvidenceHostKey,
  entityKeyOf,
  type AssistantTurnView,
  type PolicyBlockData,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** As a registered renderer: a `policy` block. */
    block?: ContentBlock | null;
    blockId?: string;
    /** Or the notice itself, as the transcript passes a denied step. */
    policy?: PolicyBlockData | null;
    readonly?: boolean;
    turn?: AssistantTurnView | null;
    org?: string;
    density?: "compact" | "roomy";
    message?: unknown;
  }>(),
  {
    block: null,
    blockId: "",
    policy: null,
    readonly: false,
    turn: null,
    org: "",
    density: "compact",
  },
);

const { t } = useI18nTyped();
const router = useRouter();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const notice = computed(() => props.policy ?? props.block?.policy ?? null);

const text = computed(() => {
  const current = notice.value;
  if (!current) return raw("");
  if (current.kind === "denied")
    return current.detail
      ? t("assistant.policy.denied", { tool: raw(current.tool ?? ""), detail: raw(current.detail) })
      : t("assistant.policy.deniedPlain", { tool: raw(current.tool ?? "") });
  const count = current.count ?? 1;
  const entity = t(`assistant.entity.${entityKeyOf(current.resourceType)}`, count);
  return t("assistant.policy.unreviewed", { count, entity });
});

const hint = computed(() => {
  const current = notice.value;
  if (current?.kind !== "denied") return null;
  if (current.policy === "auto_reject") return t("assistant.policy.autoDeclined");
  return current.policy === "admin" || current.policy === "rbac"
    ? t("assistant.policy.deniedAdmin")
    : null;
});

// The object's own page in a new tab; the list of its kind when no id came with the change.
const href = computed(() => {
  const current = notice.value;
  if (props.readonly || current?.kind !== "unreviewed" || !current.resourceType) return null;
  const org = props.org || props.turn?.org || "";
  const type = current.resourceType;
  return (
    (current.resourceId && approvalTargetHref(router, org, { type, id: current.resourceId })) ||
    approvalTargetHref(router, org, { type })
  );
});

onMounted(() => {
  const current = notice.value;
  if (!current || props.readonly) return;
  const key = props.blockId || `${current.kind}:${current.tool ?? current.resourceType ?? ""}`;
  if (tracked.has(key)) return;
  tracked.add(key);
  trackAssistant("ai_policy_notice", {
    kind: current.kind === "denied" ? "permission_denied" : "unreviewed_change",
  });
  // A block that lands while the answer streams is news, so it is spoken; history is not.
  const sid = props.turn?.sid;
  if (current.kind === "denied" && props.turn?.outcome === "live" && sid)
    evidence?.announce(sid, text.value);
});
</script>
