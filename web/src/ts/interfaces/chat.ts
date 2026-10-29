import type { ContextChip } from "@/composables/assistant/pure";
import type { I18nText } from "@/types/i18n";

export interface ToolCall {
  tool: string;
  message: I18nText;
  context: Record<string, any>;
  call_id?: string; // Unique ID from ADK function_call.id for matching tool_result to tool_call
}

// Navigation action for UI navigation
export interface NavigationAction {
  resource_type: string; // Generic - not enum limited (logs, metrics, traces, dashboard, alert, pipeline, etc.)
  action: "load_query" | "navigate_direct";
  label: I18nText;
  target: {
    // For load_query action (string) or navigate_direct action (record)
    query?: string | Record<string, any>;
    sql_mode?: boolean;
    functionContent?: string;
    stream?: string[];
    from?: number;
    to?: number;
    period?: string;
    show_histogram?: boolean;

    // For navigate_direct action
    path?: string;

    // Extensible - can add more fields
    [key: string]: any;
  };
}

// Content block for interleaved display (tool calls and text in order)
export interface ContentBlock {
  type:
    | "tool_call"
    | "text"
    | "error"
    | "navigation"
    | "status"
    | "turn_outcome"
    | "attachment"
    | "trail"
    | "query"
    | "link"
    | "findings"
    | "footer"
    | "approval"
    | "approval_result"
    | "plan"
    | "policy"
    | "consent_note";
  // For tool_call type:
  tool?: string;
  message?: I18nText;
  context?: Record<string, any>;
  call_id?: string; // Unique ID for matching tool_result to tool_call
  // For text type:
  text?: string;
  // Confirmation state (from confirmation_required events):
  pendingConfirmation?: boolean; // true = yellow waiting state with inline confirm/cancel buttons
  confirmationMessage?: string; // message to display in confirmation state
  confirmationArgs?: Record<string, any>; // tool arguments to display for user review
  // Tool result data (from tool_result events):
  success?: boolean; // true = green check, false = red error, undefined = legacy (treated as success)
  resultMessage?: string; // message from tool_result event
  summary?: Record<string, any>; // summary from successful results (count, took, etc.)
  // Error data (from tool_result failures or stream-level error events):
  errorType?: string; // error classification
  suggestion?: string; // remediation hint
  details?: Record<string, any>; // error details
  recoverable?: boolean; // for stream-level errors
  ephemeral?: boolean; // shown in the live chat, never saved to history
  // Navigation action (from navigation_action events):
  navigationAction?: NavigationAction; // Optional navigation button for tool calls
  // Marker of a turn still being generated, or one the user stopped:
  turnStatus?: "running" | "stopped";
  // For turn_outcome type: how the turn ended, kept so a reload renders the same block.
  outcome?: TurnOutcomeRecord;
  // For attachment type: one delimiter block of a stored user message.
  attachment?: { name: string; body: string; hidden?: boolean };
}

/** The stored end of a turn that did not simply answer; ids, codes and the server's text only. */
export interface TurnOutcomeRecord {
  kind: "failed" | "stopped" | "doneNotSaved" | "expired" | "restored" | "cancelledElsewhere";
  code?: string;
  steps?: number;
  cancelUnconfirmed?: boolean;
  action?: string;
  retryable?: boolean;
  httpStatus?: number;
  traceId?: string;
  turnId?: string;
  sessionId?: string;
  serverMessage?: string;
  reason?: string;
  at?: number;
  /** How long the turn ran, for "Connection lost after {elapsed}". */
  elapsedMs?: number;
}

// Image attachment for multimodal chat
export interface ImageAttachment {
  /** The assistant composer's key for the image; filenames repeat across pastes. */
  id?: string;
  data: string; // Base64-encoded image data
  mimeType: "image/png" | "image/jpeg";
  filename: string;
  size: number; // Original file size in bytes (for display)
}

// Constants for image validation
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

export interface ChatMessage {
  role: "user" | "assistant";
  content: I18nText; // Final/complete content for backward compat
  contentBlocks?: ContentBlock[]; // Sequential blocks for interleaved display
  images?: ImageAttachment[]; // Optional images for multimodal messages
  feedback?: "thumbs_up" | "thumbs_down"; // User feedback vote for assistant messages
  /** Epoch ms the user sent the message. */
  sentAt?: number;
  /** Who wrote a user message, when not the reader (Slack-era records). */
  author?: string;
  /** Earlier attempts of an assistant answer, oldest first; the message itself is the latest. */
  versions?: ChatMessage[];
  /** The `x-o2-assistant-turn-id` of the turn this message belongs to. */
  turnId?: string;
  /** The context chips sent with a user message, as the composer held them. */
  chips?: ContextChip[];
  /** 1-based number of the user message an edit-and-resend came from. */
  editedFrom?: number;
  /** The window a "Re-run for now" prompt evaluates, epoch ms. */
  rerunFor?: { from: number; to: number };
  /** The page's absolute time window when the prompt was sent, epoch ms. */
  sentWindow?: { from: number; to: number };
}

/** Where one stored turn's messages sit in a folded message list, for incremental merges. */
export interface TurnSpan {
  turn_id?: string;
  first_seq?: number | null;
  last_seq?: number | null;
  /** Number of messages the turn produced. */
  count: number;
}

export interface ChatHistoryEntry {
  id: number;
  timestamp: string;
  title: I18nText;
  messages: ChatMessage[];
  sessionId?: string; // UUID v7 for tracking all API calls in this chat session
  userOrgKey?: string; // SHA-256 hash of "email:orgIdentifier" for per-user/org isolation
  // A cache of a server-stored chat; cachedLastSeq is unset while a live turn may still change it.
  serverBacked?: boolean;
  cachedLastSeq?: number;
  // The server's state_version for cachedLastSeq, so a status-only change is not served from cache.
  cachedStateVersion?: string;
  // Per-turn seq ranges of `messages`, so a stale cache can be topped up with only the newer turns.
  cachedTurnSpans?: TurnSpan[];
  forkedFromShare?: string;
  // The last turn this browser streamed into a live save; the save is ahead until the server has it settled.
  liveTurnId?: string;
  liveSavedAt?: number;
  // Not stored: the server could not return this chat's history.
  historyUnavailable?: boolean;
}
