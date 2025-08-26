import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Store lifecycle callbacks for testing
let onDeactivatedCallback: any;
let onActivatedCallback: any;
let onMountedCallback: any;
let onBeforeUnmountCallback: any;
let onUnmountedCallback: any;

// Mock Vue lifecycle hooks individually
vi.mock("vue", () => {
  const actualRef = (value: any) => ({ value });
  return {
    ref: actualRef,
    onUnmounted: vi.fn().mockImplementation((callback) => { onUnmountedCallback = callback; }),
    onDeactivated: vi.fn().mockImplementation((callback) => { onDeactivatedCallback = callback; }),
    onActivated: vi.fn().mockImplementation((callback) => { onActivatedCallback = callback; }),
    onMounted: vi.fn().mockImplementation((callback) => { onMountedCallback = callback; }),
    onBeforeUnmount: vi.fn().mockImplementation((callback) => { onBeforeUnmountCallback = callback; }),
  };
});

// Import the function under test
import { useCustomDebouncer } from "./useCustomDebouncer";

describe("useCustomDebouncer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with the provided initial value", () => {
    const initialValue = "test";
    const delay = 500;
    const { valueRef } = useCustomDebouncer(initialValue, delay);
    
    expect(valueRef.value).toBe(initialValue);
  });

  it("should set value immediately using setImmediateValue", () => {
    const initialValue = "initial";
    const newValue = "immediate";
    const delay = 500;
    const { valueRef, setImmediateValue } = useCustomDebouncer(initialValue, delay);
    
    setImmediateValue(newValue);
    
    expect(valueRef.value).toBe(newValue);
  });

  it("should debounce value changes using setDebounceValue", () => {
    const initialValue = "initial";
    const newValue = "debounced";
    const delay = 500;
    const { valueRef, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    setDebounceValue(newValue);
    
    // Value should not change immediately
    expect(valueRef.value).toBe(initialValue);
    
    // Fast-forward time
    vi.advanceTimersByTime(delay);
    
    // Value should now be updated
    expect(valueRef.value).toBe(newValue);
  });

  it("should reset timeout and use latest value when setDebounceValue is called multiple times", () => {
    const initialValue = "initial";
    const firstValue = "first";
    const secondValue = "second";
    const delay = 500;
    const { valueRef, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    setDebounceValue(firstValue);
    
    // Fast-forward time partially
    vi.advanceTimersByTime(200);
    
    // Value should still be initial
    expect(valueRef.value).toBe(initialValue);
    
    // Set another value (this should reset the timeout)
    setDebounceValue(secondValue);
    
    // Fast-forward time partially again
    vi.advanceTimersByTime(200);
    
    // Value should still be initial
    expect(valueRef.value).toBe(initialValue);
    
    // Fast-forward remaining time
    vi.advanceTimersByTime(300);
    
    // Value should be the second value (latest one)
    expect(valueRef.value).toBe(secondValue);
  });

  it("should not set value when component is deactivated", () => {
    const initialValue = "initial";
    const newValue = "new";
    const delay = 500;
    const { valueRef, setImmediateValue, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    // Simulate component deactivation
    onDeactivatedCallback();
    
    // Try to set immediate value
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(initialValue); // Should not change
    
    // Try to set debounced value
    setDebounceValue(newValue);
    vi.advanceTimersByTime(delay);
    expect(valueRef.value).toBe(initialValue); // Should not change
  });

  it("should reactivate and allow value changes after onActivated", () => {
    const initialValue = "initial";
    const newValue = "activated";
    const delay = 500;
    const { valueRef, setImmediateValue, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    // Simulate deactivation first
    onDeactivatedCallback();
    
    // Try to set value (should not work)
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(initialValue);
    
    // Simulate activation
    onActivatedCallback();
    
    // Now value changes should work
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(newValue);
  });

  it("should activate component on mount", () => {
    const initialValue = "initial";
    const newValue = "mounted";
    const delay = 500;
    const { valueRef, setImmediateValue } = useCustomDebouncer(initialValue, delay);
    
    // Simulate mount
    onMountedCallback();
    
    // Value changes should work after mount
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(newValue);
  });

  it("should clear timeout and deactivate on beforeUnmount", () => {
    const initialValue = "initial";
    const newValue = "beforeUnmount";
    const delay = 500;
    const { valueRef, setDebounceValue, setImmediateValue } = useCustomDebouncer(initialValue, delay);
    
    // Set a debounced value
    setDebounceValue(newValue);
    
    // Simulate beforeUnmount
    onBeforeUnmountCallback();
    
    // Fast-forward time
    vi.advanceTimersByTime(delay);
    
    // Value should not change due to beforeUnmount clearing timeout
    expect(valueRef.value).toBe(initialValue);
    
    // Try immediate value after beforeUnmount
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(initialValue); // Should not change
  });

  it("should clear timeout and deactivate on unmount", () => {
    const initialValue = "initial";
    const newValue = "unmount";
    const delay = 500;
    const { valueRef, setDebounceValue, setImmediateValue } = useCustomDebouncer(initialValue, delay);
    
    // Set a debounced value
    setDebounceValue(newValue);
    
    // Simulate unmount
    onUnmountedCallback();
    
    // Fast-forward time
    vi.advanceTimersByTime(delay);
    
    // Value should not change due to unmount clearing timeout
    expect(valueRef.value).toBe(initialValue);
    
    // Try immediate value after unmount
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(initialValue); // Should not change
  });

  it("should handle resetTimeout when no timeout exists", () => {
    const initialValue = "initial";
    const newValue = "immediate";
    const delay = 500;
    const { valueRef, setImmediateValue } = useCustomDebouncer(initialValue, delay);
    
    // Call setImmediateValue twice (second call should call resetTimeout when timeout is null)
    setImmediateValue(newValue);
    expect(valueRef.value).toBe(newValue);
    
    setImmediateValue("second");
    expect(valueRef.value).toBe("second");
  });

  it("should work with zero delay", () => {
    const initialValue = "initial";
    const newValue = "zero-delay";
    const delay = 0;
    const { valueRef, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    setDebounceValue(newValue);
    
    // Even with zero delay, setTimeout is still async
    expect(valueRef.value).toBe(initialValue);
    
    // Advance timers
    vi.advanceTimersByTime(0);
    
    expect(valueRef.value).toBe(newValue);
  });

  it("should handle mixed immediate and debounced operations", () => {
    const initialValue = "initial";
    const immediateValue = "immediate";
    const debouncedValue = "debounced";
    const delay = 500;
    const { valueRef, setImmediateValue, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    // Set debounced value first
    setDebounceValue(debouncedValue);
    expect(valueRef.value).toBe(initialValue);
    
    // Set immediate value (should clear debounced timeout and set immediately)
    setImmediateValue(immediateValue);
    expect(valueRef.value).toBe(immediateValue);
    
    // Advance time - debounced value should not apply
    vi.advanceTimersByTime(delay);
    expect(valueRef.value).toBe(immediateValue);
  });

  it("should work with different types of initial values", () => {
    // Test with number
    const { valueRef: numberRef, setImmediateValue: setNumberImmediate } = useCustomDebouncer(0, 100);
    expect(numberRef.value).toBe(0);
    setNumberImmediate(42);
    expect(numberRef.value).toBe(42);
    
    // Test with object
    const initialObj = { key: "value" };
    const newObj = { key: "newValue" };
    const { valueRef: objRef, setImmediateValue: setObjImmediate } = useCustomDebouncer(initialObj, 100);
    expect(objRef.value).toEqual(initialObj);
    setObjImmediate(newObj);
    expect(objRef.value).toEqual(newObj);
    
    // Test with array
    const initialArray = [1, 2, 3];
    const newArray = [4, 5, 6];
    const { valueRef: arrayRef, setImmediateValue: setArrayImmediate } = useCustomDebouncer(initialArray, 100);
    expect(arrayRef.value).toEqual(initialArray);
    setArrayImmediate(newArray);
    expect(arrayRef.value).toEqual(newArray);
  });

  it("should handle lifecycle events after debounce is set", () => {
    const initialValue = "initial";
    const debouncedValue = "debounced";
    const delay = 500;
    const { valueRef, setDebounceValue } = useCustomDebouncer(initialValue, delay);
    
    // Set debounced value
    setDebounceValue(debouncedValue);
    expect(valueRef.value).toBe(initialValue);
    
    // Trigger deactivation during debounce
    onDeactivatedCallback();
    
    // Advance time
    vi.advanceTimersByTime(delay);
    
    // Value should not change due to component being inactive
    expect(valueRef.value).toBe(initialValue);
    
    // Reactivate and try again
    onActivatedCallback();
    setDebounceValue(debouncedValue);
    vi.advanceTimersByTime(delay);
    
    // Now it should work
    expect(valueRef.value).toBe(debouncedValue);
  });
});