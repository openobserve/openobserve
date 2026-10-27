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
    v-if="message.role === 'user'"
    class="group/message bg-assistant-user-bg rounded-surface flex min-w-0 flex-col gap-1.5 px-3 py-2"
    data-test="assistant-message-user"
    data-scroll-anchor
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <!-- Metadata on the tinted bubble takes the body colour: the meta grey measures 4.3:1 there -->
      <span
        class="text-text-body min-w-0 flex-1 text-xs leading-5"
        data-test="assistant-message-meta"
      >
        {{ userMeta }}
      </span>
      <slot name="actions" />
    </div>
    <slot name="body">
      <p
        v-if="userText"
        class="text-text-body min-w-0 text-sm break-words whitespace-pre-wrap"
        data-test="assistant-message-text"
      >
        {{ userText }}
      </p>
    </slot>
    <ul
      v-if="chips.length"
      class="flex min-w-0 flex-wrap gap-1.5"
      :aria-label="t('assistant.message.chipsName')"
      data-test="assistant-message-chips"
    >
      <li v-for="chip in chips" :key="chip.id" class="max-w-full min-w-0">
        <OTag
          type="assistantContext"
          value="sent"
          :label="chip.label"
          :icon="chipGlyph[chip.kind]"
          class="max-w-full"
          :data-test="`assistant-message-chip-${chip.kind}`"
        />
      </li>
    </ul>
    <div v-if="attachments.length" class="flex min-w-0 flex-col gap-1.5">
      <AssistantAttachmentBlock
        v-for="(block, index) in attachments"
        :key="`${turnId}:a${index}`"
        :name="block.name"
        :body="block.body"
        :hidden="block.hidden"
      />
    </div>
    <ul v-if="images.length" class="flex flex-wrap gap-1.5" data-test="assistant-message-images">
      <li v-for="(image, index) in images" :key="image.id ?? `${image.filename}-${index}`">
        <OPopover :aria-label="image.filename" privacy="mask">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-md"
              class="p-0! max-md:size-11 pointer-coarse:size-11"
              :aria-label="t('assistant.message.openImage', { name: image.filename })"
              data-test="assistant-message-image"
            >
              <img
                :src="dataUrl(image)"
                :alt="image.filename"
                class="rounded-default size-10 object-cover"
              />
            </OButton>
          </template>
          <img
            :src="dataUrl(image)"
            :alt="image.filename"
            class="rounded-default block max-h-80 max-w-80 p-2"
            data-test="assistant-message-image-preview"
          />
        </OPopover>
      </li>
    </ul>
    <p
      v-if="message.rerunFor"
      class="text-text-body text-xs leading-5"
      data-test="assistant-message-rerun"
    >
      {{ t("assistant.footer.rerunFor", { range: rerunRange }) }}
    </p>
    <p
      v-if="message.editedFrom"
      class="text-text-body text-xs leading-5"
      data-test="assistant-message-edited"
    >
      {{ t("assistant.message.editedFrom", { n: message.editedFrom }) }}
    </p>
  </div>

  <div
    v-else
    class="group/message flex min-w-0 flex-col gap-2"
    data-test="assistant-message-assistant"
    :aria-busy="live ? 'true' : undefined"
    data-scroll-anchor
  >
    <div v-if="hasContent || live" class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <AssistantMark size="sm" />
      <OText variant="meta" class="leading-5">{{ t("assistant.name") }}</OText>
      <slot name="versions" />
      <span class="flex-1" />
    </div>
    <template v-for="item in rendered" :key="item.key">
      <!-- Inline-size containment keeps a 20k-character line from setting the transcript's width; layout and paint containment keep a filling part's repaint inside its block (Q1) -->
      <div
        v-if="item.kind === 'markdown'"
        class="flex min-w-0 flex-col gap-2 contain-inline-size contain-layout contain-paint [overflow-clip-margin:0.25rem]"
        :data-block-id="item.key"
        data-test="assistant-block-text"
      >
        <template v-for="part in item.parts" :key="part.key">
          <!-- A long run wraps at the `<wbr>` between text segments -->
          <AssistantMarkdownPart
            v-if="part.kind !== 'code'"
            :part="part"
            :html-class="PROSE"
            :text-class="PLAIN"
            :live="item.live"
          />
          <AssistantMarkdownCode
            v-else-if="fenceBlock(item.key, part)"
            :code="part.code"
            :weight="part.code.length"
            :live="item.live"
          >
            <AssistantQueryBlock
              :block="fenceBlock(item.key, part)!"
              :is-last="fenceBlock(item.key, part)!.blockId === lastQueryId"
              :readonly="readonly"
              :permissions="permissions"
              :sid="turn?.sid ?? null"
              :source-step="sourceStepOf(fenceBlock(item.key, part)!)"
              :turn-id="turn?.turnId"
              :openable="turn?.openable ?? true"
            />
          </AssistantMarkdownCode>
          <AssistantMarkdownCode
            v-else
            :code="part.code"
            :weight="part.code.length + (part.highlighted?.length ?? 0)"
            :live="item.live"
          >
            <OCodeBlock
              :code="part.code"
              :lang="part.lang"
              :highlight="false"
              :highlighted-html="part.highlighted"
              :copyable="!part.open"
              :scroll-label="t('assistant.message.codeName', { lang: codeLang(part.lang) })"
              :copy-button-class="TOUCH_TARGET_CLASS"
              contrast="aa"
              :copy-message="t('assistant.evidence.copied')"
              role="group"
              :aria-label="t('assistant.message.codeName', { lang: codeLang(part.lang) })"
              :data-query="part.query ? '' : undefined"
              data-test="assistant-code-block"
            />
          </AssistantMarkdownCode>
        </template>
        <AssistantInlineClaims
          v-if="item.claims.length && !item.live"
          :claims="item.claims"
          :numbers="claimMap"
          :available="claimAvailable"
          :label="claimLabel"
          :sid="turn?.sid ?? null"
          :readonly="readonly"
        />
      </div>
      <AssistantPolicyNotice
        v-else-if="item.kind === 'policy' && item.policy"
        :policy="item.policy"
        :block-id="item.key"
        :readonly="readonly"
        :turn="turn"
      />
      <OText
        v-else-if="item.kind === 'policy'"
        variant="meta"
        as="p"
        class="leading-5"
        data-test="assistant-block-policy"
      >
        {{ item.text }}
      </OText>
      <AssistantAttachmentBlock
        v-else-if="item.kind === 'attachment'"
        :name="item.name"
        :body="item.body"
        :hidden="item.hidden"
      />
      <AssistantQueryBlock
        v-else-if="item.kind === 'query'"
        :block="item.block"
        :is-last="item.block.blockId === lastQueryId"
        :readonly="readonly"
        :permissions="permissions"
        :sid="turn?.sid ?? null"
        :source-step="sourceStepOf(item.block)"
        :turn-id="turn?.turnId"
        :openable="turn?.openable ?? true"
      />
      <AssistantLinkCard
        v-else-if="item.kind === 'link'"
        :link="item.link"
        :source="item.source"
        :block-id="item.key"
        :sid="turn?.sid ?? null"
        :readonly="readonly"
        :copy-text="item.copyText"
        :openable="turn?.openable ?? true"
        :redacted="item.redacted"
      />
      <component
        :is="item.component"
        v-else-if="item.kind === 'registered'"
        :block="item.block"
        :block-id="item.key"
        :message="message"
        :readonly="readonly"
        :density="density"
        :turn="turn"
      />
    </template>
    <slot name="after" />
    <component
      :is="footerRenderer"
      v-if="footerRenderer && turn && !live"
      :block="FOOTER_BLOCK"
      :block-id="`${turnId}:footer`"
      :message="message"
      :readonly="readonly"
      :density="density"
      :turn="turn"
    />
    <div
      v-if="!live && (feedbackShown || $slots.actions)"
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    >
      <AssistantFeedback v-if="feedbackShown" :message="message" :turn="turn" />
      <slot name="actions" />
    </div>
  </div>
</template>

<script lang="ts">
import { markRaw, shallowReactive, type Component } from "vue";

import AssistantApprovalResult from "@/components/ai-assistant/approvals/AssistantApprovalResult.vue";
import AssistantPlanBlock from "@/components/ai-assistant/approvals/AssistantPlanBlock.vue";
import AssistantPolicyNotice from "@/components/ai-assistant/approvals/AssistantPolicyNotice.vue";
import AssistantConsentNote from "@/components/ai-assistant/credits/AssistantConsentNote.vue";
import AssistantFindings from "@/components/ai-assistant/evidence/AssistantFindings.vue";
import AssistantTurnFooter from "@/components/ai-assistant/evidence/AssistantTurnFooter.vue";
import type { AssistantTurnView, PolicyBlockData } from "@/composables/assistant/pure";
import type { BlockKind } from "@/services/assistantAnalytics";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";

import AssistantStepTrail from "./AssistantStepTrail.vue";

export interface AssistantMessageProps {
  message: ChatMessage;
  turnId: string;
  /** The turn is still running: no footer or actions, the last text block streams (`30` §2.2). */
  live?: boolean;
  readonly?: boolean;
  density?: "compact" | "roomy";
  /** The answer's turn: its session, prompt and outcome, for the evidence blocks. */
  turn?: AssistantTurnView | null;
}

// A decision's record replaces its card in place; the pending card itself renders in the container.
const BUILT_IN_RENDERERS: [string, Component][] = [
  ["trail", AssistantStepTrail],
  ["findings", AssistantFindings],
  ["footer", AssistantTurnFooter],
  ["approval", AssistantApprovalResult],
  ["approval_result", AssistantApprovalResult],
  ["plan", AssistantPlanBlock],
  ["policy", AssistantPolicyNotice],
  ["consent_note", AssistantConsentNote],
];

const TRAIL_BLOCK: ContentBlock = { type: "trail" };

const FOOTER_BLOCK: ContentBlock = { type: "footer" };

/** One renderer per block kind; the evidence kinds are built in and the approvals register their own. */
const renderers = shallowReactive(
  new Map<ContentBlock["type"] | string, Component>(
    BUILT_IN_RENDERERS.map(([kind, component]) => [kind, markRaw(component)]),
  ),
);

// The kinds `ai_block_invalid` can name; a legacy kind with no renderer (tool_call, navigation, status) is not invalid.
const COUNTED_KINDS: ReadonlySet<string> = new Set<BlockKind>([
  "approval",
  "approval_result",
  "plan",
  "findings",
  "query",
  "link",
  "policy",
  "attachment",
  "trail",
]);

const LANGUAGE_NAMES: Record<string, string> = {
  sql: "SQL",
  promql: "PromQL",
  vrl: "VRL",
  json: "JSON",
  yaml: "YAML",
  bash: "Bash",
  sh: "Shell",
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
};

const POLICY_CODES: ReadonlySet<string> = new Set(["permission_denied_tool", "data_level_blocked"]);

// A block counts once per page load, so a re-render never repeats the event.
const reported = new Set<string>();

const PROSE = [
  "min-w-0 text-sm leading-5 text-text-body break-words",
  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-5",
  "[&_li]:my-0.5 [&_blockquote]:border-s-2 [&_blockquote]:border-border-default [&_blockquote]:ps-3",
  "[&_blockquote]:text-text-secondary [&_hr]:my-3 [&_hr]:border-border-default [&_strong]:font-semibold",
].join(" ");

const PLAIN = "text-text-body min-w-0 text-sm leading-5 break-words whitespace-pre-wrap";

/** Lets a later package render its block kind; replaces an earlier registration of the same kind. */
export function registerBlockRenderer(
  kind: ContentBlock["type"] | string,
  component: Component,
): void {
  renderers.set(kind, markRaw(component));
}

/** Lets a spec start from the built-in kinds only; never called by app code. */
export function resetBlockRenderersForTests(): void {
  renderers.clear();
  for (const [kind, component] of BUILT_IN_RENDERERS) renderers.set(kind, markRaw(component));
  reported.clear();
}
</script>

<script setup lang="ts">
import { computed, inject, provide } from "vue";
import { useRouter } from "vue-router";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { chipGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantInlineClaims from "@/components/ai-assistant/evidence/AssistantInlineClaims.vue";
import AssistantLinkCard from "@/components/ai-assistant/evidence/AssistantLinkCard.vue";
import AssistantQueryBlock, {
  type QueryBlock,
} from "@/components/ai-assistant/evidence/AssistantQueryBlock.vue";
import { claimNumbersKey, stepCitation } from "@/components/ai-assistant/evidence/evidenceText";
import {
  assistantEvidenceHostKey,
  claimNumbers,
  fenceQuery,
  footerOf,
  rebuildMarkdownTarget,
  buildNavigationRoute,
  parseAttachmentBlocks,
  promptRange,
  stepsOf,
  toolLinksOf,
  type LinkTarget,
} from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ImageAttachment } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgRange, formatOrgTime } from "@/utils/formatters";

import AssistantAttachmentBlock from "./AssistantAttachmentBlock.vue";
import AssistantFeedback from "./AssistantFeedback.vue";
import {
  AssistantMarkdownCode,
  AssistantMarkdownPart,
  useRenderedMarkdown,
  type MarkdownPart,
} from "./markdown";

type Rendered =
  | { kind: "markdown"; key: string; parts: MarkdownPart[]; live: boolean; claims: string[] }
  | { kind: "policy"; key: string; text: I18nText; policy: PolicyBlockData | null }
  | { kind: "attachment"; key: string; name: string; body: string; hidden?: boolean }
  | { kind: "query"; key: string; block: QueryBlock }
  | {
      kind: "link";
      key: string;
      link: LinkTarget | null;
      source: "navigation" | "tool" | "markdown";
      copyText: string | null;
      redacted?: boolean;
    }
  | { kind: "registered"; key: string; component: Component; block: ContentBlock };

const props = withDefaults(defineProps<AssistantMessageProps>(), {
  live: false,
  readonly: false,
  density: "compact",
  turn: null,
});

const { t } = useI18nTyped();
const router = useRouter();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const renderMarkdown = useRenderedMarkdown();

const blocks = computed(() => props.message.contentBlocks ?? []);

// A record from before the v2 composer has its blocks in the text; a v2 message keeps typed text and chips apart.
const legacyUser = computed(() =>
  props.message.role === "user" && props.message.sentAt === undefined
    ? parseAttachmentBlocks(String(props.message.content ?? ""))
    : null,
);

const userText = computed(() => legacyUser.value?.text ?? String(props.message.content ?? ""));

const attachments = computed<{ name: string; body: string; hidden?: boolean }[]>(() => [
  ...blocks.value
    .filter((block) => block.type === "attachment" && block.attachment)
    .map((block) => block.attachment!),
  ...(legacyUser.value?.blocks ?? []).map((block) => ({ name: block.name, body: block.body })),
]);

const chips = computed(() => props.message.chips ?? []);
const images = computed<ImageAttachment[]>(() => props.message.images ?? []);

const userMeta = computed<I18nText>(() => {
  const who = props.message.author ? raw(props.message.author) : t("assistant.message.you");
  const at = props.message.sentAt;
  if (at === undefined) return who;
  return t("assistant.message.meta", { who, time: formatOrgTime(at, { showZone: true }) });
});

const rerunRange = computed(() => {
  const window = props.message.rerunFor;
  return window ? raw(formatOrgRange(window.from, window.to)) : raw("");
});

const lastTextIndex = computed(() => {
  for (let i = blocks.value.length - 1; i >= 0; i--) if (blocks.value[i].type === "text") return i;
  return -1;
});

const org = computed(() => props.turn?.org ?? "");
const steps = computed(() =>
  props.message.role === "assistant" ? stepsOf(props.message, org.value) : [],
);
const pageRange = computed(() => promptRange(props.turn?.prompt, props.turn?.askedWindow));
// Viewers lose the drafts; an unknown permission still shows them.
const permissions = computed(() => {
  const canWrite = evidence?.capability().canWrite;
  return canWrite === "no" ? { dashboardCreate: false, alertCreate: false } : {};
});

// Blocks in reducer order, each keyed by its id so a completed one is never re-parsed (EB-01 AC 4).
const rendered = computed<Rendered[]>(() => {
  const out: Rendered[] = [];
  const links = new Set<string>();
  const trail = renderers.get("trail");
  if (trail && steps.value.length)
    out.push({
      kind: "registered",
      key: `${props.turnId}:trail`,
      component: trail,
      block: TRAIL_BLOCK,
    });
  blocks.value.forEach((block, index) => out.push(...renderBlock(block, index, links)));
  toolLinksOf(props.message).forEach((action, index) => {
    const link = buildNavigationRoute(action, org.value);
    pushLink(out, links, {
      kind: "link",
      key: `${props.turnId}:tool${index}`,
      link,
      source: "tool",
      copyText: null,
    });
  });
  return out;
});

function renderBlock(block: ContentBlock, index: number, links: Set<string>): Rendered[] {
  const key = `${props.turnId}:${index}`;
  if (block.type === "footer" || block.type === "tool_call") {
    return block.type === "tool_call" && POLICY_CODES.has(block.errorType ?? "")
      ? [{ kind: "policy", key, text: policyText(block), policy: deniedPolicy(block) }]
      : [];
  }
  if (block.type === "query" && block.query)
    return [
      {
        kind: "query",
        key,
        block: {
          blockId: key,
          query: { ...block.query, org: org.value },
          rangeSource: "turn",
          ...(block.query.callId && { sourceCallId: block.query.callId }),
        },
      },
    ];
  if (block.type === "link" && block.link?.redacted)
    return [
      { kind: "link", key, link: null, source: "navigation", copyText: null, redacted: true },
    ];
  if (block.type === "link" && block.link) {
    const link = buildNavigationRoute(
      {
        resource_type: block.link.resourceType,
        action: block.link.action,
        target: block.link.target,
      },
      org.value,
    );
    const query = block.link.target.query;
    const out: Rendered[] = [];
    pushLink(out, links, {
      kind: "link",
      key,
      link,
      source: "navigation",
      copyText: typeof query === "string" ? query : null,
    });
    return out;
  }
  const custom = renderers.get(block.type);
  if (custom && block.type !== "trail")
    return [{ kind: "registered", key, component: custom, block }];
  if (block.type === "text") {
    if (!block.text?.trim()) return [];
    const open = props.live && index === lastTextIndex.value;
    const result = renderMarkdown(key, block.text, open ? "open" : "closed");
    const out: Rendered[] = [
      { kind: "markdown", key, parts: result.parts, live: open, claims: result.claims },
    ];
    // Links in the answer become cards only for allowlisted routes, after the text that names them.
    if (!open)
      result.links.forEach((href, n) => {
        const link = markdownTarget(href);
        if (link)
          pushLink(out, links, {
            kind: "link",
            key: `${key}:link${n}`,
            link,
            source: "markdown",
            copyText: null,
          });
      });
    return out;
  }
  if (block.type === "attachment" && block.attachment)
    return [{ kind: "attachment", key, ...block.attachment }];
  if (COUNTED_KINDS.has(block.type) && !reported.has(key)) {
    reported.add(key);
    trackAssistant("ai_block_invalid", { block_kind: block.type as BlockKind });
  }
  return [];
}

// One card per destination, whatever proposed it.
function pushLink(
  out: Rendered[],
  seen: Set<string>,
  item: Extract<Rendered, { kind: "link" }>,
): void {
  const route = item.link?.route;
  const id = route
    ? `${item.link?.kind}:${route.name}:${JSON.stringify(route.params ?? {})}:${JSON.stringify({ ...route.query, t: undefined, org_identifier: undefined })}`
    : `unsupported:${item.key}`;
  if (seen.has(id)) return;
  seen.add(id);
  out.push(item);
}

function markdownTarget(href: string): LinkTarget | null {
  if (!router) return null;
  const base = (router.options.history.base ?? "").replace(/\/$/, "");
  const path = base && href.startsWith(`${base}/`) ? href.slice(base.length) : href;
  try {
    const resolved = router.resolve(path);
    return resolved.matched.length ? rebuildMarkdownTarget(resolved) : null;
  } catch {
    return null;
  }
}

const claimMap = computed(() =>
  claimNumbers([
    ...rendered.value.flatMap((item) => (item.kind === "markdown" ? item.claims : [])),
    ...blocks.value.flatMap((block) =>
      (block.findings?.evidence ?? []).flatMap((item) => (item.callId ? [item.callId] : [])),
    ),
  ]),
);

provide(claimNumbersKey, claimMap);

const lastQueryId = computed(() => {
  let last: string | null = null;
  for (const item of rendered.value) {
    if (item.kind === "query") last = item.block.blockId;
    if (item.kind === "markdown")
      for (const part of item.parts) {
        const fence = part.kind === "code" ? fenceBlock(item.key, part) : null;
        if (fence) last = fence.blockId;
      }
  }
  return last;
});

const feedbackShown = computed(
  () =>
    !props.readonly &&
    !!props.turn?.sid &&
    (props.turn.outcome === "done" || props.turn.outcome === "done_not_saved") &&
    !!footerOf(props.message),
);

const fences = new Map<string, QueryBlock | null>();

// A closed SQL, PromQL or VRL fence is a runnable block; an open one streams as code.
function fenceBlock(key: string, part: MarkdownPart): QueryBlock | null {
  if (part.kind !== "code" || part.open || !part.query || props.message.role !== "assistant")
    return null;
  const blockId = `${key}:${part.key}`;
  const memo = `${blockId}\u0000${part.code.length}\u0000${steps.value.length}\u0000${org.value}`;
  if (fences.has(memo)) return fences.get(memo)!;
  const fence = fenceQuery(part.code, part.lang, steps.value, org.value, pageRange.value);
  const block: QueryBlock | null = fence
    ? {
        blockId,
        query: fence.query,
        rangeSource: fence.rangeSource,
        ...(fence.sourceStep && { sourceCallId: fence.sourceStep.callId }),
      }
    : null;
  fences.set(memo, block);
  return block;
}

function sourceStepOf(block: QueryBlock): number | null {
  return steps.value.find((step) => step.callId === block.sourceCallId)?.n ?? null;
}

function claimAvailable(callId: string): boolean {
  return !props.turn?.hiddenByOwner && steps.value.some((step) => step.callId === callId);
}

function claimLabel(callId: string): I18nText {
  const step = steps.value.find((candidate) => candidate.callId === callId);
  return step ? stepCitation(step, t) : t("assistant.claim.notAvailable");
}

const footerRenderer = computed(() =>
  props.message.role === "assistant" ? (renderers.get("footer") ?? null) : null,
);

const hasContent = computed(() => rendered.value.length > 0);

// A tool the policy blocked is a notice with the server's detail; a data-sharing block keeps its own line.
function deniedPolicy(block: ContentBlock): PolicyBlockData | null {
  if (block.errorType !== "permission_denied_tool") return null;
  const details = block.details ?? {};
  return {
    kind: "denied",
    tool: block.tool ?? "",
    ...(typeof details.detail === "string" && { detail: details.detail }),
    ...(typeof details.policy === "string" && { policy: details.policy }),
  };
}

function policyText(block: ContentBlock): I18nText {
  const tool = raw(block.tool ?? "");
  return block.errorType === "data_level_blocked"
    ? t("assistant.error.data_level_blocked.title")
    : t("assistant.error.permission_denied_tool.title", { tool });
}

function codeLang(lang: string): I18nText {
  return lang === "plaintext" ? t("common.plainText") : raw(LANGUAGE_NAMES[lang] ?? lang);
}

function dataUrl(image: ImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}
</script>
