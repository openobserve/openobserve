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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the store before importing httpsearch so its state is available
vi.mock("../stores", () => ({
  default: {
    state: {
      API_ENDPOINT: "http://localhost:5080",
    },
    dispatch: vi.fn(),
  },
}));

// Mock the router (httpsearch imports it but does not use it directly)
vi.mock("../router", () => ({
  default: {},
}));

// Mock Quasar's Notify
vi.mock("quasar", () => ({
  Notify: {
    create: vi.fn(),
  },
}));

// Mock axios so we can control the interceptor chain
vi.mock("axios", () => {
  const mockInterceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };

  const mockInstance = {
    interceptors: mockInterceptors,
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  return {
    default: {
      create: vi.fn(() => mockInstance),
    },
  };
});

import axios from "axios";
import { Notify } from "quasar";
import store from "../stores";
import httpsearch from "./httpsearch";

describe("httpsearch service", () => {
  let mockAxiosInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAxiosInstance = {
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };

    (axios.create as any).mockReturnValue(mockAxiosInstance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("factory function", () => {
    it("should call axios.create to build an instance", () => {
      httpsearch();

      expect(axios.create).toHaveBeenCalledTimes(1);
    });

    it("should pass the store API_ENDPOINT as baseURL", () => {
      httpsearch();

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: "http://localhost:5080" })
      );
    });

    it("should return the axios instance", () => {
      const instance = httpsearch();

      expect(instance).toBe(mockAxiosInstance);
    });

    it("should register a response interceptor on each call", () => {
      httpsearch();

      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalledTimes(1);
    });

    it("should register the response interceptor with a success handler and an error handler", () => {
      httpsearch();

      const [successHandler, errorHandler] =
        mockAxiosInstance.interceptors.response.use.mock.calls[0];

      expect(typeof successHandler).toBe("function");
      expect(typeof errorHandler).toBe("function");
    });

    it("should create a fresh axios instance on every invocation", () => {
      httpsearch();
      httpsearch();
      httpsearch();

      expect(axios.create).toHaveBeenCalledTimes(3);
    });
  });

  describe("response interceptor — success handler", () => {
    it("should pass through a successful response unchanged", () => {
      httpsearch();

      const [successHandler] = mockAxiosInstance.interceptors.response.use.mock.calls[0];

      const mockResponse = { status: 200, data: { streams: [] } };
      const result = successHandler(mockResponse);

      expect(result).toBe(mockResponse);
    });

    it("should not call Notify.create for a successful response", () => {
      httpsearch();

      const [successHandler] = mockAxiosInstance.interceptors.response.use.mock.calls[0];

      successHandler({ status: 200, data: {} });

      expect(Notify.create).not.toHaveBeenCalled();
    });
  });

  describe("response interceptor — error handler", () => {
    let errorHandler: (error: any) => Promise<any>;

    beforeEach(() => {
      httpsearch();
      errorHandler = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
    });

    it("should reject with the error when there is no response object", async () => {
      const rawError = new Error("Network failure");

      await expect(errorHandler(rawError)).rejects.toThrow("Network failure");
    });

    it("should reject with the error when the error has no status", async () => {
      const errorWithoutStatus = { response: { data: {} } };

      await expect(errorHandler(errorWithoutStatus)).rejects.toEqual(errorWithoutStatus);
    });

    describe("400 Bad Request", () => {
      it("should call Notify.create with the error message", async () => {
        const error = {
          response: { status: 400, data: { error: "Invalid query parameter" } },
        };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            color: "red-5",
            icon: "warning",
            message: JSON.stringify("Invalid query parameter"),
          })
        );
      });

      it("should fall back to 'Bad Request' when error field is absent", async () => {
        const error = { response: { status: 400, data: {} } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            message: JSON.stringify("Bad Request"),
          })
        );
      });

      it("should JSON-stringify the error message for 400", async () => {
        const error = {
          response: { status: 400, data: { error: "Some bad request detail" } },
        };

        await expect(errorHandler(error)).rejects.toEqual(error);

        const notifyArg = (Notify.create as any).mock.calls[0][0];
        // message should be a JSON-stringified value
        expect(notifyArg.message).toBe('"Some bad request detail"');
      });

      it("should show the notification in the bottom-right with progress", async () => {
        const error = { response: { status: 400, data: { error: "Bad param" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            position: "bottom-right",
            progress: true,
            multiLine: true,
          })
        );
      });
    });

    describe("401 Unauthorized", () => {
      it("should call Notify.create with the error message", async () => {
        const error = {
          response: { status: 401, data: { error: "Token expired" } },
        };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            color: "red-5",
            icon: "warning",
            message: "Token expired",
          })
        );
      });

      it("should fall back to 'Invalid credentials' when error field is absent", async () => {
        const error = { response: { status: 401, data: {} } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Invalid credentials" })
        );
      });

      it("should dispatch the logout action to the store", async () => {
        const error = { response: { status: 401, data: { error: "Unauthorized" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(store.dispatch).toHaveBeenCalledWith("logout");
      });

      it("should clear localStorage", async () => {
        const clearSpy = vi.spyOn(Storage.prototype, "clear");
        const error = { response: { status: 401, data: {} } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(clearSpy).toHaveBeenCalled();
      });

      it("should show the notification in the bottom-right with progress", async () => {
        const error = { response: { status: 401, data: { error: "Unauthorized" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            position: "bottom-right",
            progress: true,
            multiLine: true,
          })
        );
      });
    });

    describe("404 Not Found", () => {
      it("should call Notify.create with the error message", async () => {
        const error = {
          response: { status: 404, data: { error: "Stream not found" } },
        };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            color: "red-5",
            icon: "warning",
            message: "Stream not found",
          })
        );
      });

      it("should fall back to 'Not Found' when error field is absent", async () => {
        const error = { response: { status: 404, data: {} } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Not Found" })
        );
      });

      it("should show the notification in the bottom-right with progress", async () => {
        const error = { response: { status: 404, data: { error: "Not Found" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            position: "bottom-right",
            progress: true,
            multiLine: true,
          })
        );
      });
    });

    describe("500 Internal Server Error", () => {
      it("should call Notify.create with the JSON-stringified error message", async () => {
        const error = {
          response: { status: 500, data: { error: "Database connection failed" } },
        };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            color: "red-5",
            icon: "warning",
            message: JSON.stringify("Database connection failed"),
          })
        );
      });

      it("should fall back to 'Internal ServerError' when error field is absent", async () => {
        const error = { response: { status: 500, data: {} } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            message: JSON.stringify("Internal ServerError"),
          })
        );
      });

      it("should JSON-stringify the error message for 500", async () => {
        const error = {
          response: { status: 500, data: { error: "Something went wrong" } },
        };

        await expect(errorHandler(error)).rejects.toEqual(error);

        const notifyArg = (Notify.create as any).mock.calls[0][0];
        expect(notifyArg.message).toBe('"Something went wrong"');
      });

      it("should show the notification in the bottom-right with progress", async () => {
        const error = { response: { status: 500, data: { error: "Server error" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            position: "bottom-right",
            progress: true,
            multiLine: true,
          })
        );
      });
    });

    describe("unhandled status codes", () => {
      it("should not call Notify.create for a 403 error", async () => {
        const error = { response: { status: 403, data: { error: "Forbidden" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).not.toHaveBeenCalled();
      });

      it("should not call Notify.create for a 429 error", async () => {
        const error = { response: { status: 429, data: { error: "Too Many Requests" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).not.toHaveBeenCalled();
      });

      it("should not call Notify.create for a 503 error", async () => {
        const error = { response: { status: 503, data: { error: "Service Unavailable" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);

        expect(Notify.create).not.toHaveBeenCalled();
      });

      it("should still reject the promise for unhandled status codes", async () => {
        const error = { response: { status: 422, data: { error: "Unprocessable Entity" } } };

        await expect(errorHandler(error)).rejects.toEqual(error);
      });
    });

    describe("always rejects", () => {
      it("should always return a rejected promise regardless of status", async () => {
        const statuses = [400, 401, 404, 500, 200, 201, 403];

        for (const status of statuses) {
          const error = { response: { status, data: { error: "msg" } } };
          await expect(errorHandler(error)).rejects.toEqual(error);
        }
      });
    });
  });
});
