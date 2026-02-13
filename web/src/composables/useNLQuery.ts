// Copyright 2023 OpenObserve Inc.
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

import { ref } from "vue";
import useAiChat from "@/composables/useAiChat";
import useSuggestions from "@/composables/useSuggestions";
import { parsePromQlQuery } from "@/utils/query/promQLUtils";

/**
 * Composable for Natural Language to SQL Query transformation
 * Provides auto-detection and generation capabilities without UI
 */
export function useNLQuery() {
  const { fetchAiChat, getStructuredContext } = useAiChat();
  const isGenerating = ref(false);
  const streamingResponse = ref(''); // Real-time streaming response for user engagement

  /**
   * Extracts function names from autocomplete suggestions dynamically
   * Reuses existing suggestion data to avoid code duplication
   *
   * This function parses the useSuggestions composable's defaultSuggestions
   * to extract all quick mode function names automatically
   */
  const getQuickModeFunctionNames = (): string[] => {
    const { defaultSuggestions } = useSuggestions();

    // Pattern to extract function name from label: match_all('keyword') → match_all
    const functionPattern = /^([a-z_][a-z0-9_]*)\(/i;

    const functionNames = new Set<string>();

    // Dynamically extract from defaultSuggestions
    defaultSuggestions.forEach((suggestion: any) => {
      if (typeof suggestion.label === 'function') {
        // Call label function with empty string to get the pattern
        const labelText = suggestion.label('');
        const match = labelText.match(functionPattern);
        if (match && match[1]) {
          functionNames.add(match[1].toLowerCase());
        }
      } else if (typeof suggestion.label === 'string') {
        const match = suggestion.label.match(functionPattern);
        if (match && match[1]) {
          functionNames.add(match[1].toLowerCase());
        }
      }
    });

    return Array.from(functionNames);
  };

  /**
   * Detects if the given text is natural language (not SQL/PromQL/VRL/JS)
   *
   * @param text - The text to analyze
   * @param language - Current editor language (sql, promql, vrl, javascript)
   * @param depth - Internal parameter to prevent unbounded recursion (max 10 levels)
   * @returns true if text is natural language, false if it's valid query syntax
   *
   * Detection logic:
   * - Returns false for empty/whitespace text
   * - Returns false if matches language-specific syntax patterns
   * - Returns true otherwise (natural language)
   */
  const detectNaturalLanguage = (text: string, language: string = 'sql', depth: number = 0): boolean => {
    // Prevent stack overflow from deeply nested expressions like ((((expr))))
    const MAX_RECURSION_DEPTH = 10;
    if (depth >= MAX_RECURSION_DEPTH) {
      console.warn('[NL2Q] Maximum recursion depth reached in detectNaturalLanguage, treating as natural language');
      return true; // Assume natural language if too deeply nested
    }

    const trimmed = text.trim();

    // Empty text is not natural language
    if (!trimmed) return false;

    const lang = language.toLowerCase();

    // PromQL detection
    if (lang === 'promql') {
      // Strategy 1: Try parsing as PromQL using the parser
      // If the parser can extract a metric name or labels, it's valid PromQL
      try {
        const parsed = parsePromQlQuery(trimmed);
        if (parsed.metricName || parsed.label.hasLabels) {
          // Successfully parsed as PromQL with metric name or labels
          return false;
        }
      } catch (e) {
        // Parser failed, continue with pattern matching
      }

      // Strategy 2: Pattern-based detection for queries parser might not fully handle

      // Check for PromQL aggregation operators at start
      const promqlAggregations = /^(sum|min|max|avg|group|stddev|stdvar|count|count_values|bottomk|topk|quantile)\s*\(/i;
      if (promqlAggregations.test(trimmed)) {
        return false;
      }

      // Check for PromQL metric selectors with curly braces: metric_name{label="value"}
      const metricSelector = /[a-zA-Z_:][a-zA-Z0-9_:]*\s*\{[^}]*\}/;
      if (metricSelector.test(trimmed)) {
        return false;
      }

      // Check for PromQL range selectors: [5m], [1h], etc.
      const rangeSelector = /\[[0-9]+[smhdwy]\]/;
      if (rangeSelector.test(trimmed)) {
        return false;
      }

      // Check for PromQL functions
      const promqlFunctions = /\b(rate|increase|delta|idelta|irate|avg_over_time|min_over_time|max_over_time|sum_over_time|count_over_time|quantile_over_time|stddev_over_time|stdvar_over_time|histogram_quantile|label_join|label_replace|abs|ceil|floor|round|sqrt|exp|ln|log2|log10|clamp|clamp_max|clamp_min|sort|sort_desc|time|timestamp|vector|scalar|changes|deriv|predict_linear|holt_winters|resets)\s*\(/i;
      if (promqlFunctions.test(trimmed)) {
        return false;
      }

      // Check for PromQL aggregation modifiers (by, without)
      const aggregationModifiers = /\b(by|without)\s*\(/i;
      if (aggregationModifiers.test(trimmed)) {
        return false;
      }

      // Check for simple metric names (without selectors) - common PromQL pattern
      // Examples: cpu_usage, http_requests_total
      const simpleMetric = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
      if (simpleMetric.test(trimmed)) {
        return false;
      }

      // Check for parentheses wrapping expressions (common in PromQL)
      // Examples: (metric_name), (avg(metric))
      const wrappedExpression = /^\(.+\)$/;
      if (wrappedExpression.test(trimmed)) {
        // Check if content inside looks like PromQL
        const innerContent = trimmed.slice(1, -1).trim();
        // Recursively check inner content with depth tracking
        if (innerContent) {
          const isInnerNL = detectNaturalLanguage(innerContent, lang, depth + 1);
          if (!isInnerNL) {
            return false; // Inner content is PromQL, so outer is also PromQL
          }
        }
      }
    }

    // VRL detection
    if (lang === 'vrl') {
      const vrlPatterns = /(\.|=\s|,\s*\{|\}|->|\.parse_|\.to_)/;
      if (vrlPatterns.test(trimmed)) {
        return false;
      }
    }

    // JavaScript detection
    if (lang === 'javascript' || lang === 'js') {
      const jsPatterns = /^(function|const|let|var|class|if|for|while|return|=>|\{|\})/i;
      if (jsPatterns.test(trimmed)) {
        return false;
      }
    }

    // SQL detection (applies to all languages as fallback)
    const sqlKeywords = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE',
      'CREATE', 'ALTER', 'DROP', 'JOIN', 'INNER', 'LEFT', 'RIGHT',
      'OUTER', 'UNION', 'GROUP', 'ORDER', 'HAVING', 'LIMIT'
    ];

    const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
    if (sqlKeywords.includes(firstWord)) {
      return false;
    }

    // If starts with SQL comment, it's SQL (not NL)
    if (trimmed.startsWith('--')) {
      return false;
    }

    // Quick mode detection: Check for quick mode query patterns
    const quickModeFunctions = getQuickModeFunctionNames();

    const lowerText = trimmed.toLowerCase();
    for (const func of quickModeFunctions) {
      if (lowerText.includes(`${func}(`)) {
        return false;
      }
    }

    // Check for field comparison operators (=, !=, >, <, >=, <=, <>)
    const comparisonOperators = /[a-zA-Z_][a-zA-Z0-9_]*\s*(=|!=|>|<|>=|<=|<>)\s*.+/;
    if (comparisonOperators.test(trimmed)) {
      return false;
    }

    // Check for boolean operators (and, or, not) which are common in quick mode
    const hasBooleanOps = /\b(and|or|not)\b/i.test(trimmed);
    if (hasBooleanOps && comparisonOperators.test(trimmed)) {
      return false;
    }

    // Check for SQL operators like LIKE, IN, BETWEEN (case-insensitive)
    const sqlOperators = /\b(like|in|not in|between|is null|is not null)\b/i;
    if (sqlOperators.test(trimmed)) {
      return false;
    }

    // Otherwise, it's natural language
    return true;
  };

  /**
   * Extracts clean SQL query from AI response that may contain explanatory text
   *
   * @param response - Raw AI response text
   * @returns Extracted SQL query, or null if no SQL found
   *
   * Handles:
   * - Markdown code blocks: ```sql ... ```
   * - Inline SQL statements (SELECT, WITH, etc.)
   * - Filters out explanatory text before/after SQL
   */
  const extractSQLFromResponse = (response: string): string | null => {
    // Strategy 1: Extract from markdown code blocks (SQL, PromQL, VRL, JavaScript)
    // Try language-specific code blocks first
    const codeBlockPatterns = [
      /```sql\s+([\s\S]+?)```/i,
      /```promql\s+([\s\S]+?)```/i,
      /```vrl\s+([\s\S]+?)```/i,
      /```javascript\s+([\s\S]+?)```/i,
      /```js\s+([\s\S]+?)```/i,
    ];

    for (const pattern of codeBlockPatterns) {
      const match = response.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        console.log('[NL2Q] Extracted query from code block:', extracted);
        return extracted;
      }
    }

    // Strategy 2: Extract from generic code block (no language specified)
    // This handles cases like ```\navg(metric_name)\n```
    const genericCodeBlockMatch = response.match(/```\s*\n?([\s\S]+?)\n?```/);
    if (genericCodeBlockMatch && genericCodeBlockMatch[1]) {
      const extracted = genericCodeBlockMatch[1].trim();
      console.log('[NL2Q] Extracted query from generic code block:', extracted);
      return extracted;
    }

    // Strategy 3: Find SQL statement by keywords (SELECT, WITH, etc.)
    // NOTE: This strategy is SQL-specific and won't work for PromQL/VRL/JavaScript
    // It's a fallback for cases where the AI doesn't use code blocks
    // For non-SQL languages, we rely on Strategies 1 & 2 (code blocks)
    const sqlKeywords = ['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'];
    const lines = response.split('\n');

    let sqlStart = -1;
    let sqlEnd = -1;

    // Find start of SQL statement
    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim().toUpperCase();
      if (sqlKeywords.some(keyword => trimmedLine.startsWith(keyword))) {
        sqlStart = i;
        break;
      }
    }

    if (sqlStart === -1) {
      return null; // No SQL found
    }

    // Find end of SQL statement (empty line or text that doesn't look like SQL)
    sqlEnd = sqlStart;
    for (let i = sqlStart + 1; i < lines.length; i++) {
      const line = lines[i].trim();

      // Empty line might indicate end
      if (!line) {
        sqlEnd = i - 1;
        break;
      }

      // Line that looks like explanatory text (starts with lowercase or markdown)
      if (/^[a-z*-]/.test(line)) {
        sqlEnd = i - 1;
        break;
      }

      sqlEnd = i;
    }

    // Extract SQL lines
    const sqlLines = lines.slice(sqlStart, sqlEnd + 1);
    const extractedSQL = sqlLines.join('\n').trim();

    return extractedSQL || null;
  };

  /**
   * Generates SQL query from natural language prompt using AI assistant
   *
   * @param prompt - Natural language prompt describing the query
   * @param orgId - Organization identifier
   * @returns Generated SQL query string, or null if generation fails
   *
   * Example:
   * ```typescript
   * const sql = await generateSQL('show errors from last hour', 'default');
   * // Returns: "SELECT * FROM logs WHERE level = 'error' AND _timestamp > now() - INTERVAL '1 hour'"
   * ```
   */
  const generateSQL = async (prompt: string, orgId: string, abortSignal?: AbortSignal, sessionId?: string): Promise<string | null> => {
    if (!prompt.trim()) {
      console.warn('[NL2Q] Empty prompt provided');
      return null;
    }

    console.log('[NL2Q] generateSQL called with:', { prompt, orgId });
    isGenerating.value = true;
    streamingResponse.value = ''; // Reset streaming response

    try {
      // Get page context (stream, time range, filters, etc.)
      // The logsContextProvider returns data in the correct format already
      const pageContext = await getStructuredContext();

      console.log('[NL2Q] Page context from logsContextProvider:', pageContext);

      // Build context for AI assistant matching backend expectations
      // pageContext already has: currentPage, organization_identifier, selectedStreams, sqlMode, etc.
      const context = {
        agent_type: 'query_assistant', // Use query assistant agent
        currentPage: pageContext?.currentPage || 'logs',
        organization_identifier: pageContext?.organization_identifier || orgId,
        selectedStreams: pageContext?.selectedStreams || ['default'],
        sqlMode: pageContext?.sqlMode || false,
        streamType: pageContext?.streamType || 'logs',
        timeRange: pageContext?.timeRange || {
          type: 'relative',
          relativeTimePeriod: '15m'
        },
        quickMode: pageContext?.quickMode || false,
        interestingFields: pageContext?.interestingFields || {},
        currentSQLQuery: pageContext?.currentSQLQuery || '',
        currentVRLQuery: pageContext?.currentVRLQuery || ''
      };

      console.log('[NL2Q] Formatted context for AI:', context);

      // Prepare messages for AI
      const messages = [
        {
          role: 'user',
          content: prompt, // Send the prompt as-is, let the AI assistant handle it with context
        },
      ];

      // Call AI assistant with streaming
      const response = await fetchAiChat(
        messages,
        '', // Use default model from server config
        orgId,
        abortSignal, // Abort signal for request cancellation
        context, // Explicit context with agent_type
        sessionId // Session ID for tracking across requests
      );

      if (!response || (response as any).cancelled) {
        console.log('[NL2Q] Request was cancelled');
        return null;
      }

      if (!(response as Response).ok) {
        console.error('[NL2Q] AI assistant returned error:', (response as Response).status);
        return null;
      }

      // Read streaming response
      const reader = (response as Response).body?.getReader();
      if (!reader) {
        console.error('[NL2Q] No reader available from response');
        return null;
      }

      const decoder = new TextDecoder();
      let generatedQuery = '';
      let chunkCount = 0;
      const toolCalls: Array<{tool: string, message: string, success?: boolean}> = [];
      const toolResults: Array<{tool: string, success: boolean, message: string}> = [];
      let hasError = false;
      let errorMessage = '';
      let lastMessageContent = ''; // Track latest message events for dashboard URLs

      console.log('[NL2Q] Starting to read streaming response...');

      try {
        while (true) {
          const { done, value } = await reader.read();
          chunkCount++;

          if (done) {
            console.log('[NL2Q] Streaming complete after', chunkCount, 'chunks');
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          console.log('[NL2Q] Received chunk', chunkCount, ':', chunk.substring(0, 100));

          // Parse SSE format: data: {...}\n\n
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

                // Handle different event types
                if (data.type === 'status') {
                  // Status event (processing, etc.)
                  console.log('[NL2Q] Status:', data.message);
                  streamingResponse.value = data.message || 'Processing...';
              } else if (data.type === 'message') {
                // Message event (AI planning/explanation text)
                console.log('[NL2Q] Message:', data.content?.substring(0, 100));
                lastMessageContent = data.content || '';
                streamingResponse.value = data.content?.substring(0, 100) || 'Processing...';
              } else if (data.type === 'tool_call') {
                // Track tool execution (dashboard/alert creation)
                console.log('[NL2Q] Tool call:', data.tool, '-', data.message);
                toolCalls.push({
                  tool: data.tool || 'unknown',
                  message: data.message || '',
                  success: undefined // Will be updated by tool_result
                });
                streamingResponse.value = data.message || `Executing ${data.tool}...`;
              } else if (data.type === 'tool_result') {
                // Tool execution result
                console.log('[NL2Q] Tool result:', data.tool, '- Success:', data.success);
                toolResults.push({
                  tool: data.tool || 'unknown',
                  success: data.success || false,
                  message: data.message || ''
                });

                // Update corresponding tool call with success status
                const lastToolCall = toolCalls[toolCalls.length - 1];
                if (lastToolCall) {
                  lastToolCall.success = data.success;
                }

                if (!data.success) {
                  streamingResponse.value = `Tool failed: ${data.message}`;
                }
              } else if (data.type === 'error') {
                // Error event
                console.error('[NL2Q] Error event:', data.error || data.message);
                hasError = true;
                errorMessage = data.error || data.message || 'Unknown error';
                streamingResponse.value = errorMessage;
              } else if (data.type === 'complete') {
                // Completion event - may contain full response in history
                console.log('[NL2Q] Completion event received');

                // Extract final response from history if available
                if (data.history && Array.isArray(data.history)) {
                  const lastMessage = data.history[data.history.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content) {
                    // If we haven't accumulated content yet, use the history
                    if (!generatedQuery.trim()) {
                      generatedQuery = lastMessage.content;
                      console.log('[NL2Q] Using content from completion history');
                    }
                    // Also update lastMessageContent for URL extraction
                    lastMessageContent = lastMessage.content;
                  }
                }
              } else if (data.type === 'title') {
                // Title event (ignore for now)
                console.log('[NL2Q] Title event:', data.title);
                } else if (data.content) {
                  // Content event (regular text)
                  generatedQuery += data.content;
                  streamingResponse.value = data.content;
                }
              } catch (e) {
                console.warn('[NL2Q] Failed to parse chunk JSON:', e);
              }
            }
          }
        }

        const rawResponse = generatedQuery.trim();
        console.log('[NL2Q] Full AI response received:', {
          length: rawResponse.length,
          preview: rawResponse.substring(0, 200),
          toolCalls: toolCalls.length,
          hasError
        });

        // Check for error first
        if (hasError) {
          console.error('[NL2Q] Response contains error:', errorMessage);
          return null;
        }

        if (!rawResponse && toolCalls.length === 0) {
          console.warn('[NL2Q] AI assistant returned empty response');
          return null;
        }

        // PRIORITY 1: Try to extract SQL from AI response first
        console.log('[NL2Q] Attempting to extract SQL from response...');
        const extractedSQL = extractSQLFromResponse(rawResponse);

        // If SQL was successfully extracted, return it (this is the primary goal)
        if (extractedSQL) {
          console.log('[NL2Q] Successfully generated SQL query:', extractedSQL);
          return extractedSQL;
        }

        // PRIORITY 2: Check if this is a non-SQL action (dashboard/alert creation)
        if (toolCalls.length > 0) {
          console.log('[NL2Q] Tool calls detected but no SQL found:', toolCalls);

          // Use lastMessageContent if available (has formatted response with URLs)
          const responseToReturn = lastMessageContent || rawResponse;

          // Check for successful dashboard creation (case-insensitive)
          const dashboardTool = toolCalls.find(tc => {
            const toolLower = tc.tool.toLowerCase();
            return (
              (toolLower === 'createdashboard' ||
               toolLower === 'create_dashboard' ||
               toolLower.includes('dashboard')) &&
              tc.success !== false // Only if not explicitly failed
            );
          });

          if (dashboardTool) {
            console.log('[NL2Q] Dashboard created successfully');
            return '✓ DASHBOARD_CREATED: ' + responseToReturn;
          }

          // Check for successful alert creation (case-insensitive)
          const alertTool = toolCalls.find(tc => {
            const toolLower = tc.tool.toLowerCase();
            return (
              (toolLower === 'createalert' ||
               toolLower === 'create_alert' ||
               toolLower.includes('alert')) &&
              tc.success !== false
            );
          });

          if (alertTool) {
            console.log('[NL2Q] Alert created successfully');
            return '✓ ALERT_CREATED: ' + responseToReturn;
          }

          // Check if any tool succeeded
          const hasSuccessfulTool = toolCalls.some(tc => tc.success === true);

          if (hasSuccessfulTool) {
            console.log('[NL2Q] Tool execution completed successfully');
            return '✓ ACTION_COMPLETED: ' + responseToReturn;
          }

          // All tools failed
          console.warn('[NL2Q] All tool executions failed');
          return null;
        }

        // Only if SQL extraction failed, check if AI is asking questions
        const questionPatterns = [
          /what is your organization/i,
          /I need to check/i,
          /I need the organization/i,
          /which stream/i,
          /what stream/i,
          /could you provide/i,
          /can you specify/i,
        ];

        const isQuestion = questionPatterns.some(pattern => pattern.test(rawResponse));

        if (isQuestion) {
          console.error('[NL2Q] AI returned questions instead of query. Context may be incomplete:', rawResponse);
          return null;
        }

        // No SQL, no tool calls, no questions - ambiguous response
        console.warn('[NL2Q] Could not determine response type. Full response:', rawResponse);
        return null;
      } finally {
        // Always release the reader to prevent memory leaks
        reader.releaseLock();
      }

    } catch (error) {
      console.error('[NL2Q] Error generating SQL:', error);
      return null;
    } finally {
      isGenerating.value = false;
    }
  };

  /**
   * Transforms editor content by converting natural language to language-specific comments
   * and appending the generated query
   *
   * @param originalNL - Original natural language text from editor
   * @param generatedQuery - Generated query from AI
   * @param language - Query language (sql, promql, vrl, javascript)
   * @returns Transformed text with NL as comments and query below
   *
   * Example:
   * ```typescript
   * const transformed = transformToSQL(
   *   'show errors from last hour',
   *   'SELECT * FROM logs WHERE level = \'error\'',
   *   'sql'
   * );
   * // Returns:
   * // -- show errors from last hour
   * // SELECT * FROM logs WHERE level = 'error'
   * ```
   */
  const transformToSQL = (originalNL: string, generatedQuery: string, language: string = 'sql'): string => {
    // Determine comment prefix based on language
    let commentPrefix = '--'; // Default: SQL
    const lang = language.toLowerCase();

    if (lang === 'promql') {
      commentPrefix = '#'; // PromQL uses # for comments
    } else if (lang === 'vrl' || lang === 'javascript' || lang === 'js') {
      commentPrefix = '//'; // VRL and JavaScript use // for comments
    }

    // Convert each line of natural language to language-specific comment
    const commentedNL = originalNL
      .split('\n')
      .map(line => `${commentPrefix} ${line}`)
      .join('\n');

    // Return commented NL + blank line + generated query
    return `${commentedNL}\n${generatedQuery}`;
  };

  return {
    detectNaturalLanguage,
    generateSQL,
    transformToSQL,
    isGenerating,
    streamingResponse, // Expose streaming response for real-time display
  };
}
