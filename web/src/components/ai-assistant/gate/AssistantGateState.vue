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
  <div
    v-if="content"
    ref="root"
    data-test="assistant-gate-state"
    :data-gate="reason"
    :data-size="size"
    :class="size === 'hero' ? 'flex h-full min-h-0 flex-col' : ''"
  >
    <OEmptyState
      v-if="size === 'hero' || size === 'inline'"
      :size="size === 'hero' ? 'hero' : 'block'"
      :backdrop="false"
      :title="content.title"
    >
      <template #illustration>
        <AssistantMark size="lg" muted />
      </template>
      <template v-if="content.body" #description>
        <i18n-t
          v-if="reason === 'no_permission'"
          keypath="assistant.gate.noPermission.body"
          tag="span"
        >
          <template #whereToGrant>
            <router-link
              v-if="isAdmin"
              class="text-text-link-hover underline hover:no-underline"
              data-test="assistant-gate-where-to-grant"
              :to="{ name: 'roles', query: { org_identifier: context?.org } }"
              >{{ whereToGrant }}</router-link
            >
            <template v-else>{{ whereToGrant }}</template>
          </template>
        </i18n-t>
        <template v-else>{{ content.body }}</template>
      </template>
      <template #actions>
        <div class="flex w-full flex-col items-center gap-4">
          <ul
            v-if="content.lines.length"
            class="text-text-secondary flex flex-col gap-1 text-sm"
            data-test="assistant-gate-capabilities"
          >
            <li v-for="line in content.lines" :key="line">{{ line }}</li>
          </ul>
          <div class="flex flex-wrap justify-center gap-2 max-md:w-full max-md:flex-col">
            <template v-for="action in content.actions" :key="action.cta">
              <AssistantAskAdminPopover
                v-if="action.cta === 'ask_admin'"
                :kind="askKind"
                :org="context?.org ?? ''"
                @copied="track('ask_admin_copy')"
                @emailed="track('ask_admin_email')"
              >
                <template #trigger>
                  <OButton
                    :ref="(el) => setPrimary(el, action.primary)"
                    :variant="action.primary ? 'primary' : 'outline'"
                    class="max-md:min-h-11 max-md:w-full"
                    :data-test="action.dataTest"
                    @click="onAction(action.cta)"
                  >
                    {{ action.label }}
                  </OButton>
                </template>
              </AssistantAskAdminPopover>
              <OButton
                v-else
                :ref="(el) => setPrimary(el, action.primary)"
                :variant="action.primary ? 'primary' : 'outline'"
                class="max-md:min-h-11 max-md:w-full"
                :data-test="action.dataTest"
                @click="onAction(action.cta)"
              >
                {{ action.label }}
              </OButton>
            </template>
          </div>
          <p v-if="content.reload" class="text-text-secondary text-sm">
            {{ t("assistant.gate.reloadHint") }}
            <OButton
              variant="ghost-primary"
              size="xs"
              class="max-md:min-h-11"
              data-test="assistant-gate-reload"
              @click="onAction('reload')"
            >
              {{ t("assistant.gate.reload") }}
            </OButton>
          </p>
          <slot name="extra" />
        </div>
      </template>
    </OEmptyState>
    <div v-else-if="size === 'popover'" class="flex max-w-80 flex-col gap-2 p-3">
      <h2 class="text-text-heading text-sm font-medium">{{ content.title }}</h2>
      <p v-if="content.body" class="text-text-secondary text-sm">{{ content.body }}</p>
      <div v-if="content.actions[0]" class="flex">
        <OButton
          :ref="(el) => setPrimary(el, true)"
          variant="primary"
          size="sm"
          class="max-md:min-h-11"
          :data-test="content.actions[0].dataTest"
          @click="onAction(content.actions[0].cta)"
        >
          {{ content.actions[0].label }}
        </OButton>
      </div>
    </div>
    <span v-else class="text-sm">{{ content.title }}</span>
  </div>
</template>

<script lang="ts">
import type { ComponentPublicInstance } from "vue";

import type { GateReason } from "@/composables/assistant";

export type GateCta =
  | "see_plans"
  | "setup"
  | "open_settings"
  | "try_again"
  | "ask_admin"
  | "learn_more"
  | "reload"
  | "close";

export interface AssistantGateStateProps {
  reason: GateReason;
  size: "hero" | "inline" | "popover" | "tooltip";
  isAdmin: boolean;
  context?: { org: string; feature?: "chat" | "share" | "share_read" | "rca" | "settings" };
  /** Only when a user action opened the gate; a passive mount never moves focus. */
  focusOnMount?: boolean;
  /** The pitch for an entitled org, titled "What it does" and without See plans (DG-06 AC 6). */
  learnOnly?: boolean;
}

export interface AssistantGateStateEmits {
  (e: "action", cta: GateCta): void;
}

/** The docs page for setting the agent up (`50` §5.1). */
export const SETUP_DOCS_URL = "https://openobserve.ai/docs/enterprise-setup/sre-agent/";

// Once per page session per reason, however many containers render the same gate.
const reported = new Set<GateReason>();

/** Lets a spec start from a fresh session; never called by app code. */
export function resetGateTelemetryForTests(): void {
  reported.clear();
}

type ButtonInstance = ComponentPublicInstance & { $el: HTMLElement };
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { useAssistantCapability, useAssistantName } from "@/composables/assistant";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { capabilitiesQuery } from "@/services/assistant.queries";
import { trackAssistant, type AiEventProps } from "@/services/assistantAnalytics";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantAskAdminPopover, { type AskAdminKind } from "./AssistantAskAdminPopover.vue";

interface GateAction {
  cta: GateCta;
  label: I18nText;
  dataTest: string;
  primary: boolean;
}

interface GateContent {
  title: I18nText;
  body: I18nText | null;
  lines: I18nText[];
  actions: GateAction[];
  reload: boolean;
}

const props = withDefaults(defineProps<AssistantGateStateProps>(), {
  context: undefined,
  focusOnMount: false,
  learnOnly: false,
});

const emit = defineEmits<AssistantGateStateEmits>();

defineSlots<{ extra?: () => unknown }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const capability = useAssistantCapability();
const upgrade = useEnterpriseUpgradeDialog();
const root = ref<HTMLElement | null>(null);
const primaryButton = ref<HTMLElement | null>(null);

// A disabled observer: the B-06 read is refetched on demand and never on mount.
const capabilities = useQuery(computed(() => capabilitiesQuery(props.context?.org ?? "", false)));

const whereToGrant = computed(() =>
  t("assistant.gate.whereToGrant", {
    iam: t("menu.iam"),
    roles: t("iam.roles"),
    group: t("iam.modules.groups.assistant"),
  }),
);

const content = computed<GateContent | null>(() => contentFor(props.reason));

const askKind = computed<AskAdminKind>(() => {
  if (props.reason === "off_for_org") return "settings";
  return props.reason === "no_share_read" ? "share_read" : "access";
});

function action(cta: GateCta, label: I18nText, dataTest: string, primary: boolean): GateAction {
  return { cta, label, dataTest, primary };
}

function contentFor(reason: GateReason): GateContent | null {
  const name = { product };
  const none = { lines: [], actions: [], reload: false };
  switch (reason) {
    case "not_entitled":
      return {
        title: props.learnOnly
          ? t("assistant.gate.learnTitle", name)
          : t("assistant.gate.notEntitled.title", name),
        body: t("assistant.gate.notEntitled.pitch", name),
        lines: [
          t("assistant.gate.notEntitled.capability1"),
          t("assistant.gate.notEntitled.capability2"),
          t("assistant.gate.notEntitled.capability3"),
        ],
        actions: [
          ...(props.learnOnly
            ? []
            : [
                action(
                  "see_plans",
                  t("assistant.gate.notEntitled.seePlans"),
                  "assistant-gate-see-plans",
                  true,
                ),
              ]),
          action("close", t("assistant.gate.close"), "assistant-gate-close", props.learnOnly),
        ],
        reload: false,
      };
    case "not_configured":
      if (!props.isAdmin) return null;
      return {
        ...none,
        title: t("assistant.gate.notConfigured.title", name),
        body: t("assistant.gate.notConfigured.body"),
        actions: [
          action("setup", t("assistant.gate.notConfigured.setup"), "assistant-gate-setup", true),
        ],
      };
    case "off_for_org":
      return {
        ...none,
        title: t("assistant.gate.offForOrg.title", name),
        body: t("assistant.gate.offForOrg.body"),
        actions: props.isAdmin
          ? []
          : [
              action(
                "ask_admin",
                t("assistant.gate.noPermission.askAdmin"),
                "assistant-gate-ask-admin",
                true,
              ),
            ],
      };
    case "unhealthy":
      return {
        ...none,
        title: t("assistant.gate.unhealthy.title", name),
        body: t("assistant.gate.unhealthy.body"),
        actions: [
          action("try_again", t("assistant.gate.tryAgain"), "assistant-gate-try-again", true),
        ],
      };
    case "no_permission":
      return {
        title: t("assistant.gate.noPermission.title", name),
        body: t("assistant.gate.noPermission.body", { whereToGrant: whereToGrant.value }),
        lines: [],
        actions: [
          action(
            "ask_admin",
            t("assistant.gate.noPermission.askAdmin"),
            "assistant-gate-ask-admin",
            true,
          ),
          action("learn_more", t("assistant.gate.learnMore"), "assistant-gate-learn-more", false),
        ],
        reload: props.size !== "popover",
      };
    case "no_share":
      return { ...none, title: t("assistant.gate.noShare.tooltip"), body: null };
    case "no_share_read":
      return {
        ...none,
        title: t("assistant.gate.noShareRead.title"),
        body: t("assistant.gate.noShareRead.body"),
        actions: [
          action(
            "ask_admin",
            t("assistant.gate.noPermission.askAdmin"),
            "assistant-gate-ask-admin",
            true,
          ),
        ],
      };
  }
}

function setPrimary(el: unknown, primary: boolean): void {
  if (primary && el) primaryButton.value = (el as ButtonInstance).$el ?? null;
}

function track(cta?: AiEventProps["ai_gate_blocked"]["cta"]): void {
  trackAssistant("ai_gate_blocked", { reason: props.reason, ...(cta && { cta }) });
}

// B-06 answers the probe when it exists; without it only a reload re-reads the role.
function reprobe(): void {
  if (capability.value.source === "capabilities") void capabilities.refetch();
  else window.location.reload();
}

function onAction(cta: GateCta): void {
  if (cta !== "close") track(cta);
  if (cta === "see_plans") upgrade.open();
  if (cta === "setup") window.open(SETUP_DOCS_URL, "_blank", "noopener,noreferrer");
  if (cta === "reload") reprobe();
  if (cta === "try_again") void capabilities.refetch();
  emit("action", cta);
}

// A gate mounted hidden (the locked sidebar) is opened later, so the user's action arrives as a prop change.
watch(
  () => props.focusOnMount,
  async (focus) => {
    if (!focus) return;
    await nextTick();
    primaryButton.value?.focus();
  },
);

let observer: IntersectionObserver | null = null;

function reportOnce(): void {
  if (reported.has(props.reason)) return;
  reported.add(props.reason);
  trackAssistant("ai_gate_blocked", { reason: props.reason });
}

// A gate mounted in a hidden column has blocked nobody yet, so it reports when first seen.
onMounted(() => {
  if (!content.value) return;
  if (typeof IntersectionObserver === "undefined" || !root.value) reportOnce();
  else {
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      reportOnce();
      observer?.disconnect();
      observer = null;
    });
    observer.observe(root.value);
  }
  if (props.focusOnMount) primaryButton.value?.focus();
});

onBeforeUnmount(() => observer?.disconnect());
</script>
