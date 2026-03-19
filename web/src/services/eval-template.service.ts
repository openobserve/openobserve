/**
 * Service for managing evaluation prompt templates
 * Provides CRUD operations and statistics retrieval
 */

import http from "@/services/http";

export interface CreateTemplateRequest {
  org_id: string;
  agent_type: string;
  name: string;
  description?: string;
  content: string;
  dimensions: string[];
  fail_patterns?: string[];
  pass_patterns?: string[];
}

export interface TemplateResponse {
  id: string;
  org_id: string;
  agent_type: string;
  name: string;
  description?: string;
  content: string;
  dimensions: string[];
  fail_patterns?: string[];
  pass_patterns?: string[];
  version: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface TemplateStats {
  template_id: string;
  org_id: string;
  agent_type: string;
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
   * Get a specific template by agent_type
   */
  async getTemplate(
    orgId: string,
    agentType: string,
  ): Promise<TemplateResponse> {
    try {
      const url = `${this.getBaseURL(orgId)}/${agentType}`;
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
   * Update an existing template
   */
  async updateTemplate(
    orgId: string,
    agentType: string,
    request: CreateTemplateRequest,
  ): Promise<TemplateResponse> {
    try {
      const url = `${this.getBaseURL(orgId)}/${agentType}`;
      const response = await http().put(url, request);
      return response.data;
    } catch (error) {
      console.error("Failed to update template:", error);
      throw error;
    }
  }

  /**
   * Delete a template
   */
  async deleteTemplate(orgId: string, agentType: string): Promise<void> {
    try {
      const url = `${this.getBaseURL(orgId)}/${agentType}`;
      await http().delete(url);
    } catch (error) {
      console.error("Failed to delete template:", error);
      throw error;
    }
  }

  /**
   * Get usage statistics for a template
   */
  async getTemplateStats(
    orgId: string,
    agentType: string,
  ): Promise<TemplateStats> {
    try {
      const url = `${this.getBaseURL(orgId)}/${agentType}/stats`;
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
    agentType: string,
  ): Promise<TemplateResponse[]> {
    try {
      const url = this.getBaseURL(orgId);
      const response = await http().get(url);
      return (response.data || []).filter((t) => t.agent_type === agentType);
    } catch (error) {
      console.error("Failed to get templates for comparison:", error);
      throw error;
    }
  }
}

export const evalTemplateService = new EvalTemplateService();
