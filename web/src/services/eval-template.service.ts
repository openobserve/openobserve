/**
 * Service for managing evaluation prompt templates
 * Provides CRUD operations and statistics retrieval
 */

import http from "@/services/http";

export interface CreateTemplateRequest {
  org_id: string;
  response_type: string;
  name: string;
  description?: string;
  content: string;
  dimensions: string[];
}

export interface TemplateResponse {
  id: string;
  org_id: string;
  response_type: string;
  name: string;
  description?: string;
  content: string;
  dimensions: string[];
  version: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface TemplateStats {
  template_id: string;
  org_id: string;
  response_type: string;
  name: string;
  version: number;
  total_evaluations: number;
  avg_quality_score: number;
  last_used: number;
}

class EvalTemplateService {
  private getBaseURL(orgId: string): string {
    return `/api/${orgId}/eval-templates`;
  }

  /**
   * List all templates for an organization
   */
  async listTemplates(orgId: string): Promise<TemplateResponse[]> {
    try {
      const url = this.getBaseURL(orgId);
      const response = await http().get(url);
      return response.data || [];
    } catch (error) {
      console.error("Failed to list templates:", error);
      throw error;
    }
  }

  /**
   * Get a specific template by UUID
   */
  async getTemplate(
    orgId: string,
    templateId: string,
  ): Promise<TemplateResponse> {
    try {
      const url = `${this.getBaseURL(orgId)}/${templateId}`;
      const response = await http().get(url);
      return response.data;
    } catch (error) {
      console.error("Failed to get template:", error);
      throw error;
    }
  }

  /**
   * Create a new evaluation template
   */
  async createTemplate(
    orgId: string,
    request: CreateTemplateRequest,
  ): Promise<TemplateResponse> {
    try {
      const url = this.getBaseURL(orgId);
      const response = await http().post(url, request);
      return response.data;
    } catch (error) {
      console.error("Failed to create template:", error);
      throw error;
    }
  }

  /**
   * Update an existing template by UUID
   */
  async updateTemplate(
    orgId: string,
    templateId: string,
    request: CreateTemplateRequest,
  ): Promise<TemplateResponse> {
    try {
      const url = `${this.getBaseURL(orgId)}/${templateId}`;
      const response = await http().put(url, request);
      return response.data;
    } catch (error) {
      console.error("Failed to update template:", error);
      throw error;
    }
  }

  /**
   * Delete a template by UUID
   */
  async deleteTemplate(orgId: string, templateId: string): Promise<void> {
    try {
      const url = `${this.getBaseURL(orgId)}/${templateId}`;
      await http().delete(url);
    } catch (error) {
      console.error("Failed to delete template:", error);
      throw error;
    }
  }

  /**
   * Get usage statistics for a template by UUID
   */
  async getTemplateStats(
    orgId: string,
    templateId: string,
  ): Promise<TemplateStats> {
    try {
      const url = `${this.getBaseURL(orgId)}/${templateId}/stats`;
      const response = await http().get(url);
      return response.data;
    } catch (error) {
      console.error("Failed to get template stats:", error);
      throw error;
    }
  }

  /**
   * Get all templates for comparison
   */
  async getTemplatesForComparison(
    orgId: string,
    responseType: string,
  ): Promise<TemplateResponse[]> {
    try {
      const url = this.getBaseURL(orgId);
      const response = await http().get(url);
      return (response.data || []).filter((t: TemplateResponse) => t.response_type === responseType);
    } catch (error) {
      console.error("Failed to get templates for comparison:", error);
      throw error;
    }
  }
}

export const evalTemplateService = new EvalTemplateService();
