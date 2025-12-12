/**
 * Focus Manager for Alert Form
 *
 * Provides a centralized system for managing focus/highlight states across the alert form.
 * This allows clicking on summary text to jump to the corresponding form field.
 *
 * Usage:
 * 1. Register form fields with their refs in the parent component
 * 2. In the summary, wrap clickable text with data-focus-target attribute
 * 3. On click, call focusField() to scroll to and highlight the field
 */

export interface FocusableField {
  ref: any; // Vue ref or DOM element
  highlightDuration?: number; // Optional custom highlight duration in ms
  onBeforeFocus?: () => void; // Optional callback to run before focusing (e.g., expand collapsed sections)
}

export class AlertFocusManager {
  private fields: Map<string, FocusableField> = new Map();
  private highlightTimeouts: Map<string, number> = new Map();

  /**
   * Register a form field that can be focused
   * @param fieldId Unique identifier for the field (e.g., 'stream', 'frequency', 'threshold')
   * @param field The field configuration with ref
   */
  registerField(fieldId: string, field: FocusableField) {
    this.fields.set(fieldId, field);
  }

  /**
   * Unregister a field
   */
  unregisterField(fieldId: string) {
    this.fields.delete(fieldId);
    const timeout = this.highlightTimeouts.get(fieldId);
    if (timeout) {
      clearTimeout(timeout);
      this.highlightTimeouts.delete(fieldId);
    }
  }

  /**
   * Focus and highlight a field
   * @param fieldId The field to focus
   * @param behavior Scroll behavior ('smooth' or 'auto')
   */
  focusField(fieldId: string, behavior: ScrollBehavior = 'smooth') {
    const field = this.fields.get(fieldId);
    if (!field) {
      console.warn(`Field "${fieldId}" not registered in focus manager`);
      return;
    }

    // Call onBeforeFocus callback if it exists (e.g., to expand collapsed sections)
    if (field.onBeforeFocus) {
      field.onBeforeFocus();

      // Wait for Vue to render the expanded section before accessing DOM
      // Use longer timeout to ensure section is fully expanded and rendered
      setTimeout(() => {
        this.performFocus(fieldId, field, behavior);
      }, 300);
    } else {
      this.performFocus(fieldId, field, behavior);
    }
  }

  /**
   * Perform the actual focus operation
   * @private
   */
  private performFocus(fieldId: string, field: FocusableField, behavior: ScrollBehavior) {
    // Get the DOM element
    let element: HTMLElement | null = null;

    // Try different ways to access the Vue component's DOM element
    if (field.ref?.value?.$el) {
      // Vue 3 component ref with $el
      element = field.ref.value.$el;
    } else if (field.ref?.value) {
      // Vue 3 ref that might be a direct DOM element
      element = field.ref.value;
    } else if (field.ref?.$el) {
      // Vue 2 component ref
      element = field.ref.$el;
    } else if (field.ref instanceof HTMLElement) {
      // Direct DOM element
      element = field.ref;
    }

    if (!element) {
      return;
    }

    // If we got a text node or comment node, try to find the parent element
    if (element.nodeType !== Node.ELEMENT_NODE) {
      const parentElement = element.parentElement;
      if (parentElement) {
        element = parentElement;
      } else {
        return;
      }
    }

    // Find the input element within the component
    const inputElement = this.findFocusableElement(element);

    // Scroll to the element with a small delay to ensure rendering is complete
    setTimeout(() => {
      element.scrollIntoView({
        behavior,
        block: 'center',
        inline: 'nearest'
      });

      // Add highlight class
      element.classList.add('alert-field-highlight');
    }, 50);

    // Clear any existing timeout
    const existingTimeout = this.highlightTimeouts.get(fieldId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Remove highlight after duration
    const duration = field.highlightDuration || 2500;
    const timeout = window.setTimeout(() => {
      element?.classList.remove('alert-field-highlight');
      this.highlightTimeouts.delete(fieldId);
    }, duration);

    this.highlightTimeouts.set(fieldId, timeout);

    // Focus the input if found
    if (inputElement) {
      setTimeout(() => {
        inputElement.focus();
      }, 300); // Small delay for smooth scrolling
    }
  }

  /**
   * Find a focusable input element within a container
   */
  private findFocusableElement(container: HTMLElement): HTMLElement | null {
    // Look for common input types
    const selectors = [
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '.q-field__native', // Quasar input
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const element = container.querySelector(selector) as HTMLElement;
      if (element && !element.hasAttribute('disabled') && !element.hasAttribute('readonly')) {
        return element;
      }
    }

    return null;
  }

  /**
   * Clear all fields and timeouts
   */
  clear() {
    this.highlightTimeouts.forEach(timeout => clearTimeout(timeout));
    this.highlightTimeouts.clear();
    this.fields.clear();
  }
}

// Create a singleton instance
export const alertFocusManager = new AlertFocusManager();
