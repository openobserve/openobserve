<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { NavigationAction } from "@/ts/interfaces/chat";
import {
  formatTimestamp as formatToolCallTimestamp,
  formatToolCallMessage as formatToolCall,
  getToolCallDisplayData,
  hasToolCallDetails,
  type ToolCallBlock,
} from "@/components/O2AIChat.toolcall";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  block: ToolCallBlock;
  messageIndex: number;
  blockIndex: number;
  expandedKeys: Set<string>;
}>();

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "navigate", action: NavigationAction): void;
}>();

const { t } = useI18nTyped();

// Positional key shape must match the shell's toggleToolCallExpanded.
const isExpanded = computed(() =>
  props.expandedKeys.has(`${props.messageIndex}-${props.blockIndex}`),
);

const formatToolCallMessage = (block: ToolCallBlock) => formatToolCall(block, t);

const formatTimestamp = (timestamp: number) => formatToolCallTimestamp(timestamp, t);
</script>

<template>
  <div
    class="tool-call-item text-text-secondary rounded-default text-compact mb-2 flex max-w-full min-w-0 flex-col px-3 py-2"
    :class="[
      { 'has-details': hasToolCallDetails(block) },
      {
        error: block.success === false && !block.pendingConfirmation,
      },
      {
        'pending-confirmation': block.pendingConfirmation && block.tool !== 'navigation_action',
      },
      {
        'pending-navigation': block.pendingConfirmation && block.tool === 'navigation_action',
      },
    ]"
    @click="hasToolCallDetails(block) && !block.pendingConfirmation && emit('toggle')"
  >
    <div class="tool-call-header flex items-center gap-2">
      <OIcon
        :name="
          block.pendingConfirmation
            ? block.tool === 'navigation_action'
              ? 'open-in-new'
              : 'help-outline'
            : block.success === false
              ? 'error'
              : 'check-circle'
        "
        size="sm"
        :class="
          block.pendingConfirmation
            ? block.tool === 'navigation_action'
              ? 'text-accent'
              : 'text-warning'
            : block.success === false
              ? 'text-status-negative'
              : 'text-status-positive'
        "
      />
      <span class="tool-call-name flex-1 font-medium">
        {{ formatToolCallMessage(block).text
        }}<strong v-if="formatToolCallMessage(block).highlight">{{
          formatToolCallMessage(block).highlight
        }}</strong
        >{{ formatToolCallMessage(block).suffix }}
      </span>
      <!-- Navigation icon -->
      <OIcon
        v-if="block.navigationAction && !block.pendingConfirmation"
        name="open-in-new"
        size="xs"
        class="navigation-icon ms-auto cursor-pointer opacity-70 transition-opacity duration-200 hover:opacity-100"
        @click.stop="emit('navigate', block.navigationAction)"
      >
        <OTooltip :content="block.navigationAction.label" />
      </OIcon>
      <OIcon
        v-if="hasToolCallDetails(block) && !block.pendingConfirmation"
        :name="isExpanded ? 'expand-less' : 'expand-more'"
        size="sm"
        class="expand-icon opacity-60 transition-transform duration-200"
      />
    </div>
    <!-- Expandable details -->
    <div
      v-if="isExpanded"
      class="tool-call-details border-border-default mt-2.5 flex min-w-0 flex-col gap-2 border-t pt-2.5"
      @click.stop
    >
      <!-- Error details for failed tool calls -->
      <template v-if="block.success === false">
        <div v-if="block.resultMessage" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("common.error")
          }}</span>
          <span
            class="detail-value text-status-negative max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.resultMessage }}</span
          >
        </div>
        <div v-if="block.errorType" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("common.type")
          }}</span>
          <code
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.errorType }}</code
          >
        </div>
        <div v-if="block.suggestion" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.suggestion")
          }}</span>
          <span
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words italic opacity-85 select-text"
            >{{ block.suggestion }}</span
          >
        </div>
      </template>
      <!-- Summary details for successful tool calls with summary -->
      <template v-if="block.success !== false && block.summary">
        <div v-if="block.summary.count !== undefined" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.results")
          }}</span>
          <span
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.summary.count }} {{ t("aiAssistant.recordsSuffix") }}</span
          >
        </div>
        <div v-if="block.summary.took !== undefined" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("common.duration")
          }}</span>
          <span
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.summary.took }}{{ t("aiAssistant.ms") }}</span
          >
        </div>
        <!-- CLI tool summary (return_code / stdout_lines / stderr_lines / truncated) -->
        <div v-if="block.summary.return_code !== undefined" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.exitCode")
          }}</span>
          <code
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.summary.return_code }}</code
          >
        </div>
        <div
          v-if="block.summary.stdout_lines !== undefined"
          class="detail-item flex flex-col gap-1"
        >
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.stdout")
          }}</span>
          <span
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.summary.stdout_lines }} {{ t("aiAssistant.lines") }}</span
          >
        </div>
        <div v-if="block.summary.stderr_lines" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.stderr")
          }}</span>
          <span
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ block.summary.stderr_lines }} {{ t("aiAssistant.lines") }}</span
          >
        </div>
        <div v-if="block.summary.truncated" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("common.output")
          }}</span>
          <span
            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
            >{{ t("aiAssistant.truncatedLabel") }}</span
          >
        </div>
      </template>
      <!-- Existing context details -->
      <div
        v-if="getToolCallDisplayData(block.context)?.query"
        class="detail-item flex flex-col gap-1"
      >
        <div class="detail-header flex items-center justify-between">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("common.query")
          }}</span>
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            class="copy-btn opacity-60 hover:opacity-100"
            @click.stop="copyToClipboard(getToolCallDisplayData(block.context)?.query, t)"
          >
            <OIcon name="content-copy" size="sm" />
            <OTooltip :content="t('aiAssistant.copyQuery')" />
          </OButton>
        </div>
        <code
          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >{{ getToolCallDisplayData(block.context)?.query }}</code
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.stream"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("aiAssistant.stream")
        }}</span>
        <code
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ getToolCallDisplayData(block.context)?.stream }}</code
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.type"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("common.type")
        }}</span>
        <code
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ getToolCallDisplayData(block.context)?.type }}</code
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.start_time"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("aiAssistant.start")
        }}</span>
        <span
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ formatTimestamp(getToolCallDisplayData(block.context)?.start_time) }}</span
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.end_time"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("aiAssistant.end")
        }}</span>
        <span
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ formatTimestamp(getToolCallDisplayData(block.context)?.end_time) }}</span
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.from !== undefined"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("aiAssistant.from")
        }}</span>
        <span
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ getToolCallDisplayData(block.context)?.from }}</span
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.size !== undefined"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("aiAssistant.size")
        }}</span>
        <span
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ getToolCallDisplayData(block.context)?.size }}</span
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.query_type"
        class="detail-item flex flex-col gap-1"
      >
        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
          t("aiAssistant.queryType")
        }}</span>
        <code
          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
          >{{ getToolCallDisplayData(block.context)?.query_type }}</code
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.vrl"
        class="detail-item flex flex-col gap-1"
      >
        <div class="detail-header flex items-center justify-between">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.welcome.taglineVrl")
          }}</span>
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            class="copy-btn opacity-60 hover:opacity-100"
            @click.stop="copyToClipboard(getToolCallDisplayData(block.context)?.vrl, t)"
          >
            <OIcon name="content-copy" size="sm" />
            <OTooltip :content="t('aiAssistant.copyVrl')" />
          </OButton>
        </div>
        <code
          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >{{ getToolCallDisplayData(block.context)?.vrl }}</code
        >
      </div>
      <div
        v-if="getToolCallDisplayData(block.context)?.command"
        class="detail-item flex flex-col gap-1"
      >
        <div class="detail-header flex items-center justify-between">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.command")
          }}</span>
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            class="copy-btn opacity-60 hover:opacity-100"
            @click.stop="copyToClipboard(getToolCallDisplayData(block.context)?.command, t)"
          >
            <OIcon name="content-copy" size="sm" />
            <OTooltip :content="t('aiAssistant.copyCommand')" />
          </OButton>
        </div>
        <code
          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >{{ getToolCallDisplayData(block.context)?.command }}</code
        >
      </div>
      <!-- Tool response: SearchSQL hits -->
      <template v-if="block.response && block.response.hits">
        <div class="detail-item flex flex-col gap-1">
          <div class="detail-header flex items-center justify-between">
            <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
              t("aiAssistant.results")
            }}</span>
            <OButton
              variant="ghost"
              size="icon-xs-circle"
              class="copy-btn opacity-60 hover:opacity-100"
              @click.stop="copyToClipboard(JSON.stringify(block.response.hits, null, 2), t)"
            >
              <OIcon name="content-copy" size="sm" />
              <OTooltip :content="t('aiAssistant.copyResults')" />
            </OButton>
          </div>
          <div
            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >
            <div
              v-for="(hit, hIdx) in block.response.hits"
              :key="hIdx"
              class="tool-response-hit [&:not(:last-child)]:border-border-default flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
            >
              <span
                v-for="(val, key) in hit"
                :key="key"
                class="hit-field cursor-text break-all select-text"
              >
                <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                {{ val }}
              </span>
            </div>
          </div>
        </div>
        <div class="tool-response-meta mt-1 flex flex-wrap gap-1.5">
          <span v-if="block.response.total !== undefined" class="context-tag"
            >{{ t("aiAssistant.total") }} {{ block.response.total }}</span
          >
          <span v-if="block.response.took !== undefined" class="context-tag"
            >{{ t("aiAssistant.took") }} {{ block.response.took }}{{ t("aiAssistant.ms") }}</span
          >
          <span v-if="block.response.hits_truncated" class="context-tag"
            >{{ t("aiAssistant.showingFirst") }} {{ block.response.hits.length }}</span
          >
        </div>
      </template>
      <!-- Tool response: testFunction input/output -->
      <template v-else-if="block.response && (block.response.input || block.response.output)">
        <div v-if="block.response.input" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.inputEvents")
          }}</span>
          <div
            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >
            <div
              v-for="(evt, eIdx) in block.response.input"
              :key="eIdx"
              class="tool-response-hit [&:not(:last-child)]:border-border-default flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
            >
              <span
                v-for="(val, key) in evt"
                :key="key"
                class="hit-field cursor-text break-all select-text"
              >
                <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                {{
                  typeof val === "string" && val.length > 120 ? val.substring(0, 120) + "..." : val
                }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="block.response.output" class="detail-item flex flex-col gap-1">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("common.output")
          }}</span>
          <div
            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >
            <div
              v-for="(res, rIdx) in block.response.output"
              :key="rIdx"
              class="tool-response-hit [&:not(:last-child)]:border-border-default flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
            >
              <template v-if="res.event">
                <span
                  v-for="(val, key) in res.event"
                  :key="key"
                  class="hit-field cursor-text break-all select-text"
                >
                  <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                  {{
                    typeof val === "string" && val.length > 120
                      ? val.substring(0, 120) + "..."
                      : val
                  }}
                </span>
              </template>
              <span
                v-if="res.message"
                class="hit-field text-status-negative cursor-text break-all select-text"
              >
                <span class="hit-key font-semibold opacity-60">{{
                  t("aiAssistant.errorLabel")
                }}</span>
                {{ res.message }}
              </span>
            </div>
          </div>
        </div>
      </template>
      <!-- Tool response: list items from normalized { total, items } -->
      <template
        v-else-if="block.response && block.response.items && Array.isArray(block.response.items)"
      >
        <div v-if="block.response.items.length > 0" class="detail-item flex flex-col gap-1">
          <div class="detail-header flex items-center justify-between">
            <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
              t("aiAssistant.items")
            }}</span>
            <OButton
              variant="ghost"
              size="icon-xs-circle"
              class="copy-btn opacity-60 hover:opacity-100"
              @click.stop="copyToClipboard(JSON.stringify(block.response.items, null, 2), t)"
            >
              <OIcon name="content-copy" size="sm" />
              <OTooltip :content="t('aiAssistant.copyItems')" />
            </OButton>
          </div>
          <div
            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >
            <div
              v-for="(item, iIdx) in block.response.items"
              :key="iIdx"
              class="tool-response-list-item [&:not(:last-child)]:border-border-default flex flex-col gap-0.5 py-1 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1.5"
            >
              <div
                v-for="(val, key) in item"
                :key="key"
                class="hit-field cursor-text break-all select-text"
              >
                <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                {{ typeof val === "object" ? JSON.stringify(val) : val }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <!-- Tool response: generic fallback (string or other) -->
      <div v-else-if="block.response" class="detail-item flex flex-col gap-1">
        <div class="detail-header flex items-center justify-between">
          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
            t("aiAssistant.response")
          }}</span>
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            class="copy-btn opacity-60 hover:opacity-100"
            @click.stop="
              copyToClipboard(
                typeof block.response === 'string'
                  ? block.response
                  : JSON.stringify(block.response, null, 2),
                t,
              )
            "
          >
            <OIcon name="content-copy" size="sm" />
            <OTooltip :content="t('aiAssistant.copyResponse')" />
          </OButton>
        </div>
        <code
          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
          >{{
            typeof block.response === "string"
              ? block.response
              : JSON.stringify(block.response, null, 2)
          }}</code
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============================================================
   keep(complex-state) — tool call status matrix.
   Status tint x (has-details) hover x light/dark. Each status maps to its
   semantic token; the light/dark pairs differ only in mix strength, so dark
   overrides just the percentage.
   ============================================================ */
.tool-call-item {
  background: color-mix(in srgb, var(--color-status-positive) 8%, transparent);
}
.dark .tool-call-item {
  background: color-mix(in srgb, var(--color-status-positive) 12%, transparent);
}
.tool-call-item.has-details {
  cursor: pointer;
}
.tool-call-item.has-details:hover {
  background: color-mix(in srgb, var(--color-status-positive) 12%, transparent);
}
.dark .tool-call-item.has-details:hover {
  background: color-mix(in srgb, var(--color-status-positive) 18%, transparent);
}

.tool-call-item.error {
  background: color-mix(in srgb, var(--color-status-negative) 8%, transparent);
}
.dark .tool-call-item.error {
  background: color-mix(in srgb, var(--color-status-negative) 12%, transparent);
}
.tool-call-item.error.has-details:hover {
  background: color-mix(in srgb, var(--color-status-negative) 15%, transparent);
}
.dark .tool-call-item.error.has-details:hover {
  background: color-mix(in srgb, var(--color-status-negative) 22%, transparent);
}

.tool-call-item.pending-confirmation {
  cursor: default;
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel border must not scale with text or it smears at fractional zoom */
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}
.dark .tool-call-item.pending-confirmation {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  border-color: color-mix(in srgb, var(--color-warning) 25%, transparent);
}

.tool-call-item.pending-navigation {
  cursor: default;
  background: color-mix(in srgb, var(--color-info) 8%, transparent);
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel border must not scale with text or it smears at fractional zoom */
  border: 1px solid color-mix(in srgb, var(--color-info) 30%, transparent);
}
.dark .tool-call-item.pending-navigation {
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-info) 25%, transparent);
}
</style>
