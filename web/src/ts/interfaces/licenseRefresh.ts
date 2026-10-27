export interface RefreshLicense {
  license_id: string;
  expires_at: number;
}

export interface RefreshReport {
  outcome?: string | null;
  error?: string | null;
  detail?: string;
  old_rev?: number | null;
  new_rev?: number | null;
  waivers_added?: number;
  waivers_removed?: number;
  renewed?: RefreshLicense | null;
  successor_available?: RefreshLicense | null;
  retry_after_s?: number | null;
  rotate_requested?: boolean;
}

export type RefreshBody =
  | (RefreshReport & {
      limits_refreshed?: boolean;
      /** Unix microseconds this click recorded as `refresh.last_attempt_at`. */
      attempt_at?: number;
      /** False when this click recorded no attempt. */
      attempt_recorded?: boolean;
      code?: number;
      reason?: string;
      message?: string;
    })
  | "";

export interface RefreshStatus {
  mode: string;
  server_host: string;
  registration: string;
  key_id: string | null;
  key_created: boolean;
  key_at_rest: string;
  rotate_recommended: boolean;
  rotation_unsettled: boolean;
  last_attempt_at: number | null;
  last_attempt_by: string | null;
  last_success_at: number | null;
  last_status: string | null;
  last_error: string | null;
  last_error_detail: string;
  last_outcome: RefreshReport | null;
  successor_available: RefreshLicense | null;
  stored_key: string | null;
}

export interface RefreshResult {
  ok: boolean;
  body?: RefreshBody;
  status?: number;
}
