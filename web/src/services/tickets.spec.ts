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

import { describe, expect, it, vi, beforeEach } from "vitest";
import tickets from "@/services/tickets";
import http from "@/services/http";

vi.mock("@/services/http");

describe("Tickets Service", () => {
  const mockHttp = vi.mocked(http);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should fetch tickets list with pagination and filters", async () => {
      const mockTickets = {
        data: {
          list: [
            {
              id: 1,
              title: "Bug Report",
              description: "Application crashes on login",
              status: "open",
              priority: "high",
              created_at: "2024-01-01T00:00:00Z"
            },
            {
              id: 2,
              title: "Feature Request",
              description: "Add dark mode support",
              status: "in_progress",
              priority: "medium",
              created_at: "2024-01-02T00:00:00Z"
            }
          ],
          total: 2
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockTickets)
      } as any);

      const result = await tickets.list(1, 10, "created_at", false, "bug");

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/tickets?page_num=1&page_size=10&sort_by=created_at&desc=false&name=bug"
      );
      expect(result).toEqual(mockTickets);
    });

    it("should handle empty search parameters", async () => {
      const mockTickets = { data: { list: [], total: 0 } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockTickets)
      } as any);

      await tickets.list(1, 20, "title", true, "");

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/tickets?page_num=1&page_size=20&sort_by=title&desc=true&name="
      );
    });

    it("should handle different sorting options", async () => {
      const sortingOptions = [
        { sortBy: "title", desc: false },
        { sortBy: "status", desc: true },
        { sortBy: "priority", desc: false },
        { sortBy: "created_at", desc: true }
      ];

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue({ data: { list: [], total: 0 } })
      } as any);

      for (const option of sortingOptions) {
        await tickets.list(1, 10, option.sortBy, option.desc, "test");
        
        expect(mockHttp().get).toHaveBeenCalledWith(
          `/api/tickets?page_num=1&page_size=10&sort_by=${option.sortBy}&desc=${option.desc}&name=test`
        );
      }
    });

    it("should handle list errors", async () => {
      const mockError = new Error("Failed to fetch tickets");

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.list(1, 10, "title", false, "test")).rejects.toThrow(
        "Failed to fetch tickets"
      );
    });
  });

  describe("update", () => {
    it("should update an existing ticket", async () => {
      const ticketId = 123;
      const updateData = {
        title: "Updated Bug Report",
        description: "Updated description",
        status: "resolved",
        priority: "low"
      };

      const mockResponse = {
        data: {
          id: ticketId,
          ...updateData,
          updated_at: "2024-01-15T10:30:00Z"
        }
      };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await tickets.update(ticketId, updateData);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `/api/tickets/${ticketId}`,
        updateData
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle partial updates", async () => {
      const ticketId = 456;
      const partialUpdate = {
        status: "closed"
      };

      const mockResponse = {
        data: {
          id: ticketId,
          status: "closed",
          updated_at: "2024-01-15T10:30:00Z"
        }
      };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await tickets.update(ticketId, partialUpdate);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `/api/tickets/${ticketId}`,
        partialUpdate
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle update errors", async () => {
      const ticketId = 999;
      const updateData = { title: "Test" };
      const mockError = new Error("Ticket not found");

      mockHttp.mockReturnValue({
        put: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.update(ticketId, updateData)).rejects.toThrow("Ticket not found");
    });

    it("should handle invalid ticket ID", async () => {
      const invalidTicketId = -1;
      const updateData = { title: "Test" };
      const mockError = {
        response: {
          status: 400,
          data: { message: "Invalid ticket ID" }
        }
      };

      mockHttp.mockReturnValue({
        put: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.update(invalidTicketId, updateData)).rejects.toEqual(mockError);
    });
  });

  describe("create", () => {
    it("should create a new ticket", async () => {
      const ticketData = {
        title: "New Support Request",
        description: "Need help with configuration",
        priority: "medium",
        category: "support",
        reporter_email: "`user@example.com`"
      };

      const mockResponse = {
        data: {
          id: 789,
          ...ticketData,
          status: "open",
          created_at: "2024-01-15T10:30:00Z"
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await tickets.create(ticketData);

      expect(mockHttp().post).toHaveBeenCalledWith("/api/tickets", ticketData);
      expect(result).toEqual(mockResponse);
    });

    it("should handle minimum required fields", async () => {
      const minimalTicketData = {
        title: "Minimal Ticket",
        description: "Basic description"
      };

      const mockResponse = {
        data: {
          id: 100,
          ...minimalTicketData,
          status: "open",
          priority: "normal",
          created_at: "2024-01-15T10:30:00Z"
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await tickets.create(minimalTicketData);

      expect(mockHttp().post).toHaveBeenCalledWith("/api/tickets", minimalTicketData);
      expect(result.data.status).toBe("open");
    });

    it("should handle creation validation errors", async () => {
      const invalidTicketData = {
        title: "", // Empty title
        description: "Test description"
      };

      const mockError = {
        response: {
          status: 400,
          data: {
            message: "Validation failed",
            errors: ["Title is required"]
          }
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.create(invalidTicketData)).rejects.toEqual(mockError);
    });

    it("should handle server errors during creation", async () => {
      const ticketData = {
        title: "Test Ticket",
        description: "Test description"
      };

      const mockError = {
        response: {
          status: 500,
          data: { message: "Internal server error" }
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.create(ticketData)).rejects.toEqual(mockError);
    });
  });

  describe("delete", () => {
    it("should delete a single ticket", async () => {
      const ticketName = "ticket-123";
      const mockResponse = {
        data: {
          message: "Ticket deleted successfully",
          deleted_count: 1
        }
      };

      mockHttp.mockReturnValue({
        delete: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await tickets.delete(ticketName);

      expect(mockHttp().delete).toHaveBeenCalledWith(`/api/tickets/${ticketName}`);
      expect(result).toEqual(mockResponse);
    });

    it("should delete multiple tickets", async () => {
      const ticketNames = "ticket-123,ticket-456,ticket-789";
      const mockResponse = {
        data: {
          message: "Tickets deleted successfully",
          deleted_count: 3
        }
      };

      mockHttp.mockReturnValue({
        delete: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await tickets.delete(ticketNames);

      expect(mockHttp().delete).toHaveBeenCalledWith(`/api/tickets/${ticketNames}`);
      expect(result).toEqual(mockResponse);
    });

    it("should handle deletion of non-existent ticket", async () => {
      const nonExistentTicket = "non-existent-ticket";
      const mockError = {
        response: {
          status: 404,
          data: { message: "Ticket not found" }
        }
      };

      mockHttp.mockReturnValue({
        delete: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.delete(nonExistentTicket)).rejects.toEqual(mockError);
    });

    it("should handle permission errors during deletion", async () => {
      const ticketName = "restricted-ticket";
      const mockError = {
        response: {
          status: 403,
          data: { message: "Insufficient permissions to delete ticket" }
        }
      };

      mockHttp.mockReturnValue({
        delete: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.delete(ticketName)).rejects.toEqual(mockError);
    });

    it("should handle empty ticket names", async () => {
      const emptyName = "";
      const mockError = {
        response: {
          status: 400,
          data: { message: "Ticket name is required" }
        }
      };

      mockHttp.mockReturnValue({
        delete: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(tickets.delete(emptyName)).rejects.toEqual(mockError);
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors across all methods", async () => {
      const networkError = new Error("Network connection failed");
      
      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(networkError),
        post: vi.fn().mockRejectedValue(networkError),
        put: vi.fn().mockRejectedValue(networkError),
        delete: vi.fn().mockRejectedValue(networkError)
      } as any);

      await expect(tickets.list(1, 10, "title", false, "")).rejects.toThrow("Network connection failed");
      await expect(tickets.create({})).rejects.toThrow("Network connection failed");
      await expect(tickets.update(1, {})).rejects.toThrow("Network connection failed");
      await expect(tickets.delete("test")).rejects.toThrow("Network connection failed");
    });

    it("should handle timeout errors", async () => {
      const timeoutError = {
        code: "ECONNABORTED",
        message: "Request timeout"
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(timeoutError),
        post: vi.fn().mockRejectedValue(timeoutError),
        put: vi.fn().mockRejectedValue(timeoutError),
        delete: vi.fn().mockRejectedValue(timeoutError)
      } as any);

      await expect(tickets.list(1, 10, "title", false, "")).rejects.toEqual(timeoutError);
      await expect(tickets.create({})).rejects.toEqual(timeoutError);
      await expect(tickets.update(1, {})).rejects.toEqual(timeoutError);
      await expect(tickets.delete("test")).rejects.toEqual(timeoutError);
    });

    it("should handle authentication errors", async () => {
      const authError = {
        response: {
          status: 401,
          data: { message: "Authentication required" }
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(authError)
      } as any);

      await expect(tickets.list(1, 10, "title", false, "")).rejects.toEqual(authError);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete ticket lifecycle", async () => {
      const ticketData = {
        title: "Integration Test Ticket",
        description: "Testing complete workflow",
        priority: "high"
      };

      const createdTicketId = 999;
      const updateData = {
        status: "in_progress",
        assignee: "developer@example.com"
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue({
          data: {
            list: [{ id: createdTicketId, ...ticketData }],
            total: 1
          }
        }),
        post: vi.fn().mockResolvedValue({
          data: { id: createdTicketId, ...ticketData, status: "open" }
        }),
        put: vi.fn().mockResolvedValue({
          data: { id: createdTicketId, ...ticketData, ...updateData }
        }),
        delete: vi.fn().mockResolvedValue({
          data: { message: "Ticket deleted", deleted_count: 1 }
        })
      } as any);

      // Create ticket
      const createdTicket = await tickets.create(ticketData);
      expect(createdTicket.data.id).toBe(createdTicketId);
      expect(createdTicket.data.status).toBe("open");

      // List tickets to verify creation
      const ticketsList = await tickets.list(1, 10, "created_at", false, "integration");
      expect(ticketsList.data.list).toHaveLength(1);
      expect(ticketsList.data.list[0].title).toBe(ticketData.title);

      // Update ticket
      const updatedTicket = await tickets.update(createdTicketId, updateData);
      expect(updatedTicket.data.status).toBe("in_progress");
      expect(updatedTicket.data.assignee).toBe("developer@example.com");

      // Delete ticket
      const deleteResult = await tickets.delete(`ticket-${createdTicketId}`);
      expect(deleteResult.data.deleted_count).toBe(1);
    });

    it("should handle bulk operations", async () => {
      const multipleTickets = [
        { title: "Ticket 1", description: "Description 1" },
        { title: "Ticket 2", description: "Description 2" },
        { title: "Ticket 3", description: "Description 3" }
      ];

      mockHttp.mockReturnValue({
        post: vi.fn()
          .mockResolvedValueOnce({ data: { id: 1, ...multipleTickets[0] } })
          .mockResolvedValueOnce({ data: { id: 2, ...multipleTickets[1] } })
          .mockResolvedValueOnce({ data: { id: 3, ...multipleTickets[2] } }),
        delete: vi.fn().mockResolvedValue({
          data: { message: "Multiple tickets deleted", deleted_count: 3 }
        }),
        get: vi.fn().mockResolvedValue({
          data: {
            list: multipleTickets.map((ticket, index) => ({ id: index + 1, ...ticket })),
            total: 3
          }
        })
      } as any);

      // Create multiple tickets
      const createdTickets = [];
      for (const ticketData of multipleTickets) {
        const result = await tickets.create(ticketData);
        createdTickets.push(result.data);
      }

      expect(createdTickets).toHaveLength(3);
      expect(createdTickets[0].title).toBe("Ticket 1");
      expect(createdTickets[2].title).toBe("Ticket 3");

      // List all tickets
      const allTickets = await tickets.list(1, 10, "id", false, "");
      expect(allTickets.data.total).toBe(3);

      // Delete multiple tickets
      const ticketNames = "ticket-1,ticket-2,ticket-3";
      const deleteResult = await tickets.delete(ticketNames);
      expect(deleteResult.data.deleted_count).toBe(3);
    });

    it("should handle filtering and pagination", async () => {
      const mockFilteredTickets = {
        data: {
          list: [
            { id: 1, title: "Bug: Login Issue", priority: "high" },
            { id: 2, title: "Bug: UI Problem", priority: "medium" }
          ],
          total: 2
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockFilteredTickets)
      } as any);

      // Test filtering by name
      const filteredResults = await tickets.list(1, 5, "priority", true, "bug");
      
      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/tickets?page_num=1&page_size=5&sort_by=priority&desc=true&name=bug"
      );
      expect(filteredResults.data.list).toHaveLength(2);
      expect(filteredResults.data.list.every((ticket: any) => 
        ticket.title.toLowerCase().includes("bug")
      )).toBe(true);
    });
  });
});