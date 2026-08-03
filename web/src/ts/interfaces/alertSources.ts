export interface AlertSourceIntegration {
  id: string;
  org_id: string;
  name: string;
  source_type: string;
  token: string;
  enabled: boolean;
  config: Record<string, any>;
  created_by: string;
  created_at: number;
  updated_at: number;
  url: string;
}

export interface AlertSourceSender {
  integration_id: string;
  detected_source: string;
  display_name: string;
  first_received_at: number;
  last_received_at: number;
  accepted_count: number;
  rejected_count: number;
  resolved_seen: boolean;
  resolve_wiring_hint: boolean;
}

export interface ListIntegrationsResponse {
  integrations: AlertSourceIntegration[];
}

export interface ListSendersResponse {
  senders: AlertSourceSender[];
}

export interface CreateAlertSourcePayload {
  name: string;
  source_type?: string;
  config?: Record<string, any>;
}
