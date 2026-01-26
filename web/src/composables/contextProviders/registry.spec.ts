// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeEach } from 'vitest';
import { contextRegistry } from './registry';
import type { ContextProvider } from './types';

describe('ContextRegistry', () => {
  beforeEach(() => {
    // Clean up before each test
    contextRegistry.cleanup();
  });

  describe('register', () => {
    it('should register a context provider', () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'test' })
      };

      contextRegistry.register('test', mockProvider);
      contextRegistry.setActive('test');

      expect(contextRegistry.getActiveContext()).resolves.toEqual({ currentPage: 'test' });
    });
  });

  describe('unregister', () => {
    it('should unregister a context provider', async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'test' })
      };

      contextRegistry.register('test', mockProvider);
      contextRegistry.setActive('test');
      contextRegistry.unregister('test');

      const result = await contextRegistry.getActiveContext();
      expect(result).toBeNull();
    });

    it('should clear active provider when unregistering it', async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'test' })
      };

      contextRegistry.register('test', mockProvider);
      contextRegistry.setActive('test');
      contextRegistry.unregister('test');

      const result = await contextRegistry.getActiveContext();
      expect(result).toBeNull();
    });
  });

  describe('setActive', () => {
    it('should set active provider', async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'logs' })
      };

      contextRegistry.register('logs', mockProvider);
      contextRegistry.setActive('logs');

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: 'logs' });
    });

    it('should clear active provider when set to empty string', async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'logs' })
      };

      contextRegistry.register('logs', mockProvider);
      contextRegistry.setActive('logs');
      contextRegistry.setActive('');

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });

    it('should not set active provider if key does not exist', async () => {
      contextRegistry.setActive('nonexistent');

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });
  });

  describe('getActiveContext', () => {
    it('should return context from active provider', async () => {
      const mockProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'alerts', alertName: 'Test' })
      };

      contextRegistry.register('alerts', mockProvider);
      contextRegistry.setActive('alerts');

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: 'alerts', alertName: 'Test' });
    });

    it('should fallback to default provider when no active provider', async () => {
      const defaultProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'default' })
      };

      contextRegistry.register('default', defaultProvider);

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: 'default' });
    });

    it('should return null when no providers registered', async () => {
      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });

    it('should handle errors from active provider gracefully', async () => {
      const errorProvider: ContextProvider = {
        getContext: () => {
          throw new Error('Provider error');
        }
      };

      contextRegistry.register('error', errorProvider);
      contextRegistry.setActive('error');

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });

    it('should fallback to default provider when active provider throws error', async () => {
      const errorProvider: ContextProvider = {
        getContext: () => {
          throw new Error('Active provider error');
        }
      };

      const defaultProvider: ContextProvider = {
        getContext: () => ({ currentPage: 'default' })
      };

      contextRegistry.register('error', errorProvider);
      contextRegistry.register('default', defaultProvider);
      contextRegistry.setActive('error');

      const context = await contextRegistry.getActiveContext();
      expect(context).toEqual({ currentPage: 'default' });
    });
  });

  describe('cleanup', () => {
    it('should clear all providers and reset active provider', async () => {
      const mockProvider1: ContextProvider = {
        getContext: () => ({ currentPage: 'test1' })
      };
      const mockProvider2: ContextProvider = {
        getContext: () => ({ currentPage: 'test2' })
      };

      contextRegistry.register('test1', mockProvider1);
      contextRegistry.register('test2', mockProvider2);
      contextRegistry.setActive('test1');

      contextRegistry.cleanup();

      const context = await contextRegistry.getActiveContext();
      expect(context).toBeNull();
    });
  });
});
