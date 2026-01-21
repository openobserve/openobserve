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

import { describe, it, expect } from 'vitest';
import { slackTemplate, slackConfig, slackDestinationType } from '@/utils/prebuilt-templates/slack';
import { discordTemplate, discordConfig, discordDestinationType } from '@/utils/prebuilt-templates/discord';
import { emailTemplate, emailConfig, emailDestinationType } from '@/utils/prebuilt-templates/email';
import { msteamsTemplate, msteamsConfig, msteamsDestinationType } from '@/utils/prebuilt-templates/msteams';
import { pagerdutyTemplate, pagerdutyConfig, pagerdutyDestinationType } from '@/utils/prebuilt-templates/pagerduty';
import { servicenowTemplate, servicenowConfig, servicenowDestinationType } from '@/utils/prebuilt-templates/servicenow';
import { opsgenieTemplate, opsgenieConfig, opsgenieDestinationType } from '@/utils/prebuilt-templates/opsgenie';

describe('Slack template', () => {
  it('has correct structure', () => {
    expect(slackTemplate.name).toBe('system-prebuilt-slack');
    expect(slackTemplate.type).toBe('http');
    expect(slackTemplate.isDefault).toBe(false);
    expect(() => JSON.parse(slackTemplate.body)).not.toThrow();
  });

  it('config has required properties', () => {
    expect(slackConfig.templateName).toBe('system-prebuilt-slack');
    expect(slackConfig.method).toBe('post');
    expect(typeof slackConfig.urlValidator).toBe('function');
    expect(slackConfig.credentialFields.length).toBeGreaterThan(0);
  });

  it('validates Slack webhook URLs', () => {
    expect(slackConfig.urlValidator('https://hooks.slack.com/services/xxx')).toBe(true);
    expect(slackConfig.urlValidator('https://example.com')).toBe(false);
  });

  it('destination type has correct category', () => {
    expect(slackDestinationType.id).toBe('slack');
    expect(slackDestinationType.category).toBe('messaging');
    expect(slackDestinationType.name).toBeTruthy();
  });
});

describe('Email template', () => {
  it('has correct structure', () => {
    expect(emailTemplate.name).toBe('system-prebuilt-email');
    expect(emailTemplate.type).toBe('email');
    expect(emailTemplate.isDefault).toBe(false);
  });

  it('config has required properties', () => {
    expect(emailConfig.templateName).toBe('system-prebuilt-email');
    expect(emailConfig.credentialFields.length).toBeGreaterThan(0);
  });

  it('has email credential field', () => {
    const emailField = emailConfig.credentialFields.find(f => f.key === 'recipients');
    expect(emailField).toBeDefined();
    expect(emailField?.required).toBe(true);
  });

  it('destination type has correct category', () => {
    expect(emailDestinationType.id).toBe('email');
    expect(emailDestinationType.category).toBe('email');
  });
});

describe('Microsoft Teams template', () => {
  it('has correct structure', () => {
    expect(msteamsTemplate.name).toBe('system-prebuilt-msteams');
    expect(msteamsTemplate.type).toBe('http');
    expect(() => JSON.parse(msteamsTemplate.body)).not.toThrow();
  });

  it('config validates MS Teams webhook URLs', () => {
    expect(msteamsConfig.urlValidator('https://outlook.office.com/webhook/')).toBe(true);
    expect(msteamsConfig.urlValidator('https://example.com')).toBe(false);
  });

  it('destination type has correct category', () => {
    expect(msteamsDestinationType.id).toBe('msteams');
    expect(msteamsDestinationType.category).toBe('messaging');
  });
});

describe('PagerDuty template', () => {
  it('has correct structure', () => {
    expect(pagerdutyTemplate.name).toBe('system-prebuilt-pagerduty');
    expect(pagerdutyTemplate.type).toBe('http');
    expect(() => JSON.parse(pagerdutyTemplate.body)).not.toThrow();
  });

  it('config has required properties', () => {
    expect(pagerdutyConfig.method).toBe('post');
    expect(pagerdutyConfig.headers['Content-Type']).toBe('application/json');
  });

  it('validates PagerDuty URLs', () => {
    expect(pagerdutyConfig.urlValidator('https://events.pagerduty.com/v2/enqueue')).toBe(true);
    expect(pagerdutyConfig.urlValidator('https://example.com')).toBe(false);
  });

  it('has routing key credential field', () => {
    const routingKeyField = pagerdutyConfig.credentialFields.find(f => f.key === 'integrationKey');
    expect(routingKeyField).toBeDefined();
    expect(routingKeyField?.required).toBe(true);
  });

  it('destination type has correct category', () => {
    expect(pagerdutyDestinationType.id).toBe('pagerduty');
    expect(pagerdutyDestinationType.category).toBe('incident');
  });
});

describe('ServiceNow template', () => {
  it('has correct structure', () => {
    expect(servicenowTemplate.name).toBe('system-prebuilt-servicenow');
    expect(servicenowTemplate.type).toBe('http');
    expect(() => JSON.parse(servicenowTemplate.body)).not.toThrow();
  });

  it('config has authentication fields', () => {
    const usernameField = servicenowConfig.credentialFields.find(f => f.key === 'username');
    const passwordField = servicenowConfig.credentialFields.find(f => f.key === 'password');
    expect(usernameField).toBeDefined();
    expect(passwordField).toBeDefined();
    expect(passwordField?.type).toBe('password');
  });

  it('validates ServiceNow URLs', () => {
    expect(servicenowConfig.urlValidator('https://dev.service-now.com/api/now/table/incident')).toBe(true);
    expect(servicenowConfig.urlValidator('https://example.com')).toBe(false);
  });

  it('destination type has correct category', () => {
    expect(servicenowDestinationType.id).toBe('servicenow');
    expect(servicenowDestinationType.category).toBe('incident');
  });
});

describe('Opsgenie template', () => {
  it('has correct structure', () => {
    expect(opsgenieTemplate.name).toBe('system-prebuilt-opsgenie');
    expect(opsgenieTemplate.type).toBe('http');
    expect(() => JSON.parse(opsgenieTemplate.body)).not.toThrow();
  });

  it('config has API key field', () => {
    const apiKeyField = opsgenieConfig.credentialFields.find(f => f.key === 'apiKey');
    expect(apiKeyField).toBeDefined();
    expect(apiKeyField?.required).toBe(true);
    expect(apiKeyField?.type).toBe('password');
  });

  it('validates Opsgenie URLs', () => {
    expect(opsgenieConfig.urlValidator('https://api.opsgenie.com/v2/alerts')).toBe(true);
    expect(opsgenieConfig.urlValidator('https://example.com')).toBe(false);
  });

  it('destination type has correct category', () => {
    expect(opsgenieDestinationType.id).toBe('opsgenie');
    expect(opsgenieDestinationType.category).toBe('incident');
  });
});

describe('Template consistency', () => {
  const templates = [
    { name: 'slack', template: slackTemplate, config: slackConfig, type: slackDestinationType },
    { name: 'discord', template: discordTemplate, config: discordConfig, type: discordDestinationType },
    { name: 'email', template: emailTemplate, config: emailConfig, type: emailDestinationType },
    { name: 'msteams', template: msteamsTemplate, config: msteamsConfig, type: msteamsDestinationType },
    { name: 'pagerduty', template: pagerdutyTemplate, config: pagerdutyConfig, type: pagerdutyDestinationType },
    { name: 'servicenow', template: servicenowTemplate, config: servicenowConfig, type: servicenowDestinationType },
    { name: 'opsgenie', template: opsgenieTemplate, config: opsgenieConfig, type: opsgenieDestinationType }
  ];

  it('all templates follow naming convention', () => {
    templates.forEach(({ name, config }) => {
      expect(config.templateName).toBe(`system-prebuilt-${name}`);
    });
  });

  it('all configs have urlValidator or headers', () => {
    templates.forEach(({ name, config }) => {
      const hasValidator = typeof config.urlValidator === 'function';
      const hasHeaders = config.headers !== undefined;
      expect(hasValidator || hasHeaders).toBe(true);
    });
  });

  it('all configs have credential fields', () => {
    templates.forEach(({ name, config }) => {
      expect(config.credentialFields).toBeDefined();
      expect(Array.isArray(config.credentialFields)).toBe(true);
    });
  });

  it('all credential fields have required properties', () => {
    templates.forEach(({ name, config }) => {
      config.credentialFields?.forEach((field: any) => {
        expect(field).toHaveProperty('key');
        expect(field).toHaveProperty('label');
        expect(field).toHaveProperty('type');
        expect(field).toHaveProperty('required');
      });
    });
  });
});
