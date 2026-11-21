/**
 * Context Registry - Singleton pattern for managing active context providers
 *
 * Example Usage:
 * ```typescript
 * // Register a context provider
 * const logsProvider = { getContext: () => ({ pageType: 'logs', data: {} }) };
 * contextRegistry.register('logs', logsProvider);
 *
 * // Set active provider
 * contextRegistry.setActive('logs');
 *
 * // Get current context
 * const context = await contextRegistry.getActiveContext();
 * ```
 */

import { shallowRef, type ShallowRef } from "vue";

import type { ContextProvider, PageContext } from "./types";

class ContextRegistry {
  private providers: Map<string, ContextProvider> = new Map();
  private activeProvider: string | null = null;
  // Nested editors push over their parent and pop only their own entry (constraint 39).
  private stack: { key: string; provider: ContextProvider }[] = [];

  /** Bumped on every change, so a reactive reader re-reads the context. */
  readonly version: ShallowRef<number> = shallowRef(0);

  /**
   * Register a context provider for a specific page/component
   *
   * @param key - Unique identifier for the provider
   * @param provider - The context provider implementation
   *
   * Example:
   * ```typescript
   * register('logs', logsContextProvider);
   * ```
   */
  register(key: string, provider: ContextProvider): void {
    this.providers.set(key, provider);
    this.bump();
  }

  /** Puts a nested editor's provider on top; the same key replaces its own earlier entry. */
  push(key: string, provider: ContextProvider): void {
    this.stack = [...this.stack.filter((entry) => entry.key !== key), { key, provider }];
    this.bump();
  }

  /** Removes only this key's entry, so a parent's provider survives a child's unmount. */
  pop(key: string): void {
    this.stack = this.stack.filter((entry) => entry.key !== key);
    this.bump();
  }

  /**
   * Unregister a context provider
   *
   * @param key - Key of the provider to remove
   *
   * Example:
   * ```typescript
   * unregister('logs'); // Removes logs context provider
   * ```
   */
  unregister(key: string): void {
    this.providers.delete(key);

    // If the active provider was removed, clear it
    if (this.activeProvider === key) {
      this.activeProvider = null;
    }
    this.bump();
  }

  /**
   * Set the currently active context provider
   *
   * @param key - Key of the provider to activate (empty string to clear active provider)
   *
   * Example:
   * ```typescript
   * setActive('logs'); // Activates logs context provider
   * setActive(''); // Clears active provider, falls back to default
   * ```
   */
  setActive(key: string): void {
    if (key === "") {
      // Allow clearing active provider
      this.activeProvider = null;
      this.bump();
      return;
    }

    if (this.providers.has(key)) {
      this.activeProvider = key;
      this.bump();
    }
  }

  /**
   * Get context from the currently active provider, with fallback to default provider
   *
   * @returns Promise<PageContext | null> - The current context, default context, or null if no providers
   *
   * Example:
   * ```typescript
   * const context = await getActiveContext();
   * if (context) {
   *   console.log('Current page:', context.currentPage);
   * }
   * ```
   */
  async getActiveContext(): Promise<PageContext | null> {
    return this.resolve(this.stack);
  }

  /** The context a pushed provider sits on: the entries pushed before `key`, else the page's provider. */
  async getContextBelow(key: string): Promise<PageContext | null> {
    const index = this.stack.findIndex((entry) => entry.key === key);
    return this.resolve(index === -1 ? this.stack : this.stack.slice(0, index));
  }

  /**
   * Clean up registry by removing all providers and resetting active provider
   *
   * Example:
   * ```typescript
   * cleanup(); // Clears all registered providers
   * ```
   */
  cleanup(): void {
    this.providers.clear();
    this.activeProvider = null;
    this.stack = [];
    this.bump();
  }

  private async resolve(
    stack: { key: string; provider: ContextProvider }[],
  ): Promise<PageContext | null> {
    const top = stack[stack.length - 1];
    if (top) {
      try {
        return await top.provider.getContext();
      } catch (error) {
        console.error("Error getting context from pushed provider:", error);
      }
    }

    // Try active provider first
    if (this.activeProvider) {
      const provider = this.providers.get(this.activeProvider);
      if (provider) {
        try {
          return await provider.getContext();
        } catch (error) {
          console.error("Error getting context from active provider:", error);
        }
      }
    }

    // Fallback to default provider if available
    const defaultProvider = this.providers.get("default");
    if (defaultProvider) {
      try {
        return await defaultProvider.getContext();
      } catch (error) {
        console.error("Error getting context from default provider:", error);
      }
    }

    return null;
  }

  private bump(): void {
    this.version.value += 1;
  }
}

// Export singleton instance
export const contextRegistry = new ContextRegistry();
export default contextRegistry;
