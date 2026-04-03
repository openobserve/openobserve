// Copyright 2023 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export type ReportMediaType = "pdf" | "png";
export type ReportEmailAttachmentType = "standard" | "inline";

export interface ReportAttachmentDimensions {
  width: number;
  height: number;
}

export interface ScheduledDashboardReport {
  "#": number;
  name: string;
  tab?: string | null;
  time_range?: string | null;
  frequency: string;
  last_triggered_at: string;
  created_at: string;
  orgId: string | number;
  isCached: boolean;
  /** When true and report_type is PDF, a PNG screenshot is embedded inline in the email. */
  image_preview: boolean;
}

export interface ReportDashboardConfig {
  /** Type of the generated report attachment. */
  report_type: ReportMediaType;
  /** Whether the attachment is sent as a downloadable file or embedded inline in the email. */
  email_attachment_type: ReportEmailAttachmentType;
  /** Optional browser viewport override. When absent the report server uses its defaults. */
  attachment_dimensions?: ReportAttachmentDimensions;
}
