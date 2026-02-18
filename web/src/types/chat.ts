export interface ToolCall {
  tool: string;
  message: string;
  context: Record<string, any>;
}

// Navigation action for UI navigation
export interface NavigationAction {
  resource_type: string;  // Generic - not enum limited (logs, metrics, traces, dashboard, alert, pipeline, etc.)
  action: 'load_query' | 'navigate_direct';
  label: string;
  target: {
    // For load_query action
    query?: string;
    sql_mode?: boolean;
    functionContent?: string;
    stream?: string[];
    from?: number;
    to?: number;
    period?: string;
    show_histogram?: boolean;

    // For navigate_direct action
    path?: string;
    query?: Record<string, any>;

    // Extensible - can add more fields
    [key: string]: any;
  };
}

// Content block for interleaved display (tool calls and text in order)
export interface ContentBlock {
  type: 'tool_call' | 'text' | 'error' | 'navigation';
  // For tool_call type:
  tool?: string;
  message?: string;
  context?: Record<string, any>;
  // For text type:
  text?: string;
  // Confirmation state (from confirmation_required events):
  pendingConfirmation?: boolean; // true = yellow waiting state with inline confirm/cancel buttons
  confirmationMessage?: string;  // message to display in confirmation state
  confirmationArgs?: Record<string, any>; // tool arguments to display for user review
  // Tool result data (from tool_result events):
  success?: boolean;           // true = green check, false = red error, undefined = legacy (treated as success)
  resultMessage?: string;      // message from tool_result event
  summary?: Record<string, any>; // summary from successful results (count, took, etc.)
  // Error data (from tool_result failures or stream-level error events):
  errorType?: string;          // error classification
  suggestion?: string;         // remediation hint
  details?: Record<string, any>; // error details
  recoverable?: boolean;       // for stream-level errors
  // Navigation action (from navigation_action events):
  navigationAction?: NavigationAction; // Optional navigation button for tool calls
}

// Image attachment for multimodal chat
export interface ImageAttachment {
  data: string;        // Base64-encoded image data
  mimeType: 'image/png' | 'image/jpeg';
  filename: string;
  size: number;        // Original file size in bytes (for display)
}

// Constants for image validation
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string; // Final/complete content for backward compat
  contentBlocks?: ContentBlock[]; // Sequential blocks for interleaved display
  images?: ImageAttachment[]; // Optional images for multimodal messages
}

export interface ChatHistoryEntry {
  id: number;
  timestamp: string;
  title: string;
  messages: ChatMessage[];
  sessionId?: string; // UUID v7 for tracking all API calls in this chat session
} 