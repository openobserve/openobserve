import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import store from '@/test/unit/helpers/store';

// Mock the store
vi.mock('@/stores', () => ({
  default: store
}));

import useAiChat from './useAiChat';

// Mock fetch globally
const mockFetch = vi.fn();
Object.defineProperty(global, 'fetch', {
  value: mockFetch,
  writable: true,
  configurable: true
});

describe('useAiChat', () => {
  let aiChatComposable: ReturnType<typeof useAiChat>;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    mockFetch.mockReset();
    
    // Reset global fetch mock
    Object.defineProperty(global, 'fetch', {
      value: mockFetch,
      writable: true,
      configurable: true
    });
    
    // Create a fresh instance of the composable for each test
    aiChatComposable = useAiChat();
    
    // Clear any existing context handler
    aiChatComposable.removeAiChatHandler();
  });

  afterEach(() => {
    // Clean up after each test
    aiChatComposable.removeAiChatHandler();
  });

  describe('Composable Structure', () => {
    it('should return all expected methods', () => {
      expect(aiChatComposable).toHaveProperty('fetchAiChat');
      expect(aiChatComposable).toHaveProperty('registerAiChatHandler');
      expect(aiChatComposable).toHaveProperty('removeAiChatHandler');
      expect(aiChatComposable).toHaveProperty('getContext');
      expect(aiChatComposable).toHaveProperty('getFormattedContext');
      expect(aiChatComposable).toHaveProperty('tryToJson');
    });

    it('should return methods as functions', () => {
      expect(typeof aiChatComposable.fetchAiChat).toBe('function');
      expect(typeof aiChatComposable.registerAiChatHandler).toBe('function');
      expect(typeof aiChatComposable.removeAiChatHandler).toBe('function');
      expect(typeof aiChatComposable.getContext).toBe('function');
      expect(typeof aiChatComposable.getFormattedContext).toBe('function');
      expect(typeof aiChatComposable.tryToJson).toBe('function');
    });

    it('should maintain separate instances', () => {
      const instance1 = useAiChat();
      const instance2 = useAiChat();
      
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('registerAiChatHandler', () => {
    it('should register a valid function handler', () => {
      const mockHandler = vi.fn().mockResolvedValue('test context');
      
      expect(() => aiChatComposable.registerAiChatHandler(mockHandler)).not.toThrow();
    });

    it('should register a non-function handler', () => {
      const nonFunctionHandler = 'not a function';
      
      expect(() => aiChatComposable.registerAiChatHandler(nonFunctionHandler)).not.toThrow();
    });

    it('should register null as handler', () => {
      expect(() => aiChatComposable.registerAiChatHandler(null)).not.toThrow();
    });

    it('should register undefined as handler', () => {
      expect(() => aiChatComposable.registerAiChatHandler(undefined)).not.toThrow();
    });

    it('should register an object as handler', () => {
      const objectHandler = { some: 'object' };
      
      expect(() => aiChatComposable.registerAiChatHandler(objectHandler)).not.toThrow();
    });

    it('should overwrite previously registered handler', async () => {
      const handler1 = vi.fn().mockResolvedValue('context1');
      const handler2 = vi.fn().mockResolvedValue('context2');
      
      aiChatComposable.registerAiChatHandler(handler1);
      aiChatComposable.registerAiChatHandler(handler2);
      
      const context = await aiChatComposable.getContext();
      
      expect(context).toBe('context2');
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('removeAiChatHandler', () => {
    it('should remove registered handler', async () => {
      const mockHandler = vi.fn().mockResolvedValue('test context');
      
      aiChatComposable.registerAiChatHandler(mockHandler);
      aiChatComposable.removeAiChatHandler();
      
      const context = await aiChatComposable.getContext();
      
      expect(context).toBe('');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should work when no handler is registered', () => {
      expect(() => aiChatComposable.removeAiChatHandler()).not.toThrow();
    });

    it('should work when called multiple times', () => {
      aiChatComposable.removeAiChatHandler();
      
      expect(() => aiChatComposable.removeAiChatHandler()).not.toThrow();
    });
  });

  describe('getContext', () => {
    it('should return empty string when no handler is registered', async () => {
      const context = await aiChatComposable.getContext();
      
      expect(context).toBe('');
    });

    it('should return empty string when handler is null', async () => {
      aiChatComposable.registerAiChatHandler(null);
      
      const context = await aiChatComposable.getContext();
      
      expect(context).toBe('');
    });

    it('should return empty string when handler is not a function', async () => {
      aiChatComposable.registerAiChatHandler('not a function');
      
      const context = await aiChatComposable.getContext();
      
      expect(context).toBe('');
    });

    it('should call and return result from valid handler', async () => {
      const mockContext = 'test context data';
      const mockHandler = vi.fn().mockResolvedValue(mockContext);
      
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      const context = await aiChatComposable.getContext();
      
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(context).toBe(mockContext);
    });

    it('should handle async handler that resolves', async () => {
      const mockContext = { data: 'async context' };
      const mockHandler = vi.fn().mockResolvedValue(mockContext);
      
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      const context = await aiChatComposable.getContext();
      
      expect(context).toEqual(mockContext);
    });

    it('should handle async handler that rejects', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      await expect(aiChatComposable.getContext()).rejects.toThrow('Handler failed');
    });
  });

  describe('tryToJson', () => {
    it('should convert simple object to JSON string', () => {
      const obj = { name: 'test', value: 123 };
      
      const result = aiChatComposable.tryToJson(obj);
      
      expect(result).toBe(JSON.stringify(obj));
    });

    it('should convert array to JSON string', () => {
      const arr = [1, 2, 'three', { four: 4 }];
      
      const result = aiChatComposable.tryToJson(arr);
      
      expect(result).toBe(JSON.stringify(arr));
    });

    it('should convert string to JSON string', () => {
      const str = 'test string';
      
      const result = aiChatComposable.tryToJson(str);
      
      expect(result).toBe(JSON.stringify(str));
    });

    it('should convert number to JSON string', () => {
      const num = 42;
      
      const result = aiChatComposable.tryToJson(num);
      
      expect(result).toBe(JSON.stringify(num));
    });

    it('should convert boolean to JSON string', () => {
      const bool = true;
      
      const result = aiChatComposable.tryToJson(bool);
      
      expect(result).toBe(JSON.stringify(bool));
    });

    it('should convert null to JSON string', () => {
      const result = aiChatComposable.tryToJson(null);
      
      expect(result).toBe(JSON.stringify(null));
    });

    it('should return original value when JSON.stringify throws error', () => {
      const circularObj: any = {};
      circularObj.self = circularObj; // Creates circular reference
      
      const result = aiChatComposable.tryToJson(circularObj);
      
      expect(result).toBe(circularObj);
    });

    it('should handle undefined value', () => {
      const result = aiChatComposable.tryToJson(undefined);
      
      // undefined gets returned as-is when JSON.stringify fails
      expect(result).toBe(undefined);
    });

    it('should handle complex nested object', () => {
      const complexObj = {
        level1: {
          level2: {
            array: [1, 2, { nested: 'value' }],
            string: 'test'
          }
        }
      };
      
      const result = aiChatComposable.tryToJson(complexObj);
      
      expect(result).toBe(JSON.stringify(complexObj));
    });
  });

  describe('getFormattedContext', () => {
    it('should format message with simple context object', () => {
      const message = { content: 'Hello world' };
      const context = { user: 'john', role: 'admin' };
      
      const result = aiChatComposable.getFormattedContext(message, context);
      
      expect(result).toContain('Hello world');
      expect(result).toContain('Context');
      expect(result).toContain('user: "john"');
      expect(result).toContain('role: "admin"');
    });

    it('should format message with complex context', () => {
      const message = { content: 'Test message' };
      const context = {
        user: { name: 'John', id: 123 },
        settings: { theme: 'dark', lang: 'en' },
        permissions: ['read', 'write']
      };
      
      const result = aiChatComposable.getFormattedContext(message, context);
      
      expect(result).toContain('Test message');
      expect(result).toContain('Context');
      expect(result).toContain('user: {"name":"John","id":123}');
      expect(result).toContain('settings: {"theme":"dark","lang":"en"}');
      expect(result).toContain('permissions: ["read","write"]');
    });

    it('should handle empty context object', () => {
      const message = { content: 'Test message' };
      const context = {};
      
      const result = aiChatComposable.getFormattedContext(message, context);
      
      expect(result).toContain('Test message');
      expect(result).toContain('Context');
    });

    it('should handle message with empty content', () => {
      const message = { content: '' };
      const context = { key: 'value' };
      
      const result = aiChatComposable.getFormattedContext(message, context);
      
      expect(result).toContain('Context');
      expect(result).toContain('key: "value"');
    });

    it('should handle context with circular reference', () => {
      const message = { content: 'Test' };
      const context: any = { name: 'test' };
      context.self = context;
      
      const result = aiChatComposable.getFormattedContext(message, context);
      
      expect(result).toContain('Test');
      expect(result).toContain('Context');
      expect(result).toContain('name: "test"');
      // The circular reference should be handled by tryToJson
    });

    it('should format multiple context entries correctly', () => {
      const message = { content: 'Query' };
      const context = {
        a: 1,
        b: 'string',
        c: true,
        d: null,
        e: [1, 2, 3]
      };
      
      const result = aiChatComposable.getFormattedContext(message, context);
      
      expect(result).toContain('a: 1');
      expect(result).toContain('b: "string"');
      expect(result).toContain('c: true');
      expect(result).toContain('d: null');
      expect(result).toContain('e: [1,2,3]');
    });
  });

  describe('fetchAiChat', () => {
    const mockMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' }
    ];

    beforeEach(() => {
      // Reset fetch mock
      mockFetch.mockReset();
    });

    it('should make API call with correct URL and body when model is provided', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const model = 'gpt-4';
      const orgId = 'test-org';
      
      const result = await aiChatComposable.fetchAiChat(mockMessages, model, orgId);
      
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:5080/api/test-org/ai/chat_stream`,
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'traceparent': expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
          }),
          body: JSON.stringify({ model, messages: mockMessages })
        })
      );
      expect(result).toBe(mockResponse);
    });

    it('should make API call without model when model is empty string', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const model = '';
      const orgId = 'test-org';
      
      await aiChatComposable.fetchAiChat(mockMessages, model, orgId);
      
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:5080/api/test-org/ai/chat_stream`,
        expect.objectContaining({
          body: JSON.stringify({ messages: mockMessages })
        })
      );
    });

    it('should not mutate original messages array', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const originalMessages = [...mockMessages];
      
      await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      expect(mockMessages).toEqual(originalMessages);
    });

    it('should add context to last message when context handler is registered', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const mockContext = { user: 'test', session: '123' };
      const mockHandler = vi.fn().mockResolvedValue(mockContext);
      
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      
      expect(lastMessage.content).toContain('How are you?');
      expect(lastMessage.content).toContain('Context');
      expect(lastMessage.content).toContain('user: "test"');
      expect(lastMessage.content).toContain('session: "123"');
    });

    it('should not add context when no handler is registered', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      
      expect(lastMessage.content).toBe('How are you?');
    });

    it('should handle fetch success response', async () => {
      const mockResponse = { 
        ok: true, 
        status: 200,
        json: vi.fn().mockResolvedValue({ result: 'success' })
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      expect(result).toBe(mockResponse);
    });

    it('should handle fetch error response', async () => {
      const mockResponse = { 
        ok: false, 
        status: 500,
        statusText: 'Internal Server Error'
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      expect(result).toBe(mockResponse);
    });

    it('should return null when fetch throws an error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValue(new Error('Network error'));
      
      const result = await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching AI chat:', expect.any(Error));
      
      consoleErrorSpy.mockRestore();
    });

    it('should handle different organization IDs correctly', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'different-org');
      
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:5080/api/different-org/ai/chat_stream`,
        expect.any(Object)
      );
    });

    it('should handle empty messages array', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      await aiChatComposable.fetchAiChat([], 'gpt-4', 'test-org');
      
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      
      expect(requestBody.messages).toEqual([]);
    });

    it('should handle single message array', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const singleMessage = [{ role: 'user', content: 'Single message' }];
      
      await aiChatComposable.fetchAiChat(singleMessage, 'gpt-4', 'test-org');
      
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      
      expect(requestBody.messages).toHaveLength(1);
      expect(requestBody.messages[0].content).toBe('Single message');
    });

    it('should work with context handler that returns empty string', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const mockHandler = vi.fn().mockResolvedValue('');
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      
      expect(lastMessage.content).toBe('How are you?');
    });

    it('should work with context handler that returns null', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const mockHandler = vi.fn().mockResolvedValue(null);
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      await aiChatComposable.fetchAiChat(mockMessages, 'gpt-4', 'test-org');
      
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      
      expect(lastMessage.content).toBe('How are you?');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete workflow with context', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const mockContext = { workspace: 'test', user_id: 'user123' };
      const mockHandler = vi.fn().mockResolvedValue(mockContext);
      
      // Register handler
      aiChatComposable.registerAiChatHandler(mockHandler);
      
      // Verify context can be retrieved
      const context = await aiChatComposable.getContext();
      expect(context).toEqual(mockContext);
      
      // Make API call
      const messages = [{ role: 'user', content: 'Test query' }];
      await aiChatComposable.fetchAiChat(messages, 'gpt-4', 'org123');
      
      // Verify the call was made with formatted context
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      
      expect(requestBody.messages[0].content).toContain('Test query');
      expect(requestBody.messages[0].content).toContain('Context');
      expect(requestBody.messages[0].content).toContain('workspace: "test"');
      expect(requestBody.messages[0].content).toContain('user_id: "user123"');
    });

    it('should handle handler removal during workflow', async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);
      
      const mockHandler = vi.fn().mockResolvedValue({ data: 'test' });
      
      // Register and then remove handler
      aiChatComposable.registerAiChatHandler(mockHandler);
      aiChatComposable.removeAiChatHandler();
      
      // Make API call
      const messages = [{ role: 'user', content: 'Test' }];
      await aiChatComposable.fetchAiChat(messages, 'gpt-4', 'org123');
      
      // Verify no context was added
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      
      expect(requestBody.messages[0].content).toBe('Test');
    });
  });
});