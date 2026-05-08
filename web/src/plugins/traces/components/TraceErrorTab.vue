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
    class="full-width tw:flex tw:items-center tw:justify-center text-center q-pt-lg text-bold tab-content-dynamic-height tw:h-full"
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
      <q-icon
        name="error"
        size="1rem"
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
    <q-table
      data-test="trace-details-sidebar-exceptions-table"
      :rows="hasExceptionEvents"
      :columns="exceptionEventColumns"
      row-key="name"
      :rows-per-page-options="[0]"
      class="q-table o2-quasar-table trace-detail-tab-table o2-row-sm o2-schema-table tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)] tab-content-dynamic-height"
      :class="
        showLlmMetrics
          ? 'tab-content-with-llm-metrics'
          : 'tab-content-without-llm-metrics'
      "
      dense
    >
      <template v-slot:body="props">
        <q-tr
          :data-test="`trace-event-detail-${props.row[timestampColumn]}`"
          :key="props.key"
          @click="expandEvent(props.rowIndex)"
          style="cursor: pointer"
          class="pointer"
        >
          <q-td
            v-for="column in exceptionEventColumns"
            :key="props.rowIndex + '-' + column.name"
            class="field_list text-left"
            style="cursor: pointer"
          >
            <div class="flex row items-center no-wrap">
              <q-btn
                v-if="column.name === '@timestamp'"
                :icon="
                  expandedEvents[props.rowIndex.toString()]
                    ? 'expand_more'
                    : 'chevron_right'
                "
                dense
                size="xs"
                flat
                class="q-mr-xs"
                @click.stop="expandEvent(props.rowIndex)"
                :data-test="`trace-details-sidebar-exceptions-table-expand-btn-${props.rowIndex}`"
              ></q-btn>
              <span
                v-if="column.name !== '@timestamp'"
                v-html="highlightTextMatch(column.prop(props.row), searchQuery)"
              />
              <span v-else> {{ column.prop(props.row) }}</span>
            </div>
          </q-td>
        </q-tr>
        <q-tr
          v-if="expandedEvents[props.rowIndex.toString()]"
          :data-test="`trace-details-sidebar-exceptions-table-expanded-row-${props.rowIndex}`"
        >
          <q-td colspan="2" class="exception-details-container tw:px-[0.5rem]!">
            <div class="exception-content">
              <!-- Exception Type -->
              <div class="exception-field">
                <span
                  class="exception-label tw:text-[var(--o2-text-secondary)]!"
                  >{{ t("traces.typeLabel") }}</span
                >
                <span class="exception-type">{{
                  props.row["exception.type"]
                }}</span>
              </div>

              <!-- Exception Message -->
              <div class="exception-field">
                <span
                  class="exception-label tw:text-[var(--o2-text-secondary)]!"
                  >{{ t("traces.messageLabel") }}</span
                >
                <div class="exception-message">
                  {{ formatExceptionMessage(props.row["exception.message"]) }}
                </div>
              </div>

              <!-- Escaped -->
              <div class="exception-field">
                <span
                  class="exception-label tw:text-[var(--o2-text-secondary)]!"
                  >{{ t("traces.escapedLabel") }}</span
                >
                <span class="exception-value">{{
                  props.row["exception.escaped"]
                }}</span>
              </div>

              <!-- Stacktrace -->
              <div class="exception-field">
                <div class="stacktrace-header">
                  <span
                    class="exception-label tw:text-[var(--o2-text-secondary)]!"
                    >{{ t("traces.stacktraceLabel") }}</span
                  >
                  <q-btn
                    v-if="
                      props.row['exception.stacktrace'] &&
                      props.row['exception.stacktrace'].trim()
                    "
                    flat
                    dense
                    size="xs"
                    icon="content_copy"
                    class="copy-btn"
                    @click.stop="
                      copyStackTrace(props.row['exception.stacktrace'])
                    "
                    :title="t('traces.copyStacktrace')"
                  >
                    <q-tooltip>{{ t("traces.copyStacktrace") }}</q-tooltip>
                  </q-btn>
                </div>
                <div
                  v-if="
                    props.row['exception.stacktrace'] &&
                    props.row['exception.stacktrace'].trim()
                  "
                  class="stacktrace-container"
                >
                  <pre
                    class="stacktrace-content"
                    v-html="
                      DOMPurify.sanitize(
                        formatStackTrace(props.row['exception.stacktrace']),
                      )
                    "
                  ></pre>
                </div>
                <div v-else class="stacktrace-empty">
                  <q-icon name="info" size="16px" class="q-mr-xs" />
                  <span>{{ t("traces.noStacktraceAvailable") }}</span>
                </div>
              </div>
            </div>
          </q-td>
        </q-tr>
      </template>
    </q-table>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
import DOMPurify from "dompurify";
import { escapeHtml } from "@/utils/html";
import useTraceDetails from "@/composables/traces/useTraceDetails";
import SpanStatusCodeBadge from "./SpanStatusCodeBadge.vue";

const props = defineProps<{
  span: object;
  searchQuery?: string;
  showLlmMetrics?: boolean;
}>();

const store = useStore();
const { t } = useI18n();
const $q = useQuasar();

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

const expandedEvents: any = ref({});

const exceptionEventColumns = computed(() => [
  {
    name: "@timestamp",
    field: "@timestamp",
    prop: (row: any) =>
      date.formatDate(
        Math.floor(row[store.state.zoConfig.timestamp_column] / 1000000),
        "MMM DD, YYYY HH:mm:ss.SSS Z",
      ),
    label: t("traces.timestamp"),
    align: "left" as const,
    sortable: true,
  },
  {
    name: "type",
    field: "exception.type",
    prop: (row: any) => row["exception.type"],
    label: t("traces.typeLabel"),
    align: "left" as const,
    sortable: true,
  },
]);

watch(
  hasExceptionEvents,
  (events) => {
    const expanded: Record<string, boolean> = {};
    events.forEach((_: any, index: number) => {
      expanded[index.toString()] = true;
    });
    expandedEvents.value = expanded;
  },
  { immediate: true },
);

const expandEvent = (index: number) => {
  if (expandedEvents.value[index.toString()])
    delete expandedEvents.value[index.toString()];
  else expandedEvents.value[index.toString()] = true;
};

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
  navigator.clipboard
    .writeText(stacktrace)
    .then(() => {
      $q.notify({
        message: t("traces.stacktraceCopied"),
        color: "positive",
        position: "top",
        timeout: 2000,
      });
    })
    .catch(() => {
      $q.notify({
        message: t("traces.stacktraceCopyFailed"),
        color: "negative",
        position: "top",
        timeout: 2000,
      });
    });
}
</script>

<style lang="scss" scoped>
// Exception Details Styling
.exception-details-container {
  padding: 0.75rem !important;
  font-size: 12px;
  font-family:
    "Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro", monospace;
  background-color: var(--o2-code-bg);
}

.exception-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.exception-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.exception-label {
  font-weight: 700;
  color: var(--o2-text-primary);
  font-size: 0.75rem;
  margin-bottom: 0;
  padding: 0.25rem 0;
}

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
  background: rgba(0, 0, 0, 0.05);
  padding: 0.5rem;
  border-radius: 4px;
  border-left: 3px solid #ff9800;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  line-height: 1.5;
}

.exception-value {
  color: var(--o2-text-secondary);
}

.stacktrace-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;

  .copy-btn {
    margin-left: auto;
    color: var(--o2-text-secondary);
    opacity: 0.7;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1;
    }
  }
}

.stacktrace-container {
  background: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #dee2e6;
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
  background: #f8f9fa;
  border: 1px dashed #dee2e6;
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
