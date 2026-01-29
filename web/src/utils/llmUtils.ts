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
}

/**
 * Check if a trace/span has LLM data
 */
export function isLLMTrace(data: any): boolean {
  return !!(data && (data._o2_llm_provider_name || data._o2_llm_input || data.llm_input || data.llm_usage));
}

/**
 * Parse LLM usage details from backend data
 * Handles both JSON objects (from backend) and strings (edge cases)
 */
export function parseUsageDetails(value: any): UsageDetails {
  try {
    // Handle if already an object
    const data = typeof value === 'string' ? JSON.parse(value) : value || {};

    return {
      input: data._o2_llm_usage_details_input || 0,
      output: data._o2_llm_usage_details_output || 0,
      total: data._o2_llm_usage_details_total || (data._o2_llm_usage_details_input || 0) + (data._o2_llm_usage_details_output || 0),
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

    return {
      input: data._o2_llm_cost_details_input || 0,
      output: data._o2_llm_cost_details_output || 0,
      total: data._o2_llm_cost_details_total || (data._o2_llm_cost_details_input || 0) + (data._o2_llm_cost_details_output || 0),
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
 * Truncate LLM input/output content for preview
 * Handles various input formats:
 * - JSON strings: {"inputs": {"input": "text"}, ...}
 * - Message arrays: [{role: "user", content: "text"}, ...]
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
        text = userMsg.content;
      } else {
        // Look for any message with content
        const anyMsg = parsed.find((m: any) => m && m.content);
        if (anyMsg) {
          text = anyMsg.content;
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
      text = parsed.content;
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

  // Remove extra whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text.length > maxLength
    ? text.substring(0, maxLength) + '...'
    : text;
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
 * 1. Trace list items: llm_usage_tokens, llm_usage_costs, llm_input
 * 2. Individual spans: _o2_llm_* fields with split usage/cost fields:
 *    - _o2_llm_usage_details_input, _o2_llm_usage_details_output, _o2_llm_usage_details_total
 *    - _o2_llm_cost_details_input, _o2_llm_cost_details_output, _o2_llm_cost_details_total
 */
export function extractLLMData(span: any): LLMData | null {
  if (!isLLMTrace(span)) {
    return null;
  }

  // Check if this is a trace list item (simplified format)
  if (span.llm_usage_tokens !== undefined || span.llm_usage_costs !== undefined || span.llm_input !== undefined) {
    // Simplified format for trace list
    const totalTokens = span.llm_usage_tokens || 0;
    const totalCost = span.llm_usage_costs || 0;
    const input = span.llm_input;

    return {
      provider: 'unknown',
      observationType: 'SPAN',
      modelName: 'unknown',
      input: input,
      output: null,
      modelParameters: {},
      usage: {
        input: 0,
        output: 0,
        total: totalTokens,
      },
      cost: {
        input: 0,
        output: 0,
        total: totalCost,
      },
      userId: null,
      sessionId: null,
      promptName: null,
      inputPreview: truncateLLMContent(input, 100),
    };
  }

  // Detailed format for individual spans with split fields
  const modelParams = parseModelParameters(span._o2_llm_model_parameters);
  const usage = parseUsageDetails(span);
  const cost = parseCostDetails(span);

  return {
    provider: span._o2_llm_provider_name || 'unknown',
    observationType: span._o2_llm_observation_type || 'SPAN',
    modelName: span._o2_llm_model_name || 'unknown',
    input: span._o2_llm_input,
    output: span._o2_llm_output,
    modelParameters: modelParams,
    usage,
    cost,
    userId: span._o2_llm_user_id || null,
    sessionId: span._o2_llm_session_id || null,
    promptName: span._o2_llm_prompt_name || null,
    inputPreview: truncateLLMContent(span._o2_llm_input, 100),
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
