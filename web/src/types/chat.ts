export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatHistoryEntry {
  id: number;
  timestamp: string;
  title: string;
  messages: ChatMessage[];
  provider: string;
  model: string;
} 