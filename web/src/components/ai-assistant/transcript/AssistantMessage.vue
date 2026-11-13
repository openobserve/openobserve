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
    class="group/message flex min-w-0 flex-col items-end gap-1"
    data-test="assistant-message-user"
    data-scroll-anchor
  >
    <p
      v-if="userText"
      class="bg-assistant-user-bg rounded-ee-default text-text-body rounded-chat-bubble max-w-[80%] min-w-0 px-3.5 py-2 text-sm break-words whitespace-pre-wrap"
      data-test="assistant-message-text"
    >
      {{ userText }}
    </p>
    <div v-if="attachments.length" class="flex w-full min-w-0 flex-col gap-1.5">
      <AssistantAttachmentBlock
        v-for="(block, index) in attachments"
        :key="`${turnId}:a${index}`"
        :name="block.name"
        :body="block.body"
        :hidden="block.hidden"
      />
    </div>
    <ul
      v-if="images.length"
      class="flex flex-wrap justify-end gap-1.5"
      data-test="assistant-message-images"
    >
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
    <OText
      v-if="rangeLabel || userMeta"
      variant="meta"
      as="p"
      class="max-w-full min-w-0 text-end break-words"
      data-test="assistant-message-meta"
    >
      <span v-if="rangeLabel" data-test="assistant-message-range">
        {{ rangeLabel }}<template v-if="userMeta"> ·</template>
      </span>
      {{ userMeta }}
    </OText>
    <OText
      v-if="sentChips.length"
      variant="meta"
      as="p"
      class="flex max-w-full min-w-0 items-center justify-end gap-1 break-words"
      data-test="assistant-message-chips"
    >
      <OIcon :name="chipGlyph[sentChips[0].kind]" size="xs" aria-hidden="true" />
      <span class="min-w-0">{{ sentContext }}</span>
    </OText>
    <p
      v-if="message.rerunFor"
      class="text-text-secondary text-end text-xs leading-5"
      data-test="assistant-message-rerun"
    >
      {{ t("assistant.footer.rerunFor", { range: rerunRange }) }}
    </p>
    <p
      v-if="message.editedFrom"
      class="text-text-secondary text-end text-xs leading-5"
      data-test="assistant-message-edited"
    >
      {{ t("assistant.message.editedFrom", { n: message.editedFrom }) }}
    </p>
    <!-- The row keeps its height while hidden, so hovering a message never moves the transcript -->
    <div
      v-if="$slots.actions || (answerTime && !userMeta)"
      class="flex min-h-6 items-center justify-end gap-1"
      data-test="assistant-message-user-line"
    >
      <slot name="actions" />
      <OText
        v-if="answerTime && !userMeta"
        variant="meta"
        as="span"
        class="shrink-0 whitespace-nowrap opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100"
        data-test="assistant-message-user-time"
      >
        {{ answerTime }}
      </OText>
    </div>
  </div>

  <div
    v-else
    class="group/message flex min-w-0 flex-col gap-2"
    data-test="assistant-message-assistant"
    :aria-busy="live ? 'true' : undefined"
    data-scroll-anchor
  >
    <div
      v-if="head || agent !== DEFAULT_AGENT || $slots.versions"
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      data-test="assistant-message-head"
    >
      <AssistantAgentIdentity v-if="head || agent !== DEFAULT_AGENT" size="meta" :agent="agent" />
      <slot name="versions" />
    </div>
    <slot name="status" />
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
            :html-class="PROSE_CLASSES.html"
            :text-class="PROSE_CLASSES.plain"
            :lead="item.key === leadKey && part.key === item.parts[0]?.key"
            :live="item.live"
            :org="org"
            :openable="entitiesOpenable"
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
              :lang="String(codeLang(part.lang))"
              :highlight="false"
              wrap
              padded
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
    <AssistantChartCard
      v-if="answerChart"
      :chart="answerChart.chart"
      :query="answerChart.query"
      :sid="turn?.sid ?? null"
      :turn-id="turn?.turnId"
      :readonly="readonly"
    />
    <slot name="after" />
    <AssistantQueriesGroup
      v-if="!live"
      :message="message"
      :readonly="readonly"
      :turn="turn"
      :unavailable="unavailableClaims"
    >
      <template #line-end>
        <div
          :class="[
            'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 empty:hidden',
            !steps.length &&
              $slots.actions &&
              'md:pointer-fine:[&>[data-test=assistant-msg-actions]]:-ms-1.5',
          ]"
          data-test="assistant-answer-line"
        >
          <slot name="actions" />
          <OText
            v-if="answerTime"
            variant="meta"
            as="span"
            class="ms-auto shrink-0 whitespace-nowrap"
            data-test="assistant-answer-time"
          >
            {{ answerTime }}
          </OText>
          <AssistantAnswerMeta
            v-if="!hasFindings"
            :message="message"
            :turn="turn"
            :readonly="readonly"
          />
          <component
            :is="footerRenderer"
            v-if="footerRenderer && turn"
            :block="FOOTER_BLOCK"
            :block-id="`${turnId}:footer`"
            :message="message"
            :readonly="readonly"
            :density="density"
            :turn="turn"
          />
        </div>
      </template>
    </AssistantQueriesGroup>
    <slot name="follow-ups" />
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
import type { AgentId, AssistantTurnView, PolicyBlockData } from "@/composables/assistant/pure";
import type { BlockKind } from "@/services/assistantAnalytics";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";

export interface AssistantMessageProps {
  message: ChatMessage;
  turnId: string;
  /** The turn is still running: no footer or actions, the last text block streams (`30` §2.2). */
  live?: boolean;
  readonly?: boolean;
  density?: "compact" | "roomy";
  /** The answer's turn: its session, prompt and outcome, for the evidence blocks. */
  turn?: AssistantTurnView | null;
  /** The agent that answered this turn; a chat or server without agents reads as the default one. */
  agent?: AgentId;
  /** The question line's "Last 1 h"; the last turn only, the older ones keep the hour. */
  rangeLabel?: I18nText | null;
  /** The mark and agent name above an answer; only the first answer of a run carries it. */
  head?: boolean;
}

// A decision's record replaces its card in place; the pending card itself renders in the container.
const BUILT_IN_RENDERERS: [string, Component][] = [
  ["findings", AssistantFindings],
  ["footer", AssistantTurnFooter],
  ["approval", AssistantApprovalResult],
  ["approval_result", AssistantApprovalResult],
  ["plan", AssistantPlanBlock],
  ["policy", AssistantPolicyNotice],
  ["consent_note", AssistantConsentNote],
];

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

// The server cuts a ```findings fence out of the prose but leaves the label the model wrote above it.
const FINDINGS_LABEL = /[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*|__)?Findings:?(?:\*\*|__)?:?\s*$/i;

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

import AssistantAgentIdentity from "@/components/ai-assistant/agents/AssistantAgentIdentity.vue";
import { chipGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantAnswerMeta from "@/components/ai-assistant/evidence/AssistantAnswerMeta.vue";
import AssistantChartCard from "@/components/ai-assistant/evidence/AssistantChartCard.vue";
import { chartOf } from "@/components/ai-assistant/evidence/chartSeries";
import AssistantInlineClaims from "@/components/ai-assistant/evidence/AssistantInlineClaims.vue";
import AssistantLinkCard from "@/components/ai-assistant/evidence/AssistantLinkCard.vue";
import AssistantQueriesGroup from "@/components/ai-assistant/evidence/AssistantQueriesGroup.vue";
import AssistantQueryBlock, {
  type QueryBlock,
} from "@/components/ai-assistant/evidence/AssistantQueryBlock.vue";
import { citationName, claimNumbersKey } from "@/components/ai-assistant/evidence/evidenceText";
import {
  DEFAULT_AGENT,
  agentName,
  assistantEvidenceHostKey,
  claimNumbers,
  fenceQuery,
  rebuildMarkdownTarget,
  buildNavigationRoute,
  parseAttachmentBlocks,
  promptRange,
  stepsOf,
  toolLinksOf,
  type LinkTarget,
  type QueryBlockData,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ImageAttachment } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgRange, formatOrgTime } from "@/utils/formatters";

import { decisionsAfterProposal } from "@/components/ai-assistant/approvals/approvalPlacement";

import AssistantAttachmentBlock from "./AssistantAttachmentBlock.vue";
import { PROSE_CLASSES } from "./markdownCore";
import { splitFollowUps } from "./followUpsText";
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
  agent: "o2-ai",
  rangeLabel: null,
  head: false,
});

const { t } = useI18nTyped();
const router = useRouter();

const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const renderMarkdown = useRenderedMarkdown();

// A record from before typed blocks keeps its answer only in `content`.
const blocks = computed<ContentBlock[]>(() => {
  const { role, content, contentBlocks } = props.message;
  if (contentBlocks?.length || role !== "assistant" || !content) return contentBlocks ?? [];
  return [{ type: "text", text: String(content) }];
});

// Follow-ups the model typed into its prose leave the text; the transcript shows them as chips.
const unfencedBlocks = computed<ContentBlock[]>(() => {
  const last = blocks.value.findLastIndex((block) => block.type === "text");
  const text = blocks.value[last]?.text;
  if (!text) return blocks.value;
  const split = splitFollowUps(text);
  if (!split.items.length) return blocks.value;
  return blocks.value.map((block, i) => (i === last ? { ...block, text: split.text } : block));
});

const baseBlocks = computed<ContentBlock[]>(() =>
  unfencedBlocks.value.some((block) => block.type === "findings")
    ? unfencedBlocks.value.map((block) =>
        block.type === "text" && block.text
          ? { ...block, text: withoutFindingsLabel(block.text) }
          : block,
      )
    : unfencedBlocks.value,
);

// The decision follows the "I proposed …" text it answers; the model's words stay as written.
const shownBlocks = computed<ContentBlock[]>(() => decisionsAfterProposal(baseBlocks.value));

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

// The page's own context is the default, so only what the reader added is worth a line.
const sentChips = computed(() =>
  (props.message.chips ?? []).filter((chip) => chip.kind !== "time" && chip.provenance !== "page"),
);
const sentContext = computed(() => raw(sentChips.value.map((chip) => chip.label).join(" · ")));
const images = computed<ImageAttachment[]>(() => props.message.images ?? []);

// The hour sits on the answer line; a handoff keeps it as the start of its "to agent" line.
const userMeta = computed<I18nText | null>(() => {
  const who = props.message.author ? raw(props.message.author) : null;
  const { handoffFrom, agentId } = props.message;
  if (!handoffFrom || !agentId) return who;
  const at = props.message.sentAt;
  const meta = who ?? (at === undefined ? raw("") : raw(formatOrgTime(at)));
  return t("assistant.message.metaHandoff", { meta, agent: agentName(agentId, t) });
});

// An answer record carries no time of its own, so it shows when its question was sent.
const answerTime = computed<I18nText | null>(() => {
  const at = props.message.sentAt ?? props.turn?.prompt?.sentAt;
  return at === undefined ? null : raw(formatOrgTime(at));
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
// An entity link follows the link cards' gates: a chat of another org would open its targets in this one.
const entitiesOpenable = computed(() => {
  const current = evidence?.currentOrg();
  return (props.turn?.openable ?? true) && !(current && org.value && current !== org.value);
});
const steps = computed(() =>
  props.message.role === "assistant" ? stepsOf(props.message, org.value) : [],
);
// A reloaded turn has no series (the server keeps none), so its last PromQL step offers Show chart instead.
const answerChart = computed(() => {
  if (props.message.role !== "assistant" || props.live) return null;
  const found = chartOf(props.message);
  if (found) {
    const callId = found.step?.call_id;
    const step = callId ? steps.value.find((candidate) => candidate.callId === callId) : null;
    return { chart: found.chart, query: step?.query ?? null };
  }
  const promql = steps.value.findLast(
    (step) => step.kind === "promql" && step.state === "done" && !!step.query,
  );
  return promql?.query ? { chart: null, query: promql.query } : null;
});
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
  // The conclusion leads the answer wherever its frame landed among the text.
  const shown = shownBlocks.value;
  // Keys follow each block's reducer position, so a moved record keeps its node and no text is parsed again.
  const keyOf = (block: ContentBlock, at: number) => {
    const own = baseBlocks.value.indexOf(block);
    return own >= 0 ? own : at;
  };
  const findingsIndex = shown.findIndex((block) => block.type === "findings");
  if (findingsIndex >= 0)
    out.push(
      ...renderBlock(shown[findingsIndex], keyOf(shown[findingsIndex], findingsIndex), links),
    );
  shown.forEach((block, index) => {
    if (index !== findingsIndex) out.push(...renderBlock(block, keyOf(block, index), links));
  });
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
  return withoutCardedLinks(out);
});

// A navigation link to a query the answer also shows as a card would be a second Open for the same query.
function withoutCardedLinks(items: Rendered[]): Rendered[] {
  const carded = new Set<string>();
  for (const item of items) {
    if (item.kind === "query") carded.add(queryKey(item.block.query.text));
    if (item.kind === "markdown")
      for (const part of item.parts)
        if (part.kind === "code" && part.query && !part.open) carded.add(queryKey(part.code));
  }
  if (!carded.size) return items;
  return items.filter(
    (item) =>
      item.kind !== "link" ||
      item.source !== "navigation" ||
      !item.copyText ||
      !carded.has(queryKey(item.copyText)),
  );
}

function queryKey(text: string): string {
  return text.trim().replace(/;\s*$/, "").replace(/\s+/g, " ").toLowerCase();
}

function renderBlock(block: ContentBlock, index: number, links: Set<string>): Rendered[] {
  const key = `${props.turnId}:${index}`;
  if (block.type === "follow_ups") return [];
  if (block.type === "footer" || block.type === "tool_call") {
    return block.type === "tool_call" && POLICY_CODES.has(block.errorType ?? "")
      ? [{ kind: "policy", key, text: policyText(block), policy: deniedPolicy(block) }]
      : [];
  }
  if (block.type === "query" && block.query)
    return [{ kind: "query", key, block: typedQueryBlock(key, block.query) }];
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
  if (custom) return [{ kind: "registered", key, component: custom, block }];
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

// Only a line that is nothing but the label, and only as the last line of its text block.
function withoutFindingsLabel(text: string): string {
  const match = FINDINGS_LABEL.exec(text);
  if (!match) return text;
  const before = text.slice(0, match.index);
  return before === "" || before.endsWith("\n") ? before : text;
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
    return resolved.matched.length ? rebuildMarkdownTarget(resolved, org.value) : null;
  } catch {
    return null;
  }
}

const hasFindings = computed(() => blocks.value.some((block) => block.type === "findings"));

// With no findings the first text is the conclusion.
const leadKey = computed(() => {
  if (hasFindings.value) return null;
  const first = rendered.value[0];
  return first?.kind === "markdown" ? first.key : null;
});

// A citation's number is its row in the queries list; a claim on a step this view lacks comes after them.
const claimMap = computed(() =>
  claimNumbers([
    ...steps.value.map((step) => step.callId),
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

// The stored query frame names no window, so it takes the one its fence would: the step that ran it, else the turn's.
function typedQueryBlock(blockId: string, typed: QueryBlockData): QueryBlock {
  const own = { ...typed, org: org.value };
  const fence =
    own.from && own.to
      ? null
      : fenceQuery(own.text, own.language, steps.value, org.value, pageRange.value);
  const { from, to } = fence?.query ?? {};
  return {
    blockId,
    query: from && to ? { ...own, from, to } : own,
    rangeSource: fence?.rangeSource ?? "turn",
    ...(typed.callId && { sourceCallId: typed.callId }),
  };
}

function sourceStepOf(block: QueryBlock): number | null {
  return steps.value.find((step) => step.callId === block.sourceCallId)?.n ?? null;
}

function claimAvailable(callId: string): boolean {
  return !props.turn?.hiddenByOwner && steps.value.some((step) => step.callId === callId);
}

// A write behind its card is in this answer but lists no step, so citing it is no access gap for an admin to fix.
function heldWithoutStep(callId: string): boolean {
  return (
    !props.turn?.hiddenByOwner &&
    blocks.value.some((block) => block.call_id === callId || block.approval?.id === callId)
  );
}

function claimLabel(callId: string): I18nText {
  const step = steps.value.find((candidate) => candidate.callId === callId);
  return step
    ? citationName(claimMap.value.get(callId) ?? step.n, step, t)
    : t("assistant.claim.notAvailable");
}

const unavailableClaims = computed(() => {
  const claims = [
    ...rendered.value.flatMap((item) => (item.kind === "markdown" ? item.claims : [])),
    ...blocks.value.flatMap((block) =>
      (block.findings?.evidence ?? []).flatMap((item) => (item.callId ? [item.callId] : [])),
    ),
  ];
  return new Set(claims.filter((callId) => !claimAvailable(callId) && !heldWithoutStep(callId)))
    .size;
});

const footerRenderer = computed(() =>
  props.message.role === "assistant" ? (renderers.get("footer") ?? null) : null,
);

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
