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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string; // Final/complete content for backward compat
  contentBlocks?: ContentBlock[]; // Sequential blocks for interleaved display
}

export interface ChatHistoryEntry {
  id: number;
  timestamp: string;
  title: string;
  messages: ChatMessage[];
  provider: string;
  model: string;
} 