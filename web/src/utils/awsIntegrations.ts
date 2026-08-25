// Copyright 2026 OpenObserve Inc.
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

import { gt, raw, type I18nKey } from "@/types/i18n";

export interface CloudFormationTemplate {
  name: string;
  descriptionKey: I18nKey;
  url: string;
}

export interface ComponentOption {
  name: string;
  descriptionKey: I18nKey;
  component: string; // Component name/path
}

export interface AWSIntegration {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  descriptionKey: I18nKey;
  cloudFormationTemplate: string;
  cloudFormationTemplates?: CloudFormationTemplate[]; // Multiple templates option
  componentOptions?: ComponentOption[]; // Multiple component options
  hasDashboard: boolean;
  dashboardFolderId?: string;
  dashboardGithubUrl?: string; // GitHub URL for dashboard JSON
  documentationUrl?: string;
  category: "logs" | "metrics" | "security" | "networking" | "other";
  comingSoon: boolean;
}

export const awsIntegrations: AWSIntegration[] = [
  {
    id: "cloudtrail",
    name: raw("CloudTrail"),
    displayName: raw("AWS CloudTrail"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.cloudtrail.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudtrail_o2.yaml",
    hasDashboard: true,
    dashboardFolderId: "7417967563709091840",
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS_CloudTrail/CloudTrail.dashboard.json",
    documentationUrl:
      "https://openobserve.ai/blog/what-is-aws-cloudtrail-and-how-to-monitor-cloudtrail-logs/",
    category: "security",
    comingSoon: false,
  },
  {
    id: "waf",
    name: "WAF",
    displayName: raw("AWS WAF"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.waf.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudformation_waf.yaml",
    hasDashboard: true,
    dashboardFolderId: "7417967563709091840",
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS_WAF/aws_waf.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/waf",
    category: "security",
    comingSoon: false,
  },
  {
    id: "alb",
    name: "ALB",
    displayName: raw("Application Load Balancer"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.alb.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/aws_alb.yaml",
    hasDashboard: true,
    dashboardFolderId: "7417967563709091840",
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS_ALB/ALB.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/alb",
    category: "networking",
    comingSoon: false,
  },
  {
    id: "cloudwatch-logs",
    name: raw("CloudWatch Logs"),
    displayName: raw("CloudWatch Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.cloudwatch-logs.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudwatch-logs-to-openobserve.yaml",
    hasDashboard: false,
    documentationUrl: "https://short.openobserve.ai/aws/cloudwatch-logs",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "cloudwatch-metrics",
    name: raw("CloudWatch Metrics"),
    displayName: raw("CloudWatch Metrics"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.cloudwatch-metrics.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/CloudWatch_All_Metrics.yaml",
    hasDashboard: false,
    documentationUrl: "https://openobserve.ai/blog/how-to-monitor-all-aws-metrics-in-one-place/",
    category: "metrics",
    comingSoon: false,
  },
  {
    id: "vpc-flow-logs",
    name: raw("VPC Flow Logs"),
    displayName: raw("VPC Flow Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.vpc-flow-logs.description",
    cloudFormationTemplate: "",
    cloudFormationTemplates: [
      {
        name: raw("CloudWatch Integration"),
        descriptionKey: "ingestion.integrations.aws.vpc-flow-logs.cloudwatchIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/vpc-flowlogs-to-openobserve-cloudwatch.yaml",
      },
      {
        name: raw("Firehose Integration"),
        descriptionKey: "ingestion.integrations.aws.vpc-flow-logs.firehoseIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/vpc-flowlogs-to-openobserve-firehose.yaml",
      },
    ],
    hasDashboard: true,
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS%20VPC%20Flow%20log/AWS%20VPC%20Flow%20Log.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/vpc-flow-logs",
    category: "networking",
    comingSoon: false,
  },
  {
    id: "ec2",
    name: "EC2",
    displayName: raw("EC2 Instance Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.ec2.description",
    cloudFormationTemplate: "",
    cloudFormationTemplates: [
      {
        name: raw("CloudWatch via SSM"),
        descriptionKey: "ingestion.integrations.aws.ec2.cloudwatchViaSsmDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/ec2-cloudwatch-via-ssm.yaml",
      },
      {
        name: raw("OpenTelemetry via SSM"),
        descriptionKey: "ingestion.integrations.aws.ec2.opentelemetryViaSsmDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/ec2-otel-via-ssm.yaml",
      },
    ],
    componentOptions: [
      {
        // Lazy: this array is module scope, so a resolved string would freeze
        // at the boot locale. The getter runs when the option is rendered.
        get name() {
          return gt("ingestion.windowsManualInstall");
        },
        descriptionKey: "ingestion.integrations.aws.ec2.windowsManualInstallDescription",
        component: "WindowsConfig",
      },
      {
        get name() {
          return gt("ingestion.linuxUnixMacosManualInstall");
        },
        descriptionKey: "ingestion.integrations.aws.ec2.linuxUnixMacosManualInstallDescription",
        component: "LinuxConfig",
      },
    ],
    hasDashboard: false,
    documentationUrl: "https://short.openobserve.ai/aws/ec2",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "rds",
    name: "RDS",
    displayName: raw("RDS Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.rds.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/rds-logs-to-openobserve.yaml",
    hasDashboard: true,
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS_RDS_Logs/rds.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/rds",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "s3",
    name: raw("S3"),
    displayName: raw("S3 Access Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.s3.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/s3-access-logs-to-openobserve.yaml",
    hasDashboard: false,
    documentationUrl: "https://openobserve.ai/docs/ingestion/logs/s3/",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "lambda",
    name: raw("Lambda"),
    displayName: raw("Lambda Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.lambda.description",
    cloudFormationTemplate: "",
    hasDashboard: false,
    documentationUrl: "https://openobserve.ai/docs/ingestion/logs/lambda/",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "api-gateway",
    name: raw("API Gateway"),
    displayName: raw("API Gateway Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.api-gateway.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/apigateway-logs-to-openobserve.yaml",
    hasDashboard: true,
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS%20Gateway%20API%20access%20logs/Rest%20API%20Access%20logs.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/api-gateway",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "cognito",
    name: raw("Cognito"),
    displayName: raw("Cognito"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.cognito.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cognito-events-to-openobserve.yaml",
    hasDashboard: false,
    documentationUrl: "https://short.openobserve.ai/aws/cognito",
    category: "security",
    comingSoon: false,
  },
  {
    id: "dynamodb",
    name: raw("DynamoDB"),
    displayName: raw("DynamoDB Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.dynamodb.description",
    cloudFormationTemplate: "",
    cloudFormationTemplates: [
      {
        name: raw("Lambda Integration"),
        descriptionKey: "ingestion.integrations.aws.dynamodb.lambdaIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/dynamodb-streams-to-openobserve-lambda.yaml",
      },
      {
        get name() {
          return gt("ingestion.directIntegration");
        },
        descriptionKey: "ingestion.integrations.aws.dynamodb.directIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/dynamodb-streams-to-openobserve.yaml",
      },
    ],
    hasDashboard: false,
    documentationUrl: "https://short.openobserve.ai/aws/dynamodb",
    category: "logs",
    comingSoon: false,
  },
  {
    id: "cloudfront",
    name: raw("CloudFront"),
    displayName: raw("CloudFront Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.cloudfront.description",
    cloudFormationTemplate: "", // Keep empty when using cloudFormationTemplates
    cloudFormationTemplates: [
      {
        get name() {
          return gt("ingestion.directIntegration");
        },
        descriptionKey: "ingestion.integrations.aws.cloudfront.directIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudfront-to-openobserve.yaml",
      },
      {
        name: raw("S3 Integration"),
        descriptionKey: "ingestion.integrations.aws.cloudfront.s3IntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudfront-to-openobserve-s3.yaml",
      },
    ],
    hasDashboard: true,
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS%20Cloudfront%20Access%20Logs/Cloudfront_to_OpenObserve.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/cloudfront",
    category: "networking",
    comingSoon: false,
  },
  {
    id: "route53",
    name: raw("Route53"),
    displayName: raw("Route53 Query Logs"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.route53.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/route53-logs-to-openobserve.yaml",
    hasDashboard: true,
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS_Route53/Route53.dashboard.json",
    documentationUrl: "https://short.openobserve.ai/aws/route53",
    category: "networking",
    comingSoon: false,
  },
  {
    id: "eventbridge",
    name: raw("EventBridge"),
    displayName: raw("EventBridge Events"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.eventbridge.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/eventbridge-to-openobserve.yaml",
    hasDashboard: false,
    documentationUrl: "https://short.openobserve.ai/aws/eventbridge",
    category: "other",
    comingSoon: false,
  },
  {
    id: "cost-cur",
    name: raw("Cost and Usage Reports"),
    displayName: raw("AWS Cost & Usage Reports"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.cost-cur.description",
    cloudFormationTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cost-cur-to-openobserve.yaml",
    hasDashboard: true,
    dashboardGithubUrl:
      "https://raw.githubusercontent.com/openobserve/dashboards/main/AWS_Cost_CUR/COST.dashboard.json",
    documentationUrl: "https://docs.aws.amazon.com/cur/latest/userguide/what-is-cur.html",
    category: "other",
    comingSoon: false,
  },
  {
    id: "kinesis",
    name: raw("Kinesis"),
    displayName: raw("Kinesis Streams"),
    icon: "",
    descriptionKey: "ingestion.integrations.aws.kinesis.description",
    cloudFormationTemplate: "",
    cloudFormationTemplates: [
      {
        name: raw("Lambda Integration"),
        descriptionKey: "ingestion.integrations.aws.kinesis.lambdaIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/kinesis-to-openobserve-lambda.yaml",
      },
      {
        name: raw("Firehose Integration"),
        descriptionKey: "ingestion.integrations.aws.kinesis.firehoseIntegrationDescription",
        url: "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/kinesis-to-openobserve-firehose.yaml",
      },
    ],
    hasDashboard: false,
    documentationUrl: "https://docs.aws.amazon.com/streams/latest/dev/using-other-services.html",
    category: "other",
    comingSoon: false,
  },
];

export const AWS_REGIONS = [
  { value: "us-east-1", label: raw("US East (N. Virginia)") },
  { value: "us-east-2", label: raw("US East (Ohio)") },
  { value: "us-west-1", label: raw("US West (N. California)") },
  { value: "us-west-2", label: raw("US West (Oregon)") },
  { value: "ca-central-1", label: raw("Canada (Central)") },
  { value: "ca-west-1", label: raw("Canada West (Calgary)") },
  { value: "eu-west-1", label: raw("Europe (Ireland)") },
  { value: "eu-west-2", label: raw("Europe (London)") },
  { value: "eu-west-3", label: raw("Europe (Paris)") },
  { value: "eu-central-1", label: raw("Europe (Frankfurt)") },
  { value: "eu-central-2", label: raw("Europe (Zurich)") },
  { value: "eu-north-1", label: raw("Europe (Stockholm)") },
  { value: "eu-south-1", label: raw("Europe (Milan)") },
  { value: "eu-south-2", label: raw("Europe (Spain)") },
  { value: "ap-east-1", label: raw("Asia Pacific (Hong Kong)") },
  { value: "ap-south-1", label: raw("Asia Pacific (Mumbai)") },
  { value: "ap-south-2", label: raw("Asia Pacific (Hyderabad)") },
  { value: "ap-southeast-1", label: raw("Asia Pacific (Singapore)") },
  { value: "ap-southeast-2", label: raw("Asia Pacific (Sydney)") },
  { value: "ap-southeast-3", label: raw("Asia Pacific (Jakarta)") },
  { value: "ap-southeast-4", label: raw("Asia Pacific (Melbourne)") },
  { value: "ap-northeast-1", label: raw("Asia Pacific (Tokyo)") },
  { value: "ap-northeast-2", label: raw("Asia Pacific (Seoul)") },
  { value: "ap-northeast-3", label: raw("Asia Pacific (Osaka)") },
  { value: "sa-east-1", label: raw("South America (São Paulo)") },
  { value: "me-south-1", label: raw("Middle East (Bahrain)") },
  { value: "me-central-1", label: raw("Middle East (UAE)") },
  { value: "il-central-1", label: raw("Israel (Tel Aviv)") },
  { value: "af-south-1", label: raw("Africa (Cape Town)") },
  { value: "us-gov-east-1", label: raw("AWS GovCloud (US-East)") },
  { value: "us-gov-west-1", label: raw("AWS GovCloud (US-West)") },
];

export const QUICK_SETUP_SERVICES: { label: string; flag: string }[] = [
  { label: raw("CloudTrail"), flag: "EnableCloudTrail" },
  { label: raw("CloudWatch Logs"), flag: "EnableCloudWatchLogs" },
  { label: raw("CloudWatch Metrics"), flag: "EnableCloudWatchMetrics" },
  { label: raw("VPC Flow Logs"), flag: "EnableVPCFlowLogs" },
  { label: "WAF", flag: "EnableWAF" },
  { label: "ALB", flag: "EnableALB" },
  { label: raw("API Gateway"), flag: "EnableApiGateway" },
  { label: "RDS", flag: "EnableRDS" },
  { label: raw("S3 Access Logs"), flag: "EnableS3AccessLogs" },
  { label: raw("CloudFront"), flag: "EnableCloudFront" },
  { label: raw("Route53"), flag: "EnableRoute53" },
  { label: raw("DynamoDB"), flag: "EnableDynamoDB" },
  { label: "EC2", flag: "EnableEC2" },
  { label: raw("EventBridge"), flag: "EnableEventBridge" },
  { label: raw("Kinesis"), flag: "EnableKinesisStream" },
  { label: raw("Cognito"), flag: "EnableCognito" },
];

/**
 * Generate AWS CloudFormation console URL with pre-filled parameters
 */
export const generateCloudFormationURL = (
  integration: AWSIntegration,
  organizationId: string,
  endpoint: string,
  accessKey: string,
  region: string = "us-east-1",
  extraParams: Record<string, string> = {},
): string => {
  if (!integration.cloudFormationTemplate || integration.comingSoon) {
    return "";
  }

  const stackName = `o2-${integration.name.replace(/\s+/g, "-")}`;

  // Encode parameters for URL
  // Pass both new (OpenObserveEndpoint/OpenObserveAccessKey) and legacy (HttpEndpointUrl/AccessKey)
  // param names so all CloudFormation templates get auto-filled regardless of naming convention
  const params = new URLSearchParams({
    stackName,
    templateURL: integration.cloudFormationTemplate,
    param_OpenObserveEndpoint: endpoint,
    param_OpenObserveAccessKey: accessKey,
    param_OrganizationId: organizationId,
    param_HttpEndpointUrl: endpoint,
    param_AccessKey: accessKey,
    ...Object.fromEntries(Object.entries(extraParams).map(([k, v]) => [`param_${k}`, v])),
  });

  return `https://console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`;
};

/**
 * Generate dashboard URL for the current environment
 */
export const generateDashboardURL = (
  integration: AWSIntegration,
  organizationId: string,
  baseURL: string,
): string => {
  if (!integration.hasDashboard || integration.comingSoon) {
    return "";
  }

  // For now, just go to dashboards page
  // In the future, can link to specific dashboard when dashboardFolderId is used
  return `${baseURL}/web/dashboards?org_identifier=${organizationId}`;
};
