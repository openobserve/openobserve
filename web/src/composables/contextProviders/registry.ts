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

import type { ContextProvider, PageContext } from './types';

class ContextRegistry {
  private providers: Map<string, ContextProvider> = new Map();
  private activeProvider: string | null = null;

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
    if (key === '') {
      // Allow clearing active provider
      this.activeProvider = null;
      return;
    }
    
    if (this.providers.has(key)) {
      this.activeProvider = key;
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
    // Try active provider first
    if (this.activeProvider) {
      const provider = this.providers.get(this.activeProvider);
      if (provider) {
        try {
          return await provider.getContext();
        } catch (error) {
          console.error('Error getting context from active provider:', error);
        }
      }
    }

    // Fallback to default provider if available
    const defaultProvider = this.providers.get('default');
    if (defaultProvider) {
      try {
        return await defaultProvider.getContext();
      } catch (error) {
        console.error('Error getting context from default provider:', error);
      }
    }

    return null;
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
  }
}

// Export singleton instance
export const contextRegistry = new ContextRegistry();
export default contextRegistry;