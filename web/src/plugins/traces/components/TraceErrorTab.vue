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
    v-if="!hasSpanError"
    class="tw:w-full tw:flex tw:items-center tw:justify-center tw:text-center tw:pt-4 tw:font-bold tab-content-dynamic-height tw:h-full"
    data-test="trace-details-sidebar-no-error"
  >
    {{ t("traces.noErrorPresent") }}
  </div>
  <!-- Error Summary: HTTP / gRPC status code -->
  <div
    v-if="hasSpanError && (spanStatusCode || spanGrpcStatusCode)"
    class="error-summary tw:rounded tw:p-[0.5rem] tw:mb-[0.5rem] tw:border tw:border-solid tw:bg-[var(--o2-status-error-bg)] tw:border-[var(--o2-status-error-text)]"
    data-test="trace-details-sidebar-error-summary"
  >
    <div class="tw:flex-col tw:items-center tw:gap-1">
      <div
        class="tw:text-[var(--o2-text-4)]! tw:text-[0.85rem] tw:tracking-[0.03rem] tw:pl-[0.5rem] tw:w-full tw:pb-[0.125rem]"
      >
        {{ spanStatusCode ? "HTTP Status Code" : "gRPC Status Code" }}
      </div>
      <div class="tw:flex tw:items-center">
        <SpanStatusCodeBadge
          v-if="spanStatusCode || spanGrpcStatusCode"
          :code="spanStatusCode"
          :grpc-code="spanGrpcStatusCode"
          class="tw:text-[0.9rem]! tw:flex! tw:items-center"
        />
        <span
          class="tw:text-[0.9rem] tw:font-semibold"
          :style="{ color: 'var(--o2-status-error-text)' }"
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
    class="error-summary tw:rounded tw:p-[0.5rem] tw:mb-[0.5rem] tw:border tw:border-solid tw:bg-[var(--o2-status-error-bg)] tw:border-[var(--o2-status-error-text)]"
    data-test="trace-details-sidebar-db-response-status-code"
  >
    <div class="tw:flex-col tw:items-center tw:gap-1">
      <div
        class="tw:text-[var(--o2-text-4)]! tw:text-[0.65rem] tw:tracking-[0.03rem] tw:pl-[0.5rem] tw:w-full tw:pb-[0.125rem]"
      >
        DB Response Status Code
      </div>
      <div class="tw:flex tw:items-center tw:pl-[0.5rem]">
        <span
          class="tw:text-[0.9rem] tw:font-semibold"
          :style="{ color: 'var(--o2-status-error-text)' }"
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
    class="error-summary tw:rounded tw:p-[0.5rem] tw:mb-[0.5rem] tw:border tw:border-solid tw:bg-[var(--o2-status-error-bg)] tw:border-[var(--o2-status-error-text)]"
    data-test="trace-details-sidebar-process-exit-code"
  >
    <div class="tw:flex-col tw:items-center tw:gap-1">
      <div
        class="tw:text-[var(--o2-text-4)]! tw:text-[0.65rem] tw:tracking-[0.03rem] tw:pl-[0.5rem] tw:w-full tw:pb-[0.125rem]"
      >
        Process Exit Code
      </div>
      <div class="tw:flex tw:items-center tw:pl-[0.5rem]">
        <span
          class="tw:text-[0.9rem] tw:font-semibold"
          :style="{ color: 'var(--o2-status-error-text)' }"
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
    class="error-summary tw:rounded tw:p-[0.5rem] tw:mb-[0.5rem] tw:border tw:border-solid tw:bg-[var(--o2-status-error-bg)] tw:border-[var(--o2-status-error-text)]"
    data-test="trace-details-sidebar-error-summary"
  >
    <div class="tw:flex tw:items-center tw:gap-2 tw:mb-[0.25rem]">
      <OIcon
        name="error"
        size="sm"
        class="tw:text-[var(--o2-status-error-text)]"
      />
      <span
        class="tw:text-[1rem] tw:font-semibold"
        :style="{ color: 'var(--o2-status-error-text)' }"
        data-test="trace-details-sidebar-error-summary-title"
      >
        {{ errorBannerTitle }}
      </span>
    </div>
    <div
      v-if="errorBannerMessage"
      class="tw:ml-[1.5rem] tw:text-[0.875rem] tw:mb-[0.25rem]"
      :style="{ color: 'var(--o2-text-secondary)' }"
      data-test="trace-details-sidebar-error-summary-message"
    >
      {{ errorBannerMessage }}
    </div>
  </div>

  <!-- Exceptions Table -->
  <template v-if="hasExceptionEvents.length">
    <div
      class="tw:text-[0.9rem] tw:pt-[0.325rem]! tw:font-semibold tw:pb-[0.325rem] tw:text-[var(--o2-text-secondary)]!"
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
      class="trace-detail-tab-table tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)] tab-content-dynamic-height"
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
        <div class="tw:px-4 tw:py-3 tw:bg-[var(--o2-card-background)] tw:rounded">
          <div class="tw:space-y-3">
            <!-- Exception Type -->
            <div class="tw:space-y-1">
              <span class="tw:block tw:font-semibold tw:text-[var(--o2-text-secondary)] tw:text-sm tw:mb-1">{{ t("traces.typeLabel") }}</span>
              <span class="exception-type tw:text-sm">{{ row["exception.type"] }}</span>
            </div>

            <!-- Exception Message -->
            <div class="tw:space-y-1">
              <span class="tw:block tw:font-semibold tw:text-[var(--o2-text-secondary)] tw:text-sm tw:mb-1">{{ t("traces.messageLabel") }}</span>
              <div class="exception-message tw:text-sm">
                {{ formatExceptionMessage(row["exception.message"]) }}
              </div>
            </div>

            <!-- Exception Escaped -->
            <div class="tw:space-y-1">
              <span class="tw:block tw:font-semibold tw:text-[var(--o2-text-secondary)] tw:text-sm tw:mb-1">{{ t("traces.escapedLabel") }}</span>
              <span class="tw:text-sm">{{ row["exception.escaped"] }}</span>
            </div>

            <!-- Stacktrace -->
            <div class="tw:space-y-2">
              <div class="tw:flex tw:items-center tw:justify-between">
                <span class="tw:block tw:font-semibold tw:text-[var(--o2-text-secondary)] tw:text-sm">{{ t("traces.stacktraceLabel") }}</span>
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
                class="stacktrace-container tw:bg-[var(--o2-code-bg)] tw:rounded tw:p-3 tw:overflow-x-auto tw:max-h-[600px] tw:overflow-y-auto"
                data-test="exception-stacktrace-container"
              >
                <div class="stacktrace-content" v-html="formatStackTrace(row['exception.stacktrace'])" />
              </div>
              <div v-else class="stacktrace-empty tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:italic tw:py-4 tw:px-3 tw:border tw:border-dashed tw:border-[var(--o2-border)] tw:rounded" data-test="exception-stacktrace-empty">
                <OIcon name="info" size="sm" class="tw:mr-1" />
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

<style lang="scss" scoped>
// Exception Details Styling

.exception-type {
  color: #d32f2f;
  font-weight: 600;
  background: rgba(211, 47, 47, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  display: inline-block;
}

.exception-message {
  color: var(--o2-text-secondary);
  background: var(--o2-code-bg);
  padding: 0.5rem;
  border-radius: 4px;
  border-left: 3px solid #ff9800;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  line-height: 1.5;
}



.stacktrace-container {
  background: var(--o2-code-bg);
  border-radius: 4px;
  border: 1px solid var(--o2-border);
  overflow: auto;
  max-height: 600px;
  padding: 0.75rem;
}

.stacktrace-content {
  margin: 0;
  padding: 0;
  font-size: 11px;
  line-height: 1.6;
  color: #2c3e50;
  font-family:
    "Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro", monospace;
  white-space: pre-wrap;
  word-wrap: break-word;

  .stack-line {
    padding: 2px 0;
  }

  .stack-empty {
    height: 0.5em;
  }

  .stack-file {
    color: #0066cc;
    font-weight: 500;
  }

  .stack-path {
    color: #d63384;
  }

  .stack-lineno {
    color: #087990;
    font-weight: 600;
  }

  .stack-function {
    color: #6f42c1;
  }

  .stack-keyword {
    color: #8250df;
    font-weight: 600;
  }

  .stack-exception {
    color: #d73a49;
    font-weight: 600;
  }

  .stack-traceback {
    color: #6c757d;
    font-style: italic;
  }

  .stack-traceback-header {
    color: #6c757d;
    font-weight: 600;
  }

  .stack-during {
    color: #6c757d;
    margin: 0.5em 0;
  }

  .stack-during-text {
    font-style: italic;
  }

  .stack-code {
    color: #2c3e50;
    padding-left: 2em;
  }

  .stack-call {
    color: #0969da;
  }

  .stack-ellipsis {
    color: #6c757d;
  }

  .stack-error {
    margin-top: 0.5em;
  }

  .stack-error-msg {
    color: #2c3e50;
  }

  .stack-raise {
    color: #d73a49;
  }
}

.stacktrace-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--o2-code-bg);
  border: 1px dashed var(--o2-border);
  border-radius: 4px;
  color: #6c757d;
  font-size: 12px;
  font-style: italic;
}

// Dark Mode Adjustments
body.body--dark {
  .exception-details-container {
    background-color: #1a1a1a;
  }

  .exception-type {
    color: #ef5350;
    background: rgba(239, 83, 80, 0.15);
  }

  .exception-message {
    background: rgba(255, 255, 255, 0.05);
    border-left-color: #ffb74d;
    color: #e0e0e0;
  }

  .stacktrace-container {
    background: #0d0d0d;
    border-color: #2a2a2a;
  }

  .stacktrace-content {
    color: #d4d4d4;

    .stack-file {
      color: #9cdcfe;
    }

    .stack-path {
      color: #ce9178;
    }

    .stack-lineno {
      color: #b5cea8;
    }

    .stack-function {
      color: #dcdcaa;
    }

    .stack-keyword {
      color: #c586c0;
    }

    .stack-exception {
      color: #f48771;
    }

    .stack-traceback {
      color: #808080;
    }

    .stack-traceback-header {
      color: #808080;
    }

    .stack-during {
      color: #808080;
    }

    .stack-code {
      color: #d4d4d4;
    }

    .stack-call {
      color: #4ec9b0;
    }

    .stack-ellipsis {
      color: #808080;
    }

    .stack-error-msg {
      color: #d4d4d4;
    }

    .stack-raise {
      color: #f48771;
    }
  }

  .stacktrace-empty {
    background: rgba(255, 255, 255, 0.05);
    border-color: #4a5568;
    color: #a0aec0;
  }
}
</style>
