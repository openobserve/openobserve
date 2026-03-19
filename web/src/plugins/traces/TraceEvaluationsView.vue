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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <div class="eval-container">
    <!-- Template Selector -->
    <div class="eval-template-selector">
      <div class="eval-template-label">Evaluation Template:</div>
      <q-select
        v-model="selectedTemplate"
        :options="availableTemplates"
        option-value="agent_type"
        option-label="name"
        emit-value
        map-options
        dense
        outlined
        class="eval-template-dropdown"
        @update:model-value="onTemplateChange"
      >
        <template v-slot:prepend>
          <q-icon name="assignment" />
        </template>
        <template v-slot:no-option>
          <q-item>
            <q-item-section class="text-grey">
              No templates available
            </q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="eval-loading">
      <q-spinner color="primary" size="60px" />
      <div class="eval-loading-text">Loading evaluation data...</div>
    </div>

    <!-- Empty state -->
    <div v-else-if="evalData.length === 0" class="eval-empty">
      <div class="eval-empty-icon">
        <q-icon name="assessment" />
      </div>
      <div class="eval-empty-title">No Evaluation Data</div>
      <div class="eval-empty-subtitle">
        This trace hasn't been evaluated yet. Configure LLM evaluation for this
        stream to see quality scores and analysis.
      </div>
    </div>

    <!-- Evaluation records -->
    <template v-else>
      <div v-for="(record, idx) in evalData"
:key="idx" class="eval-record">
        <!-- Compact Header with Score -->
        <div class="eval-header-compact">
          <div
            class="eval-score-badge"
            :class="getScoreClass(record.llm_evaluation_quality_score)"
          >
            <div class="eval-score-number">
              {{
                formatScore(record.llm_evaluation_quality_score).replace(
                  "%",
                  "",
                )
              }}
            </div>
            <div class="eval-score-label">Quality</div>
          </div>

          <div class="eval-header-middle">
            <div class="eval-header-row">
              <q-badge
                v-if="record.llm_evaluation_judge_verdict"
                :color="
                  record.llm_evaluation_judge_verdict === 'PASS'
                    ? 'positive'
                    : 'negative'
                "
                :label="record.llm_evaluation_judge_verdict"
                class="eval-verdict-badge"
              />
              <span
                v-if="record.llm_evaluation_judge_confidence"
                class="eval-confidence-text"
              >
                {{ formatScore(record.llm_evaluation_judge_confidence) }}
                confidence
              </span>
            </div>
            <div class="eval-header-row eval-judge-row">
              <span class="eval-judge-label"
                >Evaluated by
                {{ record.llm_evaluation_judge_model || "LLM Judge" }}</span
              >
              <span class="eval-time-text">{{
                formatTimestampDisplay(record._timestamp)
              }}</span>
            </div>
          </div>

          <div
            class="eval-aggregate-mini"
            v-if="record.llm_evaluation_judge_aggregate_score != null"
          >
            <div class="eval-aggregate-mini-label">Aggregate</div>
            <div class="eval-aggregate-mini-value">
              {{ formatScore(record.llm_evaluation_judge_aggregate_score) }}
            </div>
            <div class="eval-aggregate-mini-bar">
              <div
                class="eval-aggregate-mini-fill"
                :style="{
                  width:
                    parseFloat(record.llm_evaluation_judge_aggregate_score) *
                      100 +
                    '%',
                }"
              ></div>
            </div>
          </div>
        </div>

        <!-- Dimensions Grid - Full Width -->
        <div v-if="hasDimensionScores(record)" class="eval-dimensions-full">
          <div class="eval-dimensions-label">Evaluation Dimensions</div>
          <div class="eval-dimensions-compact-grid">
            <div
              v-if="record.llm_evaluation_judge_relevance != null"
              class="eval-dimension-compact"
            >
              <div class="eval-dimension-header-compact">
                <q-icon name="done_all"
color="primary" size="xs" />
                <span class="eval-dimension-name">Relevance</span>
              </div>
              <div
                class="eval-dimension-bar-compact"
                :style="{ '--bar-color': '#2196F3' }"
              >
                <div
                  class="eval-dimension-bar-fill"
                  :style="{
                    width: getBarWidth(record.llm_evaluation_judge_relevance),
                  }"
                ></div>
              </div>
              <div class="eval-dimension-score-compact">
                {{ formatScore(record.llm_evaluation_judge_relevance) }}
              </div>
            </div>

            <div
              v-if="record.llm_evaluation_judge_groundedness != null"
              class="eval-dimension-compact"
            >
              <div class="eval-dimension-header-compact">
                <q-icon name="verified"
color="positive" size="xs" />
                <span class="eval-dimension-name">Groundedness</span>
              </div>
              <div
                class="eval-dimension-bar-compact"
                :style="{ '--bar-color': '#4CAF50' }"
              >
                <div
                  class="eval-dimension-bar-fill"
                  :style="{
                    width: getBarWidth(
                      record.llm_evaluation_judge_groundedness,
                    ),
                  }"
                ></div>
              </div>
              <div class="eval-dimension-score-compact">
                {{ formatScore(record.llm_evaluation_judge_groundedness) }}
              </div>
            </div>

            <div
              v-if="record.llm_evaluation_judge_conciseness != null"
              class="eval-dimension-compact"
            >
              <div class="eval-dimension-header-compact">
                <q-icon name="summarize"
color="deep-purple" size="xs" />
                <span class="eval-dimension-name">Conciseness</span>
              </div>
              <div
                class="eval-dimension-bar-compact"
                :style="{ '--bar-color': '#9C27B0' }"
              >
                <div
                  class="eval-dimension-bar-fill"
                  :style="{
                    width: getBarWidth(record.llm_evaluation_judge_conciseness),
                  }"
                ></div>
              </div>
              <div class="eval-dimension-score-compact">
                {{ formatScore(record.llm_evaluation_judge_conciseness) }}
              </div>
            </div>

            <div
              v-if="record.llm_evaluation_judge_instruction_following != null"
              class="eval-dimension-compact"
            >
              <div class="eval-dimension-header-compact">
                <q-icon name="rule"
color="orange" size="xs" />
                <span class="eval-dimension-name">Instructions</span>
              </div>
              <div
                class="eval-dimension-bar-compact"
                :style="{ '--bar-color': '#FF9800' }"
              >
                <div
                  class="eval-dimension-bar-fill"
                  :style="{
                    width: getBarWidth(
                      record.llm_evaluation_judge_instruction_following,
                    ),
                  }"
                ></div>
              </div>
              <div class="eval-dimension-score-compact">
                {{
                  formatScore(record.llm_evaluation_judge_instruction_following)
                }}
              </div>
            </div>

            <div
              v-if="record.llm_evaluation_judge_accuracy != null"
              class="eval-dimension-compact"
            >
              <div class="eval-dimension-header-compact">
                <q-icon name="check_circle"
color="negative" size="xs" />
                <span class="eval-dimension-name">Accuracy</span>
              </div>
              <div
                class="eval-dimension-bar-compact"
                :style="{ '--bar-color': '#F44336' }"
              >
                <div
                  class="eval-dimension-bar-fill"
                  :style="{
                    width: getBarWidth(record.llm_evaluation_judge_accuracy),
                  }"
                ></div>
              </div>
              <div class="eval-dimension-score-compact">
                {{ formatScore(record.llm_evaluation_judge_accuracy) }}
              </div>
            </div>

            <div
              v-if="record.llm_evaluation_judge_trajectory_efficiency != null"
              class="eval-dimension-compact"
            >
              <div class="eval-dimension-header-compact">
                <q-icon name="flash_on"
color="info" size="xs" />
                <span class="eval-dimension-name">Efficiency</span>
              </div>
              <div
                class="eval-dimension-bar-compact"
                :style="{ '--bar-color': '#00BCD4' }"
              >
                <div
                  class="eval-dimension-bar-fill"
                  :style="{
                    width: getBarWidth(
                      record.llm_evaluation_judge_trajectory_efficiency,
                    ),
                  }"
                ></div>
              </div>
              <div class="eval-dimension-score-compact">
                {{
                  formatScore(record.llm_evaluation_judge_trajectory_efficiency)
                }}
              </div>
            </div>
          </div>
        </div>

        <!-- Three Column Layout -->
        <div class="eval-three-column">
          <!-- Column 1: Metadata & Analysis -->
          <div class="eval-column">
            <div class="eval-column-title">Metadata</div>
            <div class="eval-info-grid">
              <div v-if="record.is_multi_step" class="eval-info-item">
                <q-icon
                  name="account_tree"
                  color="primary"
                  size="sm"
                  class="eval-info-icon"
                />
                <div class="eval-info-content">
                  <span class="eval-info-label">Multi-step</span>
                  <q-badge label="Yes"
color="info" size="sm" />
                </div>
              </div>
              <div v-if="record.total_steps" class="eval-info-item">
                <q-icon
                  name="layers"
                  color="primary"
                  size="sm"
                  class="eval-info-icon"
                />
                <div class="eval-info-content">
                  <span class="eval-info-label">Steps</span>
                  <span class="eval-info-value">{{ record.total_steps }}</span>
                </div>
              </div>
              <div v-if="record.total_tool_calls" class="eval-info-item">
                <q-icon
                  name="build"
                  color="primary"
                  size="sm"
                  class="eval-info-icon"
                />
                <div class="eval-info-content">
                  <span class="eval-info-label">Tools</span>
                  <span class="eval-info-value">{{
                    record.total_tool_calls
                  }}</span>
                </div>
              </div>
              <div v-if="record.exit_status" class="eval-info-item">
                <q-icon
                  :name="record.exit_status === 'ok' ? 'check_circle' : 'error'"
                  :color="record.exit_status === 'ok' ? 'positive' : 'negative'"
                  size="sm"
                  class="eval-info-icon"
                />
                <div class="eval-info-content">
                  <span class="eval-info-label">Status</span>
                  <q-badge
                    :color="
                      record.exit_status === 'ok' ? 'positive' : 'negative'
                    "
                    :label="record.exit_status.toUpperCase()"
                    size="sm"
                  />
                </div>
              </div>
              <div v-if="record.completion_signal" class="eval-info-item">
                <q-icon
                  name="done"
                  color="primary"
                  size="sm"
                  class="eval-info-icon"
                />
                <div class="eval-info-content">
                  <span class="eval-info-label">Completed</span>
                  <span class="eval-info-value">{{
                    record.completion_signal
                  }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Column 2: Issues & Analysis -->
          <div class="eval-column">
            <div class="eval-column-title">Issues & Analysis</div>

            <div
              v-if="record.llm_evaluation_judge_failure_category"
              class="eval-analysis-item"
            >
              <q-icon name="category"
color="warning" size="sm" />
              <span class="eval-analysis-label">Category</span>
              <q-badge
                color="warning"
                text-color="dark"
                :label="record.llm_evaluation_judge_failure_category"
              />
            </div>

            <div
              v-if="record.llm_evaluation_judge_component_at_fault"
              class="eval-analysis-item"
            >
              <q-icon name="build"
color="info" size="sm" />
              <span class="eval-analysis-label">Component</span>
              <q-badge
                :label="record.llm_evaluation_judge_component_at_fault"
                color="info"
              />
            </div>

            <div
              v-if="record.llm_evaluation_judge_critical_issues"
              class="eval-analysis-item eval-issues-item"
            >
              <div class="eval-analysis-label">Issues</div>
              <div class="eval-issues-compact">
                <div
                  v-for="(issue, i) in parseCriticalIssues(
                    record.llm_evaluation_judge_critical_issues,
                  ).slice(0, 3)"
                  :key="i"
                  class="eval-issue-tag"
                >
                  <q-icon name="warning" size="xs" />
                  <span>{{ issue }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Column 3: Recommendations -->
          <div class="eval-column">
            <div class="eval-column-title">Recommendations</div>

            <div
              v-if="record.llm_evaluation_judge_failure_rationale"
              class="eval-text-box eval-rationale-box"
            >
              <div class="eval-text-label">Rationale</div>
              <div class="eval-text-value">
                {{
                  truncateContent(
                    record.llm_evaluation_judge_failure_rationale,
                    150,
                  )
                }}
              </div>
            </div>

            <div
              v-if="record.llm_evaluation_judge_suggested_fix"
              class="eval-text-box eval-fix-box"
            >
              <div class="eval-text-label">Suggested Fix</div>
              <div class="eval-text-value">
                {{
                  truncateContent(
                    record.llm_evaluation_judge_suggested_fix,
                    150,
                  )
                }}
              </div>
            </div>
          </div>
        </div>

        <!-- Input/Output Section - Full Width Below -->
        <div v-if="record.llm_input || record.llm_output" class="eval-io-full">
          <div class="eval-io-label">Query & Response</div>
          <div class="eval-io-row">
            <div v-if="record.llm_input" class="eval-io-sections">
              <!-- System Prompt Section -->
              <div
                v-if="parseMessages(record.llm_input).system"
                class="eval-io-section"
              >
                <div class="eval-io-header">
                  <q-icon name="settings"
color="warning" size="sm" />
                  <span>System Prompt</span>
                </div>
                <div class="eval-io-content-wrapper">
                  <LLMContentRenderer
                    :content="
                      JSON.stringify([
                        {
                          role: 'system',
                          content: parseMessages(record.llm_input).system,
                        },
                      ])
                    "
                    :contentType="'input'"
                    :viewMode="'formatted'"
                  />
                </div>
              </div>

              <!-- User Messages Section -->
              <div
                v-if="parseMessages(record.llm_input).user.length > 0"
                class="eval-io-section"
              >
                <div class="eval-io-header">
                  <q-icon name="person"
color="info" size="sm" />
                  <span>User Messages</span>
                </div>
                <div class="eval-io-content-wrapper">
                  <LLMContentRenderer
                    :content="
                      JSON.stringify(parseMessages(record.llm_input).user)
                    "
                    :contentType="'input'"
                    :viewMode="'formatted'"
                  />
                </div>
              </div>
            </div>

            <div v-if="record.llm_output" class="eval-io-box eval-io-output">
              <div class="eval-io-header">
                <q-icon name="output" size="sm" />
                <span>Assistant Response</span>
              </div>
              <div class="eval-io-content-wrapper">
                <LLMContentRenderer
                  :content="record.llm_output"
                  :contentType="'output'"
                  :viewMode="'json'"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, ref } from "vue";
import { getQualityScoreColor } from "@/utils/llmUtils";
import LLMContentRenderer from "./LLMContentRenderer.vue";

export default defineComponent({
  name: "TraceEvaluationsView",
  components: {
    LLMContentRenderer,
  },
  props: {
    evalData: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const getBarWidth = (value: any): string => {
      if (value == null) return "0%";
      const num = parseFloat(value as any);
      // If value is already in percentage range (> 1), use as is
      // Otherwise multiply by 100
      const percentage = num > 1 ? num : num * 100;
      return `${Math.min(percentage, 100)}%`;
    };

    const formatScore = (score: number | null | undefined): string => {
      if (score == null) return "N/A";
      const num = parseFloat(score as any);
      // If already in percentage range, use as is
      const percentage = num > 1 ? num : num * 100;
      return `${Math.min(percentage, 100).toFixed(0)}%`;
    };

    const getScoreClass = (score: number | null | undefined): string => {
      if (score == null) return "score-neutral";
      const s = parseFloat(score as any);
      if (s >= 0.7) return "score-excellent";
      if (s >= 0.4) return "score-good";
      return "score-poor";
    };

    const formatTimestampDisplay = (timestamp: number | string): string => {
      if (!timestamp) return "N/A";
      try {
        const ts =
          typeof timestamp === "string" ? parseInt(timestamp) : timestamp;
        const date = new Date(ts / 1000);
        return date.toLocaleString();
      } catch {
        return "N/A";
      }
    };

    const hasDimensionScores = (record: any): boolean => {
      return !!(
        record.llm_evaluation_judge_relevance != null ||
        record.llm_evaluation_judge_groundedness != null ||
        record.llm_evaluation_judge_conciseness != null ||
        record.llm_evaluation_judge_instruction_following != null ||
        record.llm_evaluation_judge_accuracy != null ||
        record.llm_evaluation_judge_trajectory_efficiency != null
      );
    };

    const parseCriticalIssues = (value: string | any[]): string[] => {
      try {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [value];
        }
        return [];
      } catch {
        return typeof value === "string" ? [value] : [];
      }
    };

    const truncateContent = (content: any, maxLength: number = 250): string => {
      if (!content) return "N/A";
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else {
        try {
          text = JSON.stringify(content, null, 2);
        } catch {
          text = String(content);
        }
      }
      return text.length > maxLength
        ? text.substring(0, maxLength) + "..."
        : text;
    };

    const parseInputForMessages = (input: any): any[] => {
      try {
        // If it's already an array, return it
        if (Array.isArray(input)) {
          return input;
        }
        // If it's a string, try to parse as JSON
        if (typeof input === "string") {
          const parsed = JSON.parse(input);
          if (Array.isArray(parsed)) {
            return parsed;
          }
          // If parsed is an object with a "messages" field, use that
          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.messages)
          ) {
            return parsed.messages;
          }
        }
        return [];
      } catch {
        return [];
      }
    };

    const getRoleColor = (role: string): string => {
      const colors: Record<string, string> = {
        user: "rgba(25, 118, 210, 0.1)",
        assistant: "rgba(76, 175, 80, 0.1)",
        system: "rgba(255, 152, 0, 0.1)",
        tool: "rgba(156, 39, 176, 0.1)",
      };
      return colors[role] || "rgba(158, 158, 158, 0.1)";
    };

    const parseMessages = (
      input: any,
    ): { system: string | null; user: any[] } => {
      try {
        let messages = [];
        let system = null;

        // Parse input into array
        if (Array.isArray(input)) {
          messages = input;
        } else if (typeof input === "string") {
          const parsed = JSON.parse(input);
          if (Array.isArray(parsed)) {
            messages = parsed;
          } else if (parsed?.messages && Array.isArray(parsed.messages)) {
            messages = parsed.messages;
          } else {
            // If it's just a JSON object (not array), treat the whole thing as content
            return {
              system:
                typeof input === "string"
                  ? input
                  : JSON.stringify(parsed, null, 2),
              user: [],
            };
          }
        } else {
          // If input is not a string or array, stringify it
          return { system: JSON.stringify(input, null, 2), user: [] };
        }

        // If no messages found, treat entire input as system/content
        if (messages.length === 0) {
          return {
            system:
              typeof input === "string"
                ? input
                : JSON.stringify(input, null, 2),
            user: [],
          };
        }

        // Separate system and user messages
        const userMessages = messages.filter(
          (msg: any) => msg.role !== "system" && msg.role !== undefined,
        );
        const systemMsg = messages.find((msg: any) => msg.role === "system");
        system = systemMsg?.content || null;

        return { system, user: userMessages };
      } catch {
        return { system: JSON.stringify(input, null, 2), user: [] };
      }
    };

    const transformInputForRenderer = (input: any): string => {
      try {
        // If it's already an array of messages, stringify it for LLMContentRenderer
        if (Array.isArray(input)) {
          return JSON.stringify(input);
        }
        // If it's a string, try to parse and re-stringify to ensure valid JSON
        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);
            // If it's already an array, stringify it
            if (Array.isArray(parsed)) {
              return JSON.stringify(parsed);
            }
            // If it's an object with a messages field, use that
            if (
              parsed &&
              typeof parsed === "object" &&
              Array.isArray(parsed.messages)
            ) {
              return JSON.stringify(parsed.messages);
            }
            // Otherwise return the original string
            return input;
          } catch {
            // If parsing fails, return as is
            return input;
          }
        }
        // For other types, stringify
        return JSON.stringify(input);
      } catch {
        return String(input);
      }
    };

    // Template selector reactive data
    const selectedTemplate = ref<string | null>(null);
    const availableTemplates = ref<any[]>([]);
    const isLoadingTemplates = ref(false);

    // Load available templates for the org
    const loadTemplates = async (orgId: string) => {
      try {
        isLoadingTemplates.value = true;
        // Import at runtime to avoid circular deps
        const { evalTemplateService } =
          await import("@/services/eval-template.service");
        const templates = await evalTemplateService.listTemplates(orgId);
        availableTemplates.value = templates;

        // Set first template as default if available
        if (templates.length > 0 && !selectedTemplate.value) {
          selectedTemplate.value = templates[0].agent_type;
        }
      } catch (error) {
        console.error("Failed to load evaluation templates:", error);
        availableTemplates.value = [];
      } finally {
        isLoadingTemplates.value = false;
      }
    };

    // Handle template selection change
    const onTemplateChange = (newTemplate: string | null) => {
      if (newTemplate) {
        console.log("Selected evaluation template:", newTemplate);
        // Template is now selected - UI can use this for filtering or re-evaluation
        // The actual re-evaluation would be handled by parent component or API
      }
    };

    return {
      formatScore,
      getBarWidth,
      getScoreClass,
      formatTimestampDisplay,
      hasDimensionScores,
      parseCriticalIssues,
      truncateContent,
      parseInputForMessages,
      transformInputForRenderer,
      parseMessages,
      getQualityScoreColor,
      selectedTemplate,
      availableTemplates,
      isLoadingTemplates,
      loadTemplates,
      onTemplateChange,
    };
  },
});
</script>

<style scoped lang="scss">
.eval-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--o2-card-bg);
  padding: 16px 20px;
  gap: 16px;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--o2-border-color);
    border-radius: 4px;

    &:hover {
      background: var(--o2-border-color-hover);
    }
  }
}

// Template Selector
.eval-template-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  margin-bottom: 8px;

  .eval-template-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--o2-text-secondary);
    white-space: nowrap;
  }

  .eval-template-dropdown {
    flex: 1;
    max-width: 300px;

    :deep(.q-field__control) {
      height: 32px;
      font-size: 13px;
    }
  }
}

// Loading & Empty States
.eval-loading,
.eval-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--o2-text-secondary);
}

.eval-empty-icon {
  font-size: 64px;
  color: var(--o2-text-secondary);
  opacity: 0.5;
}

.eval-loading-text {
  font-size: 14px;
  margin-top: 8px;
}

.eval-empty-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.eval-empty-subtitle {
  font-size: 14px;
  color: var(--o2-text-secondary);
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
}

// Record Container
.eval-record {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// Compact Header
.eval-header-compact {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--o2-border-color);
}

.eval-score-badge {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

  &.score-excellent {
    background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
  }

  &.score-good {
    background: linear-gradient(135deg, #ffc107 0%, #ffb300 100%);
  }

  &.score-poor {
    background: linear-gradient(135deg, #f44336 0%, #da190b 100%);
  }
}

.eval-score-number {
  font-size: 28px;
  line-height: 1;
}

.eval-score-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.9;
  margin-top: 3px;
}

.eval-header-middle {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.eval-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}

.eval-verdict-badge {
  font-weight: 600;
  padding: 3px 10px !important;
}

.eval-confidence-text {
  color: var(--o2-text-secondary);
}

.eval-judge-row {
  gap: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--o2-border-color);
}

.eval-judge-label {
  font-size: 11px;
  color: var(--o2-text-secondary);
  font-weight: 500;
}

.eval-time-text {
  font-size: 11px;
  color: var(--o2-text-secondary);
  white-space: nowrap;
}

.eval-aggregate-mini {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
  padding: 8px;
  background: var(--o2-border-color);
  border-radius: 6px;
  align-items: center;
}

.eval-aggregate-mini-label {
  font-size: 10px;
  color: var(--o2-text-secondary);
  text-transform: uppercase;
  font-weight: 600;
}

.eval-aggregate-mini-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--o2-text-primary);
}

.eval-aggregate-mini-bar {
  width: 100%;
  height: 6px;
  background: var(--o2-card-bg);
  border-radius: 3px;
  overflow: hidden;
}

.eval-aggregate-mini-fill {
  height: 100%;
  background: linear-gradient(90deg, #2196f3, #1976d2);
  border-radius: 3px;
}

// Dimensions Full Width
.eval-dimensions-full {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.eval-dimensions-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--o2-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.eval-dimensions-compact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.eval-dimension-compact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--o2-border-color);
  border-radius: 6px;
}

.eval-dimension-header-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.eval-dimension-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--o2-text-primary);
  text-transform: uppercase;
}

.eval-dimension-bar-compact {
  height: 6px;
  background: var(--o2-card-bg);
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.eval-dimension-bar-fill {
  height: 100%;
  background: var(--bar-color);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.eval-dimension-score-compact {
  font-size: 13px;
  font-weight: 700;
  color: var(--o2-text-primary);
  text-align: right;
}

// Three Column Layout
.eval-three-column {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.eval-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.eval-column-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--o2-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--o2-border-color);
}

.eval-info-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.eval-info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--o2-border-color);
  border-radius: 4px;
  font-size: 12px;
}

.eval-info-icon {
  flex-shrink: 0;
}

.eval-info-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 1;
}

.eval-info-label {
  color: var(--o2-text-secondary);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  white-space: nowrap;
}

.eval-info-value {
  color: var(--o2-text-primary);
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}

.eval-analysis-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  background: var(--o2-border-color);
  border-radius: 4px;
}

.eval-analysis-label {
  font-size: 10px;
  color: var(--o2-text-secondary);
  text-transform: uppercase;
  font-weight: 600;
  flex: 1;
}

.eval-issues-item {
  gap: 4px;
}

.eval-issues-compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.eval-issue-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: rgba(244, 67, 54, 0.1);
  border-radius: 3px;
  font-size: 11px;
  color: #d32f2f;
  font-weight: 500;
}

.eval-text-box {
  padding: 8px;
  background: var(--o2-border-color);
  border-radius: 4px;
  border-left: 3px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.eval-rationale-box {
  border-left-color: #2196f3;
}

.eval-fix-box {
  border-left-color: #4caf50;
}

.eval-text-label {
  font-size: 10px;
  color: var(--o2-text-secondary);
  text-transform: uppercase;
  font-weight: 600;
}

.eval-text-value {
  font-size: 12px;
  color: var(--o2-text-primary);
  line-height: 1.4;
}

// Input/Output Full Width
.eval-io-full {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--o2-border-color);
}

.eval-io-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--o2-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.eval-io-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.eval-io-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 6px;
  border-left: 4px solid transparent;
  overflow: visible;
}

.eval-io-input {
  border-left-color: #2196f3;
}

.eval-io-output {
  border-left-color: #4caf50;
}

.eval-io-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 6px;
  border-left: 4px solid #2196f3;
  overflow: hidden;
}

.eval-io-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

.eval-io-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--o2-border-color);
  font-weight: 600;
  font-size: 11px;
  color: var(--o2-text-primary);
  text-transform: uppercase;
}

.eval-io-content-wrapper {
  overflow-y: auto;
  flex: 1;
  min-height: 200px;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--o2-border-color);
    border-radius: 3px;

    &:hover {
      background: var(--o2-border-color-hover);
    }
  }

  :deep(.llm-content-renderer) {
    max-height: none;
  }

  :deep(.text-content .plain-text-content) {
    background-color: var(--o2-code-bg);
  }
}

.eval-io-content {
  margin: 0;
  padding: 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  background-color: var(--o2-code-bg);
  border-radius: 4px;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 300px;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--o2-border-color);
    border-radius: 3px;

    &:hover {
      background: var(--o2-border-color-hover);
    }
  }
}

// Responsive
@media (max-width: 1200px) {
  .eval-three-column {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .eval-container {
    padding: 12px 16px;
    gap: 12px;
  }

  .eval-record {
    padding: 12px;
    gap: 10px;
  }

  .eval-header-compact {
    flex-direction: column;
    gap: 10px;
  }

  .eval-three-column {
    grid-template-columns: 1fr;
  }

  .eval-dimensions-compact-grid {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  }

  .eval-io-row {
    grid-template-columns: 1fr;
  }
}
</style>
