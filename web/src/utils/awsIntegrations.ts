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

export interface AWSIntegration {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  description: string;
  cloudFormationTemplate: string;
  hasDashboard: boolean;
  dashboardFolderId?: string;
  documentationUrl?: string;
  category: 'logs' | 'metrics' | 'security' | 'networking' | 'other';
  comingSoon: boolean;
}

export const awsIntegrations: AWSIntegration[] = [
  {
    id: 'cloudtrail',
    name: 'CloudTrail',
    displayName: 'AWS CloudTrail',
    icon: '',
    description: 'Monitor AWS account activity and API usage across your infrastructure',
    cloudFormationTemplate: 'https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudtrail_o2.yaml',
    hasDashboard: true,
    dashboardFolderId: '7417967563709091840',
    documentationUrl: 'https://openobserve.ai/blog/what-is-aws-cloudtrail-and-how-to-monitor-cloudtrail-logs/',
    category: 'security',
    comingSoon: false,
  },
  {
    id: 'waf',
    name: 'WAF',
    displayName: 'AWS WAF',
    icon: '',
    description: 'Protect web applications from common web exploits and bots',
    cloudFormationTemplate: 'https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/cloudformation_waf.yaml',
    hasDashboard: true,
    dashboardFolderId: '7417967563709091840',
    documentationUrl: 'https://short.openobserve.ai/aws/waf',
    category: 'security',
    comingSoon: false,
  },
  {
    id: 'alb',
    name: 'ALB',
    displayName: 'Application Load Balancer',
    icon: '',
    description: 'Monitor ALB access logs for request patterns, errors, and latency',
    cloudFormationTemplate: 'https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/aws_alb.yaml',
    hasDashboard: true,
    dashboardFolderId: '7417967563709091840',
    documentationUrl: 'https://short.openobserve.ai/aws/alb',
    category: 'networking',
    comingSoon: false,
  },
  {
    id: 'cloudwatch-logs',
    name: 'CloudWatch Logs',
    displayName: 'CloudWatch Logs',
    icon: '',
    description: 'Stream CloudWatch logs to OpenObserve for analysis',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/cloudwatch-logs',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 'cloudwatch-metrics',
    name: 'CloudWatch Metrics',
    displayName: 'CloudWatch Metrics',
    icon: '',
    description: 'Collect and analyze CloudWatch metrics',
    cloudFormationTemplate: 'https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/CloudWatch_All_Metrics.yaml',
    hasDashboard: false,
    documentationUrl: 'https://openobserve.ai/blog/how-to-monitor-all-aws-metrics-in-one-place/',
    category: 'metrics',
    comingSoon: false,
  },
  {
    id: 'vpc-flow-logs',
    name: 'VPC Flow Logs',
    displayName: 'VPC Flow Logs',
    icon: '',
    description: 'Analyze network traffic in your VPC',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/vpc-flow-logs',
    category: 'networking',
    comingSoon: false,
  },
  {
    id: 'ec2',
    name: 'EC2',
    displayName: 'EC2 Instance Logs',
    icon: '',
    description: 'Collect logs from EC2 instances',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/ec2',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 'rds',
    name: 'RDS',
    displayName: 'RDS Logs',
    icon: '',
    description: 'Monitor RDS database logs',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/rds',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 's3',
    name: 'S3',
    displayName: 'S3 Access Logs',
    icon: '',
    description: 'Track S3 bucket access and operations',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://openobserve.ai/docs/ingestion/logs/s3/',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 'lambda',
    name: 'Lambda',
    displayName: 'Lambda Logs',
    icon: '',
    description: 'Monitor AWS Lambda function logs',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://openobserve.ai/docs/ingestion/logs/lambda/',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 'api-gateway',
    name: 'API Gateway',
    displayName: 'API Gateway Logs',
    icon: '',
    description: 'Analyze API Gateway access logs',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/api-gateway',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 'cognito',
    name: 'Cognito',
    displayName: 'Cognito',
    icon: '',
    description: 'Monitor Cognito authentication events',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/cognito',
    category: 'security',
    comingSoon: false,
  },
  {
    id: 'dynamodb',
    name: 'DynamoDB',
    displayName: 'DynamoDB Logs',
    icon: '',
    description: 'Track DynamoDB operations',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/dynamodb',
    category: 'logs',
    comingSoon: false,
  },
  {
    id: 'cloudfront',
    name: 'CloudFront',
    displayName: 'CloudFront Logs',
    icon: '',
    description: 'Analyze CloudFront access logs',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/cloudfront',
    category: 'networking',
    comingSoon: false,
  },
  {
    id: 'route53',
    name: 'Route53',
    displayName: 'Route53 Query Logs',
    icon: '',
    description: 'Monitor DNS query logs',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/route53',
    category: 'networking',
    comingSoon: false,
  },
  {
    id: 'eventbridge',
    name: 'EventBridge',
    displayName: 'EventBridge Events',
    icon: '',
    description: 'Capture EventBridge/CloudWatch events',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://short.openobserve.ai/aws/eventbridge',
    category: 'other',
    comingSoon: false,
  },
  {
    id: 'kinesis',
    name: 'Kinesis',
    displayName: 'Kinesis Streams',
    icon: '',
    description: 'Integrate with Kinesis data streams',
    cloudFormationTemplate: '',
    hasDashboard: false,
    documentationUrl: 'https://docs.aws.amazon.com/streams/latest/dev/using-other-services.html',
    category: 'other',
    comingSoon: false,
  },
];

/**
 * Generate AWS CloudFormation console URL with pre-filled parameters
 */
export const generateCloudFormationURL = (
  integration: AWSIntegration,
  organizationId: string,
  endpoint: string,
  accessKey: string,
): string => {
  if (!integration.cloudFormationTemplate || integration.comingSoon) {
    return '';
  }

  const region = 'us-east-1'; // Default region, can be made configurable
  const stackName = `OpenObserve-${integration.name}`;

  // Encode parameters for URL
  const params = new URLSearchParams({
    stackName,
    templateURL: integration.cloudFormationTemplate,
    param_OpenObserveEndpoint: endpoint,
    param_OpenObserveAccessKey: accessKey,
    param_OrganizationId: organizationId,
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
    return '';
  }

  // For now, just go to dashboards page
  // In the future, can link to specific dashboard when dashboardFolderId is used
  return `${baseURL}/web/dashboards?org_identifier=${organizationId}`;
};
