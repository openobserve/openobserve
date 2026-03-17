// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, beforeEach, vi } from "vitest";
import attachments from "@/services/attachments";
import http from "@/services/http";
import axios from "axios";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock("axios", () => ({
  default: {
    put: vi.fn(),
  },
}));

describe("attachments service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("list", () => {
    it("should make GET request with all pagination and filter params", async () => {
      const page_num = 1;
      const page_size = 20;
      const sort_by = "name";
      const desc = false;
      const name = "screenshot";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await attachments.list(page_num, page_size, sort_by, desc, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/tickets?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
      );
    });

    it("should make GET request with desc=true", async () => {
      const page_num = 2;
      const page_size = 50;
      const sort_by = "created_at";
      const desc = true;
      const name = "report";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await attachments.list(page_num, page_size, sort_by, desc, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/tickets?page_num=2&page_size=50&sort_by=created_at&desc=true&name=report`
      );
    });

    it("should make GET request with empty name filter", async () => {
      const page_num = 1;
      const page_size = 10;
      const sort_by = "name";
      const desc = false;
      const name = "";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await attachments.list(page_num, page_size, sort_by, desc, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/tickets?page_num=1&page_size=10&sort_by=name&desc=false&name=`
      );
    });

    it("should make GET request with large page_size", async () => {
      const page_num = 1;
      const page_size = 100;
      const sort_by = "size";
      const desc = true;
      const name = "log";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await attachments.list(page_num, page_size, sort_by, desc, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/tickets?page_num=1&page_size=100&sort_by=size&desc=true&name=log`
      );
    });
  });

  describe("getPresignedUrl", () => {
    it("should make GET request with object key and file type", async () => {
      const objectkey = "uploads/my-file.png";
      const fileType = "image/png";

      mockHttpInstance.get.mockResolvedValue({
        data: { url: "https://s3.amazonaws.com/presigned-url" },
      });

      await attachments.getPresignedUrl(objectkey, fileType);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/attachements/${objectkey}?fileType=${fileType}`
      );
    });

    it("should make GET request with different object key and file type", async () => {
      const objectkey = "attachments/document.pdf";
      const fileType = "application/pdf";

      mockHttpInstance.get.mockResolvedValue({
        data: { url: "https://s3.amazonaws.com/another-presigned-url" },
      });

      await attachments.getPresignedUrl(objectkey, fileType);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/attachements/${objectkey}?fileType=${fileType}`
      );
    });

    it("should make GET request with a plain filename as objectkey", async () => {
      const objectkey = "image.jpg";
      const fileType = "image/jpeg";

      mockHttpInstance.get.mockResolvedValue({ data: { url: "https://example.com/presigned" } });

      await attachments.getPresignedUrl(objectkey, fileType);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/attachements/image.jpg?fileType=image/jpeg`
      );
    });
  });

  describe("upload", () => {
    it("should call axios.put directly with URL, data, and Content-Type header", async () => {
      const url = "https://s3.amazonaws.com/presigned-upload-url";
      const data = new Blob(["file content"], { type: "image/png" });

      (axios.put as any).mockResolvedValue({ status: 200 });

      await attachments.upload(url, data);

      expect(axios.put).toHaveBeenCalledWith(url, data, {
        headers: {
          "Content-Type": data.type,
        },
      });
    });

    it("should call axios.put with pdf content type", async () => {
      const url = "https://s3.amazonaws.com/pdf-upload-url";
      const data = new Blob(["pdf content"], { type: "application/pdf" });

      (axios.put as any).mockResolvedValue({ status: 200 });

      await attachments.upload(url, data);

      expect(axios.put).toHaveBeenCalledWith(url, data, {
        headers: {
          "Content-Type": "application/pdf",
        },
      });
    });

    it("should NOT use the http() factory for upload — uses axios directly", async () => {
      const url = "https://s3.amazonaws.com/some-url";
      const data = new Blob(["content"], { type: "text/plain" });

      (axios.put as any).mockResolvedValue({ status: 200 });

      await attachments.upload(url, data);

      expect(http).not.toHaveBeenCalled();
      expect(axios.put).toHaveBeenCalledTimes(1);
    });
  });

  describe("create", () => {
    it("should make POST request to create a ticket with data payload", async () => {
      const data = {
        title: "My attachment ticket",
        description: "Uploading files",
        files: ["file1.png", "file2.pdf"],
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "ticket-123" } });

      await attachments.create(data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/tickets", data);
    });

    it("should make POST request with minimal data payload", async () => {
      const data = { title: "Minimal ticket" };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "ticket-456" } });

      await attachments.create(data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/tickets", data);
    });
  });

  describe("delete", () => {
    it("should make DELETE request with ticket name", async () => {
      const names = "ticket-123";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await attachments.delete(names);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(`/api/tickets/${names}`);
    });

    it("should make DELETE request with a different ticket name", async () => {
      const names = "attachment-abc";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await attachments.delete(names);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(`/api/tickets/${names}`);
    });
  });

  describe("error handling", () => {
    it("should propagate errors from list", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        attachments.list(1, 20, "name", false, "test")
      ).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from getPresignedUrl", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        attachments.getPresignedUrl("my-file.png", "image/png")
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from upload (axios)", async () => {
      const error = new Error("S3 upload failed");
      (axios.put as any).mockRejectedValue(error);

      await expect(
        attachments.upload("https://s3.amazonaws.com/url", new Blob(["data"], { type: "text/plain" }))
      ).rejects.toThrow("S3 upload failed");
    });

    it("should propagate errors from create", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        attachments.create({ title: "failing ticket" })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Not found");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        attachments.delete("non-existent-ticket")
      ).rejects.toThrow("Not found");
    });
  });
});
