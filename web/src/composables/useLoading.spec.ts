import { describe, it, expect, vi } from "vitest";
import { useLoading } from "./useLoading";

describe("useLoading", () => {
  it("should initialize with correct default values", () => {
    const mockAsyncFunction = vi.fn().mockResolvedValue("success");
    const { isLoading, error, execute } = useLoading(mockAsyncFunction);

    expect(isLoading.value).toBe(false);
    expect(error.value).toBe(null);
    expect(typeof execute).toBe("function");
  });

  it("should set loading to true during execution", async () => {
    const mockAsyncFunction = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve("success"), 100))
    );
    const { isLoading, execute } = useLoading(mockAsyncFunction);

    expect(isLoading.value).toBe(false);

    const promise = execute();
    expect(isLoading.value).toBe(true);

    await promise;
    expect(isLoading.value).toBe(false);
  });

  it("should set loading to false after successful execution", async () => {
    const mockAsyncFunction = vi.fn().mockResolvedValue("success");
    const { isLoading, error, execute } = useLoading(mockAsyncFunction);

    await execute();

    expect(isLoading.value).toBe(false);
    expect(error.value).toBe(null);
  });

  it("should return the result from successful execution", async () => {
    const expectedResult = { data: "test data" };
    const mockAsyncFunction = vi.fn().mockResolvedValue(expectedResult);
    const { execute } = useLoading(mockAsyncFunction);

    const result = await execute();

    expect(result).toEqual(expectedResult);
    expect(mockAsyncFunction).toHaveBeenCalledTimes(1);
  });

  it("should handle errors and set error state", async () => {
    const errorMessage = "Something went wrong";
    const mockAsyncFunction = vi.fn().mockRejectedValue(new Error(errorMessage));
    const { isLoading, error, execute } = useLoading(mockAsyncFunction);

    await execute();

    expect(isLoading.value).toBe(false);
    expect(error.value).toBeInstanceOf(Error);
    expect(error.value.message).toBe(errorMessage);
  });

  it("should set loading to false after error", async () => {
    const mockAsyncFunction = vi.fn().mockRejectedValue(new Error("Error"));
    const { isLoading, execute } = useLoading(mockAsyncFunction);

    await execute();

    expect(isLoading.value).toBe(false);
  });

  it("should pass parameters to the async function", async () => {
    const mockAsyncFunction = vi.fn().mockResolvedValue("success");
    const { execute } = useLoading(mockAsyncFunction);

    await execute("param1", 42, { key: "value" });

    expect(mockAsyncFunction).toHaveBeenCalledWith("param1", 42, { key: "value" });
  });

  it("should pass multiple parameters correctly", async () => {
    const mockAsyncFunction = vi.fn((a, b, c) => Promise.resolve(a + b + c));
    const { execute } = useLoading(mockAsyncFunction);

    const result = await execute(1, 2, 3);

    expect(result).toBe(6);
    expect(mockAsyncFunction).toHaveBeenCalledWith(1, 2, 3);
  });

  it("should handle function with no parameters", async () => {
    const mockAsyncFunction = vi.fn().mockResolvedValue("no params");
    const { execute } = useLoading(mockAsyncFunction);

    const result = await execute();

    expect(result).toBe("no params");
    expect(mockAsyncFunction).toHaveBeenCalledWith();
  });

  it("should clear previous error when executing again", async () => {
    const mockAsyncFunction = vi
      .fn()
      .mockRejectedValueOnce(new Error("First error"))
      .mockResolvedValueOnce("Success");

    const { error, execute } = useLoading(mockAsyncFunction);

    // First execution with error
    await execute();
    expect(error.value).toBeInstanceOf(Error);
    expect(error.value.message).toBe("First error");

    // Second execution should clear error
    await execute();
    expect(error.value).toBe(null);
  });

  it("should handle different types of errors", async () => {
    const testCases = [
      new Error("Standard error"),
      "String error",
      { message: "Object error" },
      42,
      null,
      undefined,
    ];

    for (const errorValue of testCases) {
      const mockAsyncFunction = vi.fn().mockRejectedValue(errorValue);
      const { error, execute } = useLoading(mockAsyncFunction);

      await execute();

      if (typeof errorValue === "object" && errorValue !== null) {
        expect(error.value).toStrictEqual(errorValue);
      } else {
        expect(error.value).toBe(errorValue);
      }
    }
  });

  it("should handle multiple consecutive executions", async () => {
    const mockAsyncFunction = vi.fn()
      .mockResolvedValueOnce("result1")
      .mockResolvedValueOnce("result2")
      .mockResolvedValueOnce("result3");

    const { isLoading, error, execute } = useLoading(mockAsyncFunction);

    const result1 = await execute("param1");
    expect(result1).toBe("result1");
    expect(isLoading.value).toBe(false);
    expect(error.value).toBe(null);

    const result2 = await execute("param2");
    expect(result2).toBe("result2");
    expect(isLoading.value).toBe(false);
    expect(error.value).toBe(null);

    const result3 = await execute("param3");
    expect(result3).toBe("result3");
    expect(isLoading.value).toBe(false);
    expect(error.value).toBe(null);

    expect(mockAsyncFunction).toHaveBeenCalledTimes(3);
  });

  it("should handle promise that resolves with undefined", async () => {
    const mockAsyncFunction = vi.fn().mockResolvedValue(undefined);
    const { error, execute } = useLoading(mockAsyncFunction);

    const result = await execute();

    expect(result).toBe(undefined);
    expect(error.value).toBe(null);
  });

  it("should handle promise that resolves with null", async () => {
    const mockAsyncFunction = vi.fn().mockResolvedValue(null);
    const { error, execute } = useLoading(mockAsyncFunction);

    const result = await execute();

    expect(result).toBe(null);
    expect(error.value).toBe(null);
  });

  it("should handle promise that resolves with falsy values", async () => {
    const falsyValues = [false, 0, "", null, undefined];

    for (const value of falsyValues) {
      const mockAsyncFunction = vi.fn().mockResolvedValue(value);
      const { error, execute } = useLoading(mockAsyncFunction);

      const result = await execute();

      expect(result).toBe(value);
      expect(error.value).toBe(null);
    }
  });

  it("should handle complex data structures", async () => {
    const complexData = {
      users: [
        { id: 1, name: "John", preferences: { theme: "dark" } },
        { id: 2, name: "Jane", preferences: { theme: "light" } },
      ],
      metadata: {
        total: 2,
        page: 1,
        hasMore: false,
      },
      nested: {
        deep: {
          value: [1, 2, 3],
        },
      },
    };

    const mockAsyncFunction = vi.fn().mockResolvedValue(complexData);
    const { execute } = useLoading(mockAsyncFunction);

    const result = await execute();

    expect(result).toEqual(complexData);
  });

  it("should handle async function that throws synchronously", async () => {
    const mockAsyncFunction = vi.fn(() => {
      throw new Error("Synchronous error");
    });
    const { error, isLoading, execute } = useLoading(mockAsyncFunction);

    await execute();

    expect(error.value).toBeInstanceOf(Error);
    expect(error.value.message).toBe("Synchronous error");
    expect(isLoading.value).toBe(false);
  });

  it("should maintain state independence between multiple instances", async () => {
    const mockFunction1 = vi.fn().mockResolvedValue("result1");
    const mockFunction2 = vi.fn().mockRejectedValue(new Error("error2"));

    const instance1 = useLoading(mockFunction1);
    const instance2 = useLoading(mockFunction2);

    await instance1.execute();
    await instance2.execute();

    expect(instance1.error.value).toBe(null);
    expect(instance2.error.value).toBeInstanceOf(Error);
    expect(instance1.isLoading.value).toBe(false);
    expect(instance2.isLoading.value).toBe(false);
  });

  it("should handle rapid successive calls", async () => {
    const mockAsyncFunction = vi.fn()
      .mockResolvedValueOnce("result1")
      .mockResolvedValueOnce("result2")
      .mockResolvedValueOnce("result3");

    const { execute } = useLoading(mockAsyncFunction);

    const promises = [
      execute("call1"),
      execute("call2"), 
      execute("call3"),
    ];

    const results = await Promise.all(promises);

    expect(results).toEqual(["result1", "result2", "result3"]);
    expect(mockAsyncFunction).toHaveBeenCalledTimes(3);
  });

  it("should handle async function with mixed success and failure", async () => {
    const mockAsyncFunction = vi.fn()
      .mockResolvedValueOnce("success1")
      .mockRejectedValueOnce(new Error("error1"))
      .mockResolvedValueOnce("success2");

    const { error, execute } = useLoading(mockAsyncFunction);

    // First call - success
    const result1 = await execute();
    expect(result1).toBe("success1");
    expect(error.value).toBe(null);

    // Second call - error
    await execute();
    expect(error.value).toBeInstanceOf(Error);

    // Third call - success (should clear error)
    const result3 = await execute();
    expect(result3).toBe("success2");
    expect(error.value).toBe(null);
  });

  it("should handle very large parameter lists", async () => {
    const manyParams = Array.from({ length: 100 }, (_, i) => i);
    const mockAsyncFunction = vi.fn((...params) => Promise.resolve(params.reduce((a, b) => a + b, 0)));
    const { execute } = useLoading(mockAsyncFunction);

    const result = await execute(...manyParams);

    expect(result).toBe(4950); // Sum of numbers 0 to 99
    expect(mockAsyncFunction).toHaveBeenCalledWith(...manyParams);
  });
});