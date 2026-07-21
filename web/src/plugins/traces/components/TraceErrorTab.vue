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
  <OEmptyState
    v-if="!hasSpanError"
    size="inline"
    variant="no-results"
    :title="t('traces.noErrorPresent')"
    hide-action
    data-test="trace-details-sidebar-no-error"
  />
  <!-- Error Summary: HTTP / gRPC status code -->
  <div
    v-if="hasSpanError && (spanStatusCode || spanGrpcStatusCode)"
    class="error-summary rounded-default p-2 mb-2 border border-solid bg-status-error-bg border-status-error-text"
    data-test="trace-details-sidebar-error-summary"
  >
    <div class="flex-col items-center gap-1">
      <div
        class="text-text-label! text-sm tracking-[0.03rem] pl-2 w-full pb-0.5"
      >
        {{ spanStatusCode ? t("traces.traceErrorTab.httpStatusCode") : t("traces.traceErrorTab.grpcStatusCode") }}
      </div>
      <div class="flex items-center">
        <SpanStatusCodeBadge
          v-if="spanStatusCode || spanGrpcStatusCode"
          :code="spanStatusCode"
          :grpc-code="spanGrpcStatusCode"
          class="text-sm! flex! items-center"
        />
        <span
          class="text-sm font-semibold text-status-error-text"
          data-test="trace-details-sidebar-error-summary-title"
        >
          {{ statusCodeTitle }}
        </span>
      </div>
    </div>
  </div>

  <!-- DB Response Status Code -->
  <div
    v-if="hasSpanError && spanDbResponseStatusCode"
    class="error-summary rounded-default p-2 mb-2 border border-solid bg-status-error-bg border-status-error-text"
    data-test="trace-details-sidebar-db-response-status-code"
  >
    <div class="flex-col items-center gap-1">
      <div
        class="text-text-label! text-3xs tracking-[0.03rem] pl-2 w-full pb-0.5"
      >
        {{ t("traces.traceErrorTab.dbResponseStatusCode") }}
      </div>
      <div class="flex items-center pl-2">
        <span
          class="text-sm font-semibold text-status-error-text"
          data-test="trace-details-sidebar-db-response-status-code-value"
        >
          {{ spanDbResponseStatusCode }}
        </span>
      </div>
    </div>
  </div>

  <!-- Process Exit Code -->
  <div
    v-if="hasSpanError && spanProcessExitCode"
    class="error-summary rounded-default p-2 mb-2 border border-solid bg-status-error-bg border-status-error-text"
    data-test="trace-details-sidebar-process-exit-code"
  >
    <div class="flex-col items-center gap-1">
      <div
        class="text-text-label! text-3xs tracking-[0.03rem] pl-2 w-full pb-0.5"
      >
        {{ t("traces.traceErrorTab.processExitCode") }}
      </div>
      <div class="flex items-center pl-2">
        <span
          class="text-sm font-semibold text-status-error-text"
          data-test="trace-details-sidebar-process-exit-code-value"
        >
          {{ spanProcessExitCode }}
        </span>
      </div>
    </div>
  </div>

  <!-- Generic Error Banner -->
  <div
    v-if="
      hasSpanError && (errorBannerTitle || errorBannerMessage || spanErrorType)
    "
    class="error-summary rounded-default p-2 mb-2 border border-solid bg-status-error-bg border-status-error-text"
    data-test="trace-details-sidebar-error-summary"
  >
    <div class="flex items-center gap-2 mb-1">
      <OIcon
        name="error"
        size="sm"
        class="text-status-error-text"
      />
      <span
        class="text-base font-semibold text-status-error-text"
        data-test="trace-details-sidebar-error-summary-title"
      >
        {{ errorBannerTitle }}
      </span>
    </div>
    <div
      v-if="errorBannerMessage"
      class="ml-6 text-sm mb-1 text-text-secondary"
      data-test="trace-details-sidebar-error-summary-message"
    >
      {{ errorBannerMessage }}
    </div>
  </div>

  <!-- Exceptions Table -->
  <template v-if="hasExceptionEvents.length">
    <div
      class="text-sm pt-[0.325rem]! font-semibold pb-[0.325rem] text-text-secondary!"
    >
      {{ t("traces.exceptionsWithCount", { count: hasExceptionEvents.length }) }}
    </div>
    <OTable
      data-test="trace-details-sidebar-exceptions-table"
      :data="exceptionData"
      :columns="exceptionEventColumns"
      :default-columns="false"
      row-key="_index"
      pagination="none"
      :show-global-filter="false"
      expansion="multiple"
      :expanded-ids="expandedExceptionIds"
      @update:expanded-ids="expandedExceptionIds = $event"
      class="trace-detail-tab-table w-full border border-solid border-card-glass-border tab-content-dynamic-height"
    >
      <template #cell-@timestamp="{ row }">
        <span>{{ formatTimestamp(row) }}</span>
      </template>

      <template #cell-type="{ row }">
        <span
          v-html="highlightTextMatch(row['exception.type'], searchQuery)"
        />
      </template>

      <template #expansion="{ row }">
        <div class="px-4 py-3 bg-surface-base rounded-default">
          <div class="space-y-3">
            <!-- Exception Type -->
            <div class="space-y-1">
              <span class="block font-semibold text-text-secondary text-sm mb-1">{{ t("traces.typeLabel") }}</span>
              <span class="text-status-error-text font-semibold bg-status-error-bg py-1 px-2 rounded-default inline-block text-sm">{{ row["exception.type"] }}</span>
            </div>

            <!-- Exception Message -->
            <div class="space-y-1">
              <span class="block font-semibold text-text-secondary text-sm mb-1">{{ t("traces.messageLabel") }}</span>
              <div class="text-text-secondary bg-code-bg p-2 rounded-default border-l-[3px] border-l-status-warning-text whitespace-pre-wrap break-words leading-normal text-sm">
                {{ formatExceptionMessage(row["exception.message"]) }}
              </div>
            </div>

            <!-- Exception Escaped -->
            <div class="space-y-1">
              <span class="block font-semibold text-text-secondary text-sm mb-1">{{ t("traces.escapedLabel") }}</span>
              <span class="text-sm">{{ row["exception.escaped"] }}</span>
            </div>

            <!-- Stacktrace -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="block font-semibold text-text-secondary text-sm">{{ t("traces.stacktraceLabel") }}</span>
                <OButton
                  v-if="row['exception.stacktrace'] && row['exception.stacktrace'].trim()"
                  variant="secondary"
                  size="icon-sm"
                  class="copy-btn"
                  data-test="exception-copy-stacktrace-btn"
                  @click="copyStackTrace(row['exception.stacktrace'])"
                >
                  <OIcon name="content-copy" size="sm" />
                  <OTooltip :content="t('traces.copyStacktrace')" />
                </OButton>
              </div>
              <div
                v-if="row['exception.stacktrace'] && row['exception.stacktrace'].trim()"
                class="bg-code-bg rounded-default border border-border-default p-3 overflow-x-auto max-h-150 overflow-y-auto"
                data-test="exception-stacktrace-container"
              >
                <div class="stacktrace-content m-0 p-0 text-2xs leading-[1.6] text-code-text font-mono whitespace-pre-wrap break-words" v-html="formatStackTrace(row['exception.stacktrace'])" />
              </div>
              <div v-else class="flex items-center justify-center bg-code-bg text-text-muted text-xs italic py-4 px-3 border border-dashed border-border-default rounded-default" data-test="exception-stacktrace-empty">
                <OIcon name="info" size="sm" class="mr-1" />
                <span>{{ t("traces.noStacktraceAvailable") }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </OTable>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { formatTimestampNs } from "@/utils/date";
import DOMPurify from "dompurify";
import { escapeHtml } from "@/utils/html";
import useTraceDetails from "@/composables/traces/useTraceDetails";
import SpanStatusCodeBadge from "./SpanStatusCodeBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { copyToClipboard } from "@/utils/clipboard";

const props = defineProps<{
  span: object;
  searchQuery?: string;
  showLlmMetrics?: boolean;
}>();

const store = useStore();
const { t } = useI18n();

const spanRef = computed(() => props.span);

const {
  hasSpanError,
  hasExceptionEvents,
  spanStatusCode,
  spanGrpcStatusCode,
  spanErrorType,
  spanDbResponseStatusCode,
  spanProcessExitCode,
  errorBannerTitle,
  errorBannerMessage,
  statusCodeTitle,
} = useTraceDetails(spanRef);

const timestampColumn = computed(() => store.state.zoConfig.timestamp_column);

const expandedExceptionIds = ref<string[]>([]);

const exceptionData = computed(() =>
  hasExceptionEvents.value?.map((event: any, index: number) => ({
    ...event,
    _index: index,
  })) || [],
);

const formatTimestamp = (row: any) =>
  formatTimestampNs(
    row[timestampColumn.value],
    "MMM DD, YYYY HH:mm:ss.SSS Z",
  );

const exceptionEventColumns: OTableColumnDef[] = [
  {
    id: "@timestamp",
    header: t("traces.timestamp"),
    accessorKey: "@timestamp",
    meta: { align: "left" },
    sortable: true,
    size: 200,
    minSize: 200,
    maxSize: 200,
  },
  {
    id: "type",
    header: t("traces.typeLabel"),
    accessorKey: "exception.type",
    meta: { align: "left", autoWidth: true },
    sortable: true,
    size: COL.type,
    minSize: 100,
  },
];

watch(
  hasExceptionEvents,
  (events) => {
    // Auto-expand all exception rows when hasExceptionEvents changes
    const expandedIds: string[] = [];
    events.forEach((_: any, index: number) => {
      expandedIds.push(index.toString());
    });
    expandedExceptionIds.value = expandedIds;
  },
  { immediate: true },
);


const highlightTextMatch = (text: string, query: string): string => {
  if (!query) return escapeHtml(text);
  try {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    return escapeHtml(text).replace(
      regex,
      (match) => `<span class="highlight">${match}</span>`,
    );
  } catch {
    return escapeHtml(text);
  }
};

function detectStackLanguage(lines: string[]): string {
  const sample = lines.slice(0, 20).join("\n");
  if (/^\s+at\s+\w+/.test(sample)) return "java";
  if (/\bgoroutine\b|\bpanic:/i.test(sample)) return "go";
  if (/^\s+at\s+\S+\s+\(/.test(sample)) return "node";
  if (/^\s+\d+:/.test(sample) || /^\s+at\s+src\//.test(sample)) return "rust";
  return "python";
}

function formatStackTrace(trace: any) {
  if (!trace) return "";
  const lines = trace.split("\n");
  const lang = detectStackLanguage(lines);
  if (lang === "java") return formatJavaStackTrace(lines);
  if (lang === "go") return formatGoStackTrace(lines);
  if (lang === "node") return formatNodeStackTrace(lines);
  if (lang === "rust") return formatRustStackTrace(lines);
  return formatPythonStackTrace(lines);
}

function formatPythonStackTrace(lines: string[]): string {
  return lines
    .map((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="stack-line stack-empty"></div>';

      if (trimmed.startsWith("File ")) {
        const fileMatch = line.match(
          /(File\s+)"([^"]+)"(,\s+line\s+)(\d+)(,\s+in\s+)(.+)/,
        );
        if (fileMatch) {
          return `<div class="stack-line stack-file">  ${escapeHtml(fileMatch[1])}<span class="stack-path">"${escapeHtml(fileMatch[2])}"</span>${escapeHtml(fileMatch[3])}<span class="stack-lineno">${escapeHtml(fileMatch[4])}</span>${escapeHtml(fileMatch[5])}<span class="stack-function">${escapeHtml(fileMatch[6])}</span></div>`;
        }
      }

      if (trimmed.startsWith("raise ") || trimmed.includes("raise ")) {
        const highlighted = escapeHtml(line).replace(
          /(raise\s+)(\w+)/,
          '<span class="stack-keyword">$1</span><span class="stack-exception">$2</span>',
        );
        return `<div class="stack-line stack-raise">${highlighted}</div>`;
      }

      if (trimmed.startsWith("Traceback ")) {
        return `<div class="stack-line stack-traceback"><span class="stack-traceback-header">${escapeHtml(line)}</span></div>`;
      }

      if (trimmed.startsWith("During handling of")) {
        return `<div class="stack-line stack-during"><span class="stack-during-text">${escapeHtml(line)}</span></div>`;
      }

      if (line.startsWith("    ") && !trimmed.startsWith("File ")) {
        const highlighted = escapeHtml(line)
          .replace(
            /(return|await|async|yield|raise|for|if|else|try|except|finally|with|as|import|from)\s/g,
            '<span class="stack-keyword">$1</span> ',
          )
          .replace(/(\w+\()/g, '<span class="stack-call">$1</span>')
          .replace(/(\.\.\.)/g, '<span class="stack-ellipsis">$1</span>');
        return `<div class="stack-line stack-code">${highlighted}</div>`;
      }

      if (trimmed.match(/^\w+\.\w+Error:/)) {
        const errorMatch = line.match(/^(\s*)(\w+(?:\.\w+)*Error:)(.+)/);
        if (errorMatch) {
          return `<div class="stack-line stack-error">${escapeHtml(errorMatch[1])}<span class="stack-exception">${escapeHtml(errorMatch[2])}</span><span class="stack-error-msg">${escapeHtml(errorMatch[3])}</span></div>`;
        }
      }

      return `<div class="stack-line">${escapeHtml(line)}</div>`;
    })
    .join("");
}

function formatJavaStackTrace(lines: string[]): string {
  return lines
    .map((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="stack-line stack-empty"></div>';

      const javaAtMatch = trimmed.match(
        /^(at\s+)([\w.]+)\.([\w<>$]+)\(([\w.]+):(\d+)\)/,
      );
      if (javaAtMatch) {
        return `<div class="stack-line stack-java-at">  <span class="stack-keyword">${escapeHtml(javaAtMatch[1])}</span><span class="stack-java-package">${escapeHtml(javaAtMatch[2])}</span>.<span class="stack-function">${escapeHtml(javaAtMatch[3])}</span>(<span class="stack-path">${escapeHtml(javaAtMatch[4])}</span>:<span class="stack-lineno">${escapeHtml(javaAtMatch[5])}</span>)</div>`;
      }

      if (trimmed.startsWith("Caused by:")) {
        const causedMatch = trimmed.match(
          /^(Caused by:\s+)([\w.]+)(:?\s*)(.*)/,
        );
        if (causedMatch) {
          return `<div class="stack-line stack-java-caused"><span class="stack-keyword">${escapeHtml(causedMatch[1])}</span><span class="stack-exception">${escapeHtml(causedMatch[2])}</span><span class="stack-error-msg">${escapeHtml(causedMatch[3])}${escapeHtml(causedMatch[4])}</span></div>`;
        }
      }

      if (
        trimmed.match(/^[\w.]+Exception:/) ||
        trimmed.match(/^[\w.]+Error:/)
      ) {
        const excMatch = trimmed.match(
          /^([\w.]+(?:Exception|Error))(:?\s*)(.*)/,
        );
        if (excMatch) {
          return `<div class="stack-line stack-error"><span class="stack-exception">${escapeHtml(excMatch[1])}</span><span class="stack-error-msg">${escapeHtml(excMatch[2])}${escapeHtml(excMatch[3])}</span></div>`;
        }
      }

      if (trimmed.match(/^\.\.\.\s+\d+\s+more/)) {
        return `<div class="stack-line stack-ellipsis-line"><span class="stack-ellipsis">${escapeHtml(line)}</span></div>`;
      }

      return `<div class="stack-line">${escapeHtml(line)}</div>`;
    })
    .join("");
}

function formatGoStackTrace(lines: string[]): string {
  return lines
    .map((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="stack-line stack-empty"></div>';

      if (trimmed.startsWith("panic:")) {
        return `<div class="stack-line stack-go-panic"><span class="stack-keyword">${escapeHtml(trimmed)}</span></div>`;
      }

      if (trimmed.startsWith("goroutine ")) {
        return `<div class="stack-line stack-go-routine"><span class="stack-keyword">${escapeHtml(trimmed)}</span></div>`;
      }

      if (trimmed.startsWith("created by ")) {
        return `<div class="stack-line stack-go-created"><span class="stack-keyword">${escapeHtml(trimmed)}</span></div>`;
      }

      const goFrameMatch = trimmed.match(
        /^(.+)\(.*\)\s+([\w./-]+):(\d+)\s+\+0x[0-9a-f]+/,
      );
      if (goFrameMatch) {
        return `<div class="stack-line stack-go-frame">  <span class="stack-function">${escapeHtml(goFrameMatch[1])}</span>(...)<br/>      <span class="stack-path">${escapeHtml(goFrameMatch[2])}</span>:<span class="stack-lineno">${escapeHtml(goFrameMatch[3])}</span></div>`;
      }

      return `<div class="stack-line">${escapeHtml(line)}</div>`;
    })
    .join("");
}

function formatNodeStackTrace(lines: string[]): string {
  return lines
    .map((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="stack-line stack-empty"></div>';

      if (trimmed.match(/^\w+(Error|Exception):/)) {
        const excMatch = trimmed.match(/^(\w+(?:Error|Exception))(:?\s*)(.*)/);
        if (excMatch) {
          return `<div class="stack-line stack-error"><span class="stack-exception">${escapeHtml(excMatch[1])}</span><span class="stack-error-msg">${escapeHtml(excMatch[2])}${escapeHtml(excMatch[3])}</span></div>`;
        }
      }

      const nodeAtMatch = trimmed.match(
        /^(at\s+)([\w.<>$\s]+?)\s+\(([^)]+):(\d+):(\d+)\)/,
      );
      if (nodeAtMatch) {
        return `<div class="stack-line stack-node-at">  <span class="stack-keyword">${escapeHtml(nodeAtMatch[1])}</span><span class="stack-function">${escapeHtml(nodeAtMatch[2])}</span> (<span class="stack-path">${escapeHtml(nodeAtMatch[3])}</span>:<span class="stack-lineno">${escapeHtml(nodeAtMatch[4])}</span>:<span class="stack-lineno">${escapeHtml(nodeAtMatch[5])}</span>)</div>`;
      }

      return `<div class="stack-line">${escapeHtml(line)}</div>`;
    })
    .join("");
}

function formatRustStackTrace(lines: string[]): string {
  return lines
    .map((line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="stack-line stack-empty"></div>';

      const rustNumMatch = trimmed.match(/^(\d+):\s+(.+)/);
      if (rustNumMatch) {
        return `<div class="stack-line stack-rust-frame"><span class="stack-lineno">${escapeHtml(rustNumMatch[1])}</span>: <span class="stack-function">${escapeHtml(rustNumMatch[2])}</span></div>`;
      }

      const rustAtMatch = trimmed.match(/^(at\s+)([\w./-]+\.rs):(\d+):(\d+)/);
      if (rustAtMatch) {
        return `<div class="stack-line stack-rust-loc">   <span class="stack-keyword">${escapeHtml(rustAtMatch[1])}</span><span class="stack-path">${escapeHtml(rustAtMatch[2])}</span>:<span class="stack-lineno">${escapeHtml(rustAtMatch[3])}</span>:<span class="stack-lineno">${escapeHtml(rustAtMatch[4])}</span></div>`;
      }

      if (trimmed.startsWith("Error:")) {
        return `<div class="stack-line stack-rust-panic"><span class="stack-exception">${escapeHtml(trimmed)}</span></div>`;
      }

      return `<div class="stack-line">${escapeHtml(line)}</div>`;
    })
    .join("");
}

function formatExceptionMessage(message: any) {
  if (!message) return "";
  if (
    typeof message === "string" &&
    (message.includes("{") || message.includes("["))
  ) {
    try {
      const jsonMatch = message.match(/\{[^}]+\}/g);
      if (jsonMatch) {
        let formatted = message;
        jsonMatch.forEach((json) => {
          try {
            const parsed = JSON.parse(json);
            const pretty = JSON.stringify(parsed, null, 2);
            formatted = formatted.replace(json, "\n" + pretty);
          } catch {
            // keep original
          }
        });
        return formatted;
      }
    } catch {
      // keep original
    }
  }
  return message;
}

function copyStackTrace(stacktrace: string) {
  if (!stacktrace) return;
  copyToClipboard(stacktrace, {
    successMessage: t("traces.stacktraceCopied"),
    errorMessage: t("traces.stacktraceCopyFailed"),
    timeout: 2000,
  });
}
</script>

<style scoped>
/* keep(generated-content): the `.stack-*` classes style the stacktrace markup that
   formatStackTrace() builds and the template injects with v-html — there is no
   template element to carry a utility, so they stay as CSS (:deep, since the
   generated nodes carry no scope attribute).
   Every colour maps onto the shared --color-syntax-* family (the same palette
   OCodeBlock uses); those tokens flip light<->dark in dark.css, so ONE rule set
   covers both themes and the per-theme override list is gone. */
.stacktrace-content :deep(.stack-line) {
  padding: 0.125rem 0;
}

.stacktrace-content :deep(.stack-empty) {
  height: 0.5em;
}

/* `File "…", line N, in fn` scaffolding literals — a frame-header role of its
   own, distinct from path / lineno / function which the inner spans set. */
.stacktrace-content :deep(.stack-file) {
  color: var(--color-syntax-builtin);
  font-weight: 500;
}

/* file + module paths -> string role */
.stacktrace-content :deep(.stack-path) {
  color: var(--color-syntax-string);
}

/* line and column numbers -> number role */
.stacktrace-content :deep(.stack-lineno) {
  color: var(--color-syntax-number);
  font-weight: 600;
}

/* function / frame names -> function role */
.stacktrace-content :deep(.stack-function) {
  color: var(--color-syntax-function);
}

/* language keywords (`at`, `raise`, `panic:`, `goroutine`, `Caused by:`) */
.stacktrace-content :deep(.stack-keyword) {
  color: var(--color-syntax-keyword);
  font-weight: 600;
}

/* exception / error type names -> the app's error text role */
.stacktrace-content :deep(.stack-exception) {
  color: var(--color-status-error-text);
  font-weight: 600;
}

/* dim framing lines (Traceback header, "During handling of…", `... N more`) */
.stacktrace-content :deep(.stack-traceback) {
  color: var(--color-syntax-comment);
  font-style: italic;
}

.stacktrace-content :deep(.stack-traceback-header) {
  color: var(--color-syntax-comment);
  font-weight: 600;
}

.stacktrace-content :deep(.stack-during) {
  color: var(--color-syntax-comment);
  margin: 0.5em 0;
}

.stacktrace-content :deep(.stack-during-text) {
  font-style: italic;
}

.stacktrace-content :deep(.stack-ellipsis) {
  color: var(--color-syntax-comment);
}

/* echoed source line + trailing error message -> plain code body text */
.stacktrace-content :deep(.stack-code) {
  color: var(--color-syntax-text);
  padding-left: 2em;
}

.stacktrace-content :deep(.stack-error-msg) {
  color: var(--color-syntax-text);
}

/* call sites `fn(` inside the echoed source line */
.stacktrace-content :deep(.stack-call) {
  color: var(--color-syntax-tag);
}

/* the `raise` line's residual text — same error red as the exception it names */
.stacktrace-content :deep(.stack-raise) {
  color: var(--color-status-error-text);
}

.stacktrace-content :deep(.stack-error) {
  margin-top: 0.5em;
}
</style>
