import { describe, it, expect, beforeEach } from 'vitest';
import { applyThemeColors } from './theme';
import type { SemanticColors } from './theme';

const SEMANTIC: SemanticColors = {
  error: '#F45B49',
  errorBg: '#FEF0EE',
  errorText: '#C0392B',
  success: '#5ACA7A',
  successBg: '#EAF9EF',
  successText: '#208A3C',
  secondaryBtnBg: '#EFF1FD',
  secondaryBtnText: '#575FC5',
  secondaryBtnBorder: '#C8D0F9',
};

describe('applyThemeColors with semanticColors', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.body.className = '';
    document.documentElement.className = '';
  });

  it('sets semantic tokens on documentElement in light mode', () => {
    applyThemeColors('#6B76E3', 'light', false, SEMANTIC);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-status-negative')).toBe('#F45B49');
    expect(style.getPropertyValue('--color-status-positive')).toBe('#5ACA7A');
    expect(style.getPropertyValue('--color-button-secondary')).toBe('#EFF1FD');
    expect(style.getPropertyValue('--color-button-secondary-foreground')).toBe('#575FC5');
    expect(style.getPropertyValue('--color-button-secondary-border')).toBe('#C8D0F9');
  });

  it('sets semantic tokens on body in dark mode', () => {
    applyThemeColors('#8B8DF0', 'dark', false, SEMANTIC);
    const style = document.body.style;
    expect(style.getPropertyValue('--color-status-negative')).toBe('#F45B49');
    expect(style.getPropertyValue('--color-status-positive')).toBe('#5ACA7A');
    expect(style.getPropertyValue('--color-button-secondary')).toBe('#EFF1FD');
  });

  it('clears semantic tokens from both targets when semanticColors is omitted', () => {
    applyThemeColors('#6B76E3', 'light', false, SEMANTIC);
    applyThemeColors('#7678ed', 'light', false);
    expect(document.documentElement.style.getPropertyValue('--color-status-negative')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-button-secondary')).toBe('');
    expect(document.body.style.getPropertyValue('--color-status-negative')).toBe('');
  });

  it('does not set semantic tokens when semanticColors is absent', () => {
    applyThemeColors('#7678ed', 'light', false);
    expect(document.documentElement.style.getPropertyValue('--color-theme-accent')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-status-negative')).toBe('');
  });

  it('clears stale body tokens when switching from dark to light with semanticColors', () => {
    applyThemeColors('#8B8DF0', 'dark', false, SEMANTIC);
    expect(document.body.style.getPropertyValue('--color-status-negative')).toBe('#F45B49');
    applyThemeColors('#6B76E3', 'light', false, SEMANTIC);
    expect(document.body.style.getPropertyValue('--color-status-negative')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-status-negative')).toBe('#F45B49');
  });
});
