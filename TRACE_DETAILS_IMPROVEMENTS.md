# Trace Details UI Improvements - Design Document

**Version:** 1.0
**Date:** 2026-02-16
**Status:** Implementation Phase
**Parent Doc:** [TRACE_DETAILS_DESIGN.md](./TRACE_DETAILS_DESIGN.md)

---

## Overview

This document details five key improvements to the OpenObserve Trace Details interface, focusing on enhanced visualization, better layout ergonomics, and support for multiple viewing modes. These changes aim to provide a more intuitive and powerful trace analysis experience.

---

## 1. Improve Service Colors

### 1.1 Problem Statement

**Current Issues:**

- Limited color palette makes it difficult to distinguish between services in traces with 10+ services
- Colors are not semantically meaningful or visually distinct enough
- Difficult to track a specific service's spans across a complex trace timeline
- No consistency between trace views (same service may appear with different colors)

**User Impact:**

- Users struggle to follow request flow through multiple services
- Visual confusion when analyzing traces with many microservices
- Reduced efficiency in identifying service bottlenecks

### 1.2 Solution Design

**50-Color Palette System:**

- Implement a carefully curated palette of 50 distinct, high-contrast colors
- Colors designed for accessibility (WCAG 2.1 AA compliance)
- Support for both light and dark themes
- Consistent color assignment per service name across all views

---

## 2. Move Span Details to Bottom Panel

### 2.1 Problem Statement

**Current Issues:**

- Right sidebar for span details consumes 30-40% of horizontal space
- Reduces timeline visibility, making it harder to see span relationships
- Horizontal scrolling required for wide attribute values
- Poor use of vertical space on modern wide monitors
- Context switching between timeline and details is visually jarring

**User Impact:**

- Timeline feels cramped on laptop screens (< 1400px width)
- Difficult to read long attribute values or error messages
- Reduced productivity due to constant sidebar resizing

### 2.2 Solution Design

**Bottom Panel Layout:**

- **Position:** Docked at bottom of screen, above timeline
- **Default Height:** 250px (30% of viewport height)
- **Resizable:** Drag top border to resize (min: 150px, max: 60% viewport)
- **Collapsible:** Click to collapse/expand, maintains last height in session storage
- **Animation:** Smooth 200ms slide-up/down transition

**Benefits:**

- **More Timeline Space:** Reclaim 30-40% horizontal space for timeline
- **Better Readability:** Wider panel accommodates long text without wrapping
- **Natural Flow:** Eyes move vertically from span to details
- **Multi-Monitor:** Better use of wide screens common in development

---

## 3. Remove "Trace Timeline" Header from TraceDetails

### 3.1 Problem Statement

**Current Issues:**

- Redundant "Trace Timeline" title consumes vertical space
- Users understand they're viewing a trace without explicit label
- Reduces available space for actual trace data
- Adds visual clutter without functional value

**User Impact:**

- Less content visible without scrolling (especially on laptops)
- Visual hierarchy unclear with multiple competing headers

### 3.2 Solution Design

**Header Simplification:**

**Remove:**

- ❌ "Trace Timeline" text label
- ❌ Redundant trace metadata already shown elsewhere

---

## 4. Add Tabs for Different Views

### 4.1 Problem Statement

**Current State:**

- Only waterfall/timeline view available
- No alternative visualizations for different analysis needs
- Users forced to export data for different analysis types
- Difficult to switch context between hierarchical and tabular analysis

**User Needs:**

- **Waterfall View:** See spans over time (current view)
- **Flame Graph:** Understand call hierarchy and hot paths
- **Spans Table:** Filter, sort, and export span data
- **Service Map:** Visualize service dependencies _(future)_

```
---

## 5. Improve Exceptions View for LLM Traces

### 5.1 Problem Statement

**Current Issues:**
- LLM traces contain unique exception patterns not well-displayed
- LLM-specific errors buried in generic attributes
- No specialized rendering for:
  - Token limit errors
  - Rate limiting errors
  - Model timeout errors
  - Invalid prompt errors
  - API authentication failures
- Difficult to debug LLM application errors quickly
- Error messages often contain long JSON payloads that are hard to read

**LLM-Specific Challenges:**
- Token usage often exceeds limits → need clear visibility
- Rate limit errors → need to see quota/usage info
- Model responses may contain errors in structured format
- Prompt/completion pairs hard to review in error cases

### 5.2 Solution Design

**Enhanced Exception Panel for LLM Spans:**

When a span with `span.kind = "LLM"` or `gen_ai.*` attributes contains an error:

#### 5.2.1 LLM Error Card Layout

```

┌─────────────────────────────────────────────────────────┐
│ ⚠️ LLM Error: Token Limit Exceeded │
├─────────────────────────────────────────────────────────┤
│ Model: gpt-4 │
│ Provider: OpenAI │
│ Error Code: context_length_exceeded │
│ Error Type: InvalidRequestError │
├─────────────────────────────────────────────────────────┤
│ 📊 Token Usage: │
│ Prompt Tokens: 7,891 tokens │
│ Completion Tokens: 0 tokens │
│ Total: 7,891 / 8,192 tokens (96.3%) ⚠️ │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▓▓▓▓▓▓▓▓▓▓▓▓ Max │
├─────────────────────────────────────────────────────────┤
│ 💬 Error Message: │
│ This model's maximum context length is 8192 tokens. │
│ However, your messages resulted in 7891 tokens. │
├─────────────────────────────────────────────────────────┤
│ 🔍 Recommendations: │
│ • Reduce prompt length by 700+ tokens │
│ • Use a model with larger context (gpt-4-32k) │
│ • Implement prompt compression or summarization │
└─────────────────────────────────────────────────────────┘

```

#### 5.2.2 Detected LLM Error Types

**1. Token Limit Errors**
- **Detection:** `error.message` contains "token", "context", "length", "exceeded"
- **Display:**
  - Token usage bar chart (prompt vs. completion vs. max)
  - Percentage over limit highlighted in red
  - Recommendation: upgrade model or reduce prompt
- **Attributes to Extract:**
  - `gen_ai.usage.prompt_tokens`
  - `gen_ai.usage.completion_tokens`
  - `gen_ai.request.max_tokens`
  - `gen_ai.response.model` (for suggesting alternatives)

**2. Rate Limit Errors**
- **Detection:** `error.code` = "rate_limit_exceeded" or HTTP 429
- **Display:**
  - Current rate limit status (requests/min, tokens/min)
  - When rate limit resets (countdown timer)
  - Retry-after header value
  - Request count in last minute
- **Attributes to Extract:**
  - `http.status_code = 429`
  - `http.response.header.retry_after`
  - `gen_ai.provider.rate_limit.requests`
  - `gen_ai.provider.rate_limit.tokens`

**3. Model Timeout Errors**
- **Detection:** `error.type` = "timeout" or `http.status_code = 504`
- **Display:**
  - Actual timeout duration vs. configured timeout
  - Model response time histogram
  - Suggestion to increase timeout or use streaming
- **Attributes to Extract:**
  - `gen_ai.request.timeout`
  - `http.request.timeout`
  - Duration of span (to show how long it took before timeout)

**4. Invalid Prompt Errors**
- **Detection:** `error.code` = "invalid_prompt" or "content_policy_violation"
- **Display:**
  - Prompt snippet (truncated if too long)
  - Specific violation reason
  - Link to content policy documentation
- **Attributes to Extract:**
  - `gen_ai.prompt` (truncate to 500 chars)
  - `error.violation_type`
  - `error.policy_url`

**5. Authentication Errors**
- **Detection:** `error.code` = "invalid_api_key" or HTTP 401/403
- **Display:**
  - API key last 4 characters (for identification)
  - Provider authentication endpoint
  - Link to API key management
- **Attributes to Extract:**
  - `http.status_code = 401 | 403`
  - `gen_ai.provider` (e.g., "openai", "anthropic")

#### 5.2.3 LLM Error Attributes Panel

**Dedicated "LLM Error" Tab in Span Details:**

When span has LLM-related error, add special tab:

```

┌──────────────────────────────────────────────────────┐
│ Tabs: [Overview] [Attributes] [Events] [LLM Error] │
└──────────────────────────────────────────────────────┘

LLM Error Tab Content:

┌──────────────────────────────────────────────────────┐
│ 🤖 LLM Request Details │
├──────────────────────────────────────────────────────┤
│ Model: gpt-4-turbo-preview │
│ Provider: OpenAI │
│ Temperature: 0.7 │
│ Max Tokens: 4096 │
│ Stream: false │
├──────────────────────────────────────────────────────┤
│ 📝 Prompt (7,891 tokens) [Copy] [View]│
│ ┌────────────────────────────────────────────────┐ │
│ │ You are a helpful assistant... │ │
│ │ [Truncated - Click "View" to see full prompt] │ │
│ └────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│ ⚠️ Error Response │
│ ┌────────────────────────────────────────────────┐ │
│ │ { │ │
│ │ "error": { │ │
│ │ "message": "This model's maximum...", │ │
│ │ "type": "invalid_request_error", │ │
│ │ "param": null, │ │
│ │ "code": "context_length_exceeded" │ │
│ │ } │ │
│ │ } │ │
│ └────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│ 🔧 Debug Actions │
│ [Copy Error JSON] [View in Playground] [Report Bug] │
└──────────────────────────────────────────────────────┘

```

#### 5.2.4 Visual Enhancements

**Error Highlighting in Timeline:**
- LLM error spans have special red border pattern (dotted)
- Icon overlay: 🤖⚠️ (robot + warning)
- Tooltip on hover shows error type immediately

**Error Summary Dashboard:**
Add to Analytics Panel when LLM errors present:

```

┌──────────────────────────────────────────┐
│ 🤖 LLM Errors Summary │
├──────────────────────────────────────────┤
│ Total LLM Calls: 12 │
│ Failed: 3 (25%) │
│ │
│ Error Breakdown: │
│ • Token Limit: 2 errors │
│ • Rate Limit: 1 error │
│ • Timeout: 0 errors │
│ │
│ [View All LLM Errors] │
└──────────────────────────────────────────┘

````

### 5.3 Implementation Details

**Detection Logic:**

```typescript
function isLLMSpan(span: Span): boolean {
  return (
    span.kind === 'LLM' ||
    span.attributes['gen_ai.system'] !== undefined ||
    span.attributes['gen_ai.request.model'] !== undefined ||
    span.name.includes('llm') ||
    span.name.includes('openai') ||
    span.name.includes('anthropic')
  );
}

function categorizeLLMError(span: Span): LLMErrorType {
  const errorMsg = span.attributes['error.message']?.toLowerCase() || '';
  const errorCode = span.attributes['error.code']?.toLowerCase() || '';
  const httpStatus = span.attributes['http.status_code'];

  if (errorMsg.includes('token') || errorMsg.includes('context_length')) {
    return 'TOKEN_LIMIT';
  }
  if (errorCode.includes('rate_limit') || httpStatus === 429) {
    return 'RATE_LIMIT';
  }
  if (errorCode.includes('timeout') || httpStatus === 504) {
    return 'TIMEOUT';
  }
  if (errorCode.includes('invalid_prompt') || errorCode.includes('content_policy')) {
    return 'INVALID_PROMPT';
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return 'AUTH_ERROR';
  }
  return 'UNKNOWN';
}
````

**Component Structure:**

```
web/src/components/traces/
├── SpanDetailsPanel.vue (add LLM Error tab)
├── LLMErrorCard.vue (new component)
├── LLMTokenUsageBar.vue (new component)
├── LLMErrorRecommendations.vue (new component)
└── LLMPromptViewer.vue (new component - modal for long prompts)
```

**Attributes Mapping (OpenTelemetry Semantic Conventions):**

```typescript
interface LLMSpanAttributes {
  // Model info
  "gen_ai.system": string; // e.g., "openai", "anthropic"
  "gen_ai.request.model": string; // e.g., "gpt-4"
  "gen_ai.response.model": string;

  // Token usage
  "gen_ai.usage.prompt_tokens": number;
  "gen_ai.usage.completion_tokens": number;
  "gen_ai.request.max_tokens": number;

  // Error info
  "error.type": string;
  "error.message": string;
  "error.code": string;

  // HTTP info
  "http.status_code": number;
  "http.response.header.retry_after": string;

  // Request parameters
  "gen_ai.request.temperature": number;
  "gen_ai.request.top_p": number;
  "gen_ai.prompt": string;
  "gen_ai.completion": string;
}
```

### 5.4 Success Metrics

- LLM error resolution time reduced by 50%
- Users can identify root cause of LLM failures in < 30 seconds
- 90% of LLM errors categorized correctly
- Positive feedback from AI/ML engineers on error visibility

---

## 6. Implementation Plan

### Phase 1: Layout & Colors (Week 1)

- ✅ Implement 50-color palette (`traceColors.ts`)
- ✅ Update timeline to use new colors
- 🚧 Move span details to bottom panel
- 🚧 Remove "Trace Timeline" header, add compact metadata bar

### Phase 2: Multi-View Tabs (Week 2-3)

- 📋 Add tab navigation bar to TraceDetailsV2
- 📋 Implement Flame Graph view component
- 📋 Implement Spans Table view component
- 📋 Add view switching logic and state persistence
- 📋 Ensure filters work across all views

### Phase 3: LLM Error Enhancements (Week 4)

- 📋 Create LLMErrorCard component
- 📋 Implement error type detection logic
- 📋 Add LLM Error tab to SpanDetailsPanel
- 📋 Create token usage visualization
- 📋 Add error recommendations engine

### Phase 4: Polish & Testing (Week 5)

- 📋 Responsive design testing
- 📋 Cross-browser compatibility
- 📋 Performance optimization
- 📋 User acceptance testing
- 📋 Documentation

---

## 7. Success Criteria

### User Experience

- [ ] Users can distinguish between 15+ services visually
- [ ] Span details panel provides 40% more horizontal timeline space
- [ ] Users can switch between views in < 1 second
- [ ] LLM errors are immediately identifiable and actionable

### Performance

- [ ] Color assignment: < 10ms for 50 services
- [ ] Panel resize: smooth 60fps animation
- [ ] Flame graph render: < 500ms for 200 spans
- [ ] Table view: handle 1000+ spans without lag

### Adoption

- [ ] 80% of users try Flame Graph view within first week
- [ ] 60% of users resize bottom panel to preferred height
- [ ] 90% positive feedback on new color system
- [ ] Zero complaints about "Trace Timeline" removal

---

## 8. References

- **Parent Document:** [TRACE_DETAILS_DESIGN.md](./TRACE_DETAILS_DESIGN.md)
- **OpenTelemetry Semantic Conventions:** [https://opentelemetry.io/docs/specs/semconv/](https://opentelemetry.io/docs/specs/semconv/)
- **GenAI Semantic Conventions:** [https://opentelemetry.io/docs/specs/semconv/gen-ai/](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- **Flame Graph Visualization:** [https://www.brendangregg.com/flamegraphs.html](https://www.brendangregg.com/flamegraphs.html)

---

**Status:** Ready for Implementation
**Next Review:** After Phase 1 completion
**Questions/Feedback:** [Link to discussion thread]
