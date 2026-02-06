export interface ToolCall {
  tool: string;
  message: string;
  context: Record<string, any>;
}

// Content block for interleaved display (tool calls and text in order)
export interface ContentBlock {
  type: 'tool_call' | 'text';
  // For tool_call type:
  tool?: string;
  message?: string;
  context?: Record<string, any>;
  // For text type:
  text?: string;
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