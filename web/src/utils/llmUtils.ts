// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * LLM Observability Utility Functions
 *
 * Helper functions for parsing and formatting LLM trace data enriched by the backend.
 */

export interface UsageDetails {
  input: number;
  output: number;
  total: number;
}

export interface CostDetails {
  input: number;
  output: number;
  total: number;
}

export interface EvaluatorInfo {
  name: string | null;
  version: string | null;
  evaluatorType: 'human' | 'model' | 'deterministic';
}


export interface EvaluationScores {
  qualityScore: number | null;
  relevance: number | null;
  completeness: number | null;
  toolEffectiveness: number | null;
  groundedness: number | null;
  safety: number | null;
  durationMs: number | null;
  commentary: string | null;
  evaluator: EvaluatorInfo | null;
}

export interface LLMData {
  provider: string;
  observationType: string;
  modelName: string;
  input: any;
  output: any;
  modelParameters: Record<string, any>;
  usage: UsageDetails;
  cost: CostDetails;
  userId: string | null;
  sessionId: string | null;
  promptName: string | null;
  inputPreview: string;
  evaluation: EvaluationScores | null;
}

/**
 * Check if a value is meaningful (not null, undefined, 0, empty string, or empty array/object)
 */
function hasValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Check if a trace/span has LLM data
 * Returns true only if at least one LLM field exists AND has a meaningful value
 */
export function isLLMTrace(data: any): boolean {
  if (!data) return false;

  // Check OTEL Gen-AI fields (new)
  if (hasValue(data['gen_ai.system'])) return true;
  if (hasValue(data['gen_ai.response.model'])) return true;
  if (hasValue(data['gen_ai.request.model'])) return true;

  // Check custom llm.* fields (new)
  if (hasValue(data['llm.input'])) return true;
  if (hasValue(data['llm.output'])) return true;
  if (hasValue(data['llm.observation.type'])) return true;

  // Check usage fields (OTEL standard, new)
  if (hasValue(data['gen_ai.usage.input_tokens'])) return true;
  if (hasValue(data['gen_ai.usage.output_tokens'])) return true;

  // Check custom usage fields (new)
  if (hasValue(data['llm.usage.tokens'])) return true;

  // Backward compatibility: Check legacy _o2_llm_* fields
  if (hasValue(data._o2_llm_provider_name)) return true;
  if (hasValue(data._o2_llm_input)) return true;
  if (hasValue(data._o2_llm_output)) return true;
  if (hasValue(data._o2_llm_usage_details_input)) return true;
  if (hasValue(data._o2_llm_usage_details_output)) return true;
  if (hasValue(data._o2_llm_usage_details_total)) return true;

  return false;
}

/**
 * Parse LLM usage details from backend data
 * Handles both JSON objects (from backend) and strings (edge cases)
 */
export function parseUsageDetails(value: any): UsageDetails {
  try {
    // Handle if already an object
    const data = typeof value === 'string' ? JSON.parse(value) : value || {};

    // Try new OTEL-compliant names first, then legacy _o2_llm_* names
    const input = data['gen_ai.usage.input_tokens']
      || data.input
      || data._o2_llm_usage_details_input
      || 0;
    const output = data['gen_ai.usage.output_tokens']
      || data.output
      || data._o2_llm_usage_details_output
      || 0;
    const total = data['gen_ai.usage.total_tokens']
      || data.total
      || data._o2_llm_usage_details_total
      || input + output;

    return {
      input,
      output,
      total,
    };
  } catch (error) {
    console.warn('Failed to parse LLM usage details:', error);
    return {
      input: 0,
      output: 0,
      total: 0,
    };
  }
}

/**
 * Parse LLM cost details from backend data
 * Handles both JSON objects (from backend) and strings (edge cases)
 */
export function parseCostDetails(value: any): CostDetails {
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value || {};

    // Parse from llm.usage.cost bundle (new) or legacy _o2_llm_cost_details_* fields
    const input = data.input || data._o2_llm_cost_details_input || 0;
    const output = data.output || data._o2_llm_cost_details_output || 0;
    const total = data.total || data._o2_llm_cost_details_total || input + output;

    return {
      input,
      output,
      total,
    };
  } catch (error) {
    console.warn('Failed to parse LLM cost details:', error);
    return {
      input: 0,
      output: 0,
      total: 0,
    };
  }
}

/**
 * Parse model parameters from backend data
 */
export function parseModelParameters(value: any): Record<string, any> {
  try {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value || {};
  } catch (error) {
    console.warn('Failed to parse model parameters:', error);
    return {};
  }
}

/**
 * Format cost for display
 * LLM costs are often sub-cent, so we use 4 decimal places
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '0.00';
  if (cost < 0.0001) return '<0.0001';

  return `${cost.toFixed(4)}`;
}

/**
 * Format token count for display
 * Shows K or M suffix for large numbers
 */
export function formatTokens(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(2)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Extract text content from a message's content field
 * Handles both string content and multimodal array content
 * Example multimodal: [{type: "text", text: "..."}, {type: "image_url", ...}]
 */
function extractMessageContent(content: any): string {
  // If content is a string, return it directly
  if (typeof content === 'string') {
    return content;
  }

  // If content is an array (multimodal message), extract text parts
  if (Array.isArray(content)) {
    // Find first text content
    const textPart = content.find((part: any) =>
      part && typeof part === 'object' && part.type === 'text' && part.text
    );
    if (textPart) {
      return textPart.text;
    }

    // Fallback: look for any string in the array
    const firstString = content.find((item: any) => typeof item === 'string');
    if (firstString) {
      return firstString;
    }

    // If no text found, stringify the first element
    if (content.length > 0) {
      return JSON.stringify(content[0]);
    }
  }

  // If content is an object, stringify it
  if (typeof content === 'object') {
    return JSON.stringify(content);
  }

  return '';
}

/**
 * Truncate LLM input/output content for preview
 * Handles various input formats:
 * - JSON strings: {"inputs": {"input": "text"}, ...}
 * - Message arrays: [{role: "user", content: "text"}, ...]
 * - Multimodal messages: [{role: "user", content: [{type: "text", text: "..."}, ...]}]
 * - Nested messages: {tools: [...], messages: [...]}
 * - Simple arrays: [{}] or ["text"]
 * - Plain strings
 */
export function truncateLLMContent(
  content: string | object,
  maxLength: number = 100
): string {
  if (!content) return 'N/A';

  let text: string = '';
  let parsed: any = content;

  // Step 1: Parse JSON string if needed
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      // Not JSON, use as-is
      text = content;
    }
  }

  // Step 2: Extract meaningful text from parsed object
  if (!text && parsed && typeof parsed === 'object') {
    // Handle {"inputs": {"input": "text"}, ...} format
    if (parsed.inputs) {
      if (typeof parsed.inputs === 'string') {
        text = parsed.inputs;
      } else if (parsed.inputs.input) {
        text = parsed.inputs.input;
      } else if (parsed.inputs.question) {
        text = parsed.inputs.question;
      } else if (parsed.inputs.query) {
        text = parsed.inputs.query;
      } else {
        // Try to get first string value from inputs
        const firstValue = Object.values(parsed.inputs).find(v => typeof v === 'string');
        if (firstValue) {
          text = firstValue as string;
        }
      }
    }

    // Handle message arrays: [{role: "user", content: "text"}, ...]
    else if (Array.isArray(parsed)) {
      // Look for user messages
      const userMsg = parsed.find((m: any) => m && m.role === 'user' && m.content);
      if (userMsg) {
        text = extractMessageContent(userMsg.content);
      } else {
        // Look for any message with content
        const anyMsg = parsed.find((m: any) => m && m.content);
        if (anyMsg) {
          text = extractMessageContent(anyMsg.content);
        } else {
          // Look for first string in array
          const firstString = parsed.find((item: any) => typeof item === 'string');
          if (firstString) {
            text = firstString;
          } else if (parsed.length > 0 && parsed[0]) {
            text = JSON.stringify(parsed[0]);
          }
        }
      }
    }

    // Handle single message object: {role: "user", content: "text"}
    else if (parsed.role && parsed.content) {
      text = extractMessageContent(parsed.content);
    }

    // Handle object with nested messages array: {tools: [...], messages: [...]}
    else if (parsed.messages && Array.isArray(parsed.messages)) {
      const userMsg = parsed.messages.find((m: any) => m && m.role === 'user' && m.content);
      if (userMsg) {
        text = extractMessageContent(userMsg.content);
      } else {
        const anyMsg = parsed.messages.find((m: any) => m && m.content);
        if (anyMsg) {
          text = extractMessageContent(anyMsg.content);
        }
      }
    }

    // Handle other object formats
    else {
      // Try common fields
      text = parsed.input || parsed.query || parsed.question || parsed.prompt || parsed.text || '';

      // If still no text, stringify the object
      if (!text) {
        text = JSON.stringify(parsed);
      }
    }
  }

  // Fallback: if still no text, return N/A
  if (!text) {
    return 'N/A';
  }

  // Ensure text is a string (safety check)
  if (typeof text !== 'string') {
    text = JSON.stringify(text);
  }

  // Remove extra whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text.length > maxLength
    ? text.substring(0, maxLength) + '...'
    : text;
}

/**
 * Parse evaluation scores from span attributes
 */
export function parseEvaluationScores(data: any): EvaluationScores | null {
  // Use OTEL-compliant llm.evaluation.* attributes (new) with fallback to legacy _o2_llm_* names
  const quality = data['llm.evaluation.quality_score'] || data._o2_llm_evaluation_quality;
  const relevance = data['llm.evaluation.relevance'] || data._o2_llm_evaluation_relevance;
  const completeness = data['llm.evaluation.completeness'] || data._o2_llm_evaluation_completeness;
  const toolEffectiveness = data['llm.evaluation.tool_effectiveness'] || data._o2_llm_evaluation_tool_effectiveness;
  const groundedness = data['llm.evaluation.groundedness'] || data._o2_llm_evaluation_groundedness;
  const safety = data['llm.evaluation.safety'] || data._o2_llm_evaluation_safety;
  const durationMs = data['llm.evaluation.duration_ms'] || data._o2_llm_evaluation_duration_ms;
  const commentary = data['llm.evaluation.commentary'] || data._o2_llm_evaluation_commentary;
  const evaluatorName = data['llm.evaluator.name'] || data._o2_llm_evaluator_name;
  const evaluatorVersion = data['llm.evaluator.version'] || data._o2_llm_evaluator_version;
  const evaluatorType = data['llm.evaluator.type'] || data._o2_llm_evaluator_type;

  // Return null if no evaluation data present
  if (
    quality == null &&
    relevance == null &&
    completeness == null &&
    toolEffectiveness == null &&
    groundedness == null &&
    safety == null
  ) {
    return null;
  }

  const evaluator: EvaluatorInfo | null = evaluatorName || evaluatorVersion || evaluatorType
    ? {
        name: evaluatorName || null,
        version: evaluatorVersion || null,
        evaluatorType: evaluatorType || 'deterministic',
      }
    : null;


  return {
    qualityScore: quality != null ? Number(quality) : null,
    relevance: relevance != null ? Number(relevance) : null,
    completeness: completeness != null ? Number(completeness) : null,
    toolEffectiveness: toolEffectiveness != null ? Number(toolEffectiveness) : null,
    groundedness: groundedness != null ? Number(groundedness) : null,
    safety: safety != null ? Number(safety) : null,
    durationMs: durationMs != null ? Number(durationMs) : null,
    commentary: commentary || null,
    evaluator,
  };
}

/**
 * Format evaluation score as percentage for display
 */
export function formatScore(score: number | null): string {
  if (score == null) return 'N/A';
  return `${(score * 100).toFixed(0)}%`;
}

/**
 * Get color for quality score badge
 * Green for good (>= 0.7), yellow for medium (>= 0.4), red for poor
 */
export function getQualityScoreColor(score: number | null): string {
  if (score == null) return 'grey';
  if (score >= 0.7) return 'green';
  if (score >= 0.4) return 'orange';
  return 'red';
}

/**
 * Get color for observation type badge
 */
export function getObservationTypeColor(type: string): string {
  const colorMap: Record<string, string> = {
    'GENERATION': 'green',
    'EMBEDDING': 'blue',
    'AGENT': 'purple',
    'TOOL': 'orange',
    'CHAIN': 'indigo',
    'RETRIEVER': 'cyan',
    'TASK': 'teal',
    'EVALUATOR': 'pink',
    'WORKFLOW': 'deep-purple',
    'RERANK': 'light-blue',
    'GUARDRAIL': 'red',
    'SPAN': 'grey',
    'EVENT': 'amber',
  };
  return colorMap[type] || 'grey';
}

/**
 * Extract and parse all LLM data from a span or trace list item
 * Returns null if not an LLM span/trace
 *
 * Handles two formats:
 * 1. Trace list items: 
 *   _o2_llm_usage_details_input, _o2_llm_usage_details_output, _o2_llm_usage_details_total, 
 *   _o2_llm_cost_details_input, _o2_llm_cost_details_output, _o2_llm_cost_details_total, 
 *   _o2_llm_input
 */
export function extractLLMData(span: any): LLMData | null {
  if (!isLLMTrace(span)) {
    return null;
  }

  // Parse using OTEL-compliant attribute names (new) with legacy fallbacks
  const modelParams = parseModelParameters(
    span['llm.request.parameters'] || span._o2_llm_model_parameters
  );
  const usage = parseUsageDetails(span['llm.usage.tokens'] || span);
  const cost = parseCostDetails(span['llm.usage.cost'] || {});
  const evaluation = parseEvaluationScores(span);

  return {
    provider: span['gen_ai.system']
      || span['gen_ai.provider.name']
      || span._o2_llm_provider_name
      || 'unknown',
    observationType: span['llm.observation.type']
      || span._o2_llm_observation_type
      || 'SPAN',
    modelName: span['gen_ai.response.model']
      || span['gen_ai.request.model']
      || span._o2_llm_model_name
      || 'unknown',
    input: span['llm.input'] || span._o2_llm_input,
    output: span['llm.output'] || span._o2_llm_output,
    modelParameters: modelParams,
    usage,
    cost,
    userId: span['user.id'] || span._o2_llm_user_id || null,
    sessionId: span['session.id'] || span._o2_llm_session_id || null,
    promptName: span['gen_ai.prompt.name'] || span._o2_llm_prompt_name || null,
    inputPreview: truncateLLMContent(span['llm.input'] || span._o2_llm_input, 100),
    evaluation,
  };
}

/**
 * Format model parameters for display
 */
export function formatModelParameters(params: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) {
    return 'No parameters';
  }

  return Object.entries(params)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
}

/**
 * Truncate session ID for display
 */
export function truncateSessionId(sessionId: string, maxLength: number = 16): string {
  if (!sessionId) return 'N/A';
  if (sessionId.length <= maxLength) return sessionId;

  // Show first 8 and last 8 characters with ellipsis
  const half = Math.floor((maxLength - 3) / 2);
  return `${sessionId.substring(0, half)}...${sessionId.substring(sessionId.length - half)}`;
}
