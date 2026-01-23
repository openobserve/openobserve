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
import { discordTemplate, discordConfig, discordDestinationType } from '@/utils/prebuilt-templates/discord';

describe('discord template', () => {
  describe('discordTemplate', () => {
    it('has correct name', () => {
      expect(discordTemplate.name).toBe('system-prebuilt-discord');
    });

    it('has type as http', () => {
      expect(discordTemplate.type).toBe('http');
    });

    it('is not default', () => {
      expect(discordTemplate.isDefault).toBe(false);
    });

    it('has valid JSON body', () => {
      expect(() => JSON.parse(discordTemplate.body)).not.toThrow();
    });

    it('body contains required Discord webhook fields', () => {
      const body = JSON.parse(discordTemplate.body);
      expect(body).toHaveProperty('username');
      expect(body).toHaveProperty('avatar_url');
      expect(body).toHaveProperty('content');
      expect(body).toHaveProperty('embeds');
    });

    it('embeds array contains at least one embed', () => {
      const body = JSON.parse(discordTemplate.body);
      expect(body.embeds).toBeInstanceOf(Array);
      expect(body.embeds.length).toBeGreaterThan(0);
    });

    it('embed contains required fields', () => {
      const body = JSON.parse(discordTemplate.body);
      const embed = body.embeds[0];
      expect(embed).toHaveProperty('title');
      expect(embed).toHaveProperty('description');
      expect(embed).toHaveProperty('color');
      expect(embed).toHaveProperty('fields');
      expect(embed).toHaveProperty('footer');
      expect(embed).toHaveProperty('timestamp');
    });

    it('embed fields contain alert information placeholders', () => {
      const body = JSON.parse(discordTemplate.body);
      const embed = body.embeds[0];
      expect(embed.fields).toBeInstanceOf(Array);
      expect(embed.fields.length).toBeGreaterThan(0);
    });
  });

  describe('discordConfig', () => {
    it('references correct template name', () => {
      expect(discordConfig.templateName).toBe('system-prebuilt-discord');
    });

    it('has correct headers', () => {
      expect(discordConfig.headers).toHaveProperty('Content-Type');
      expect(discordConfig.headers['Content-Type']).toBe('application/json');
    });

    it('uses POST method', () => {
      expect(discordConfig.method).toBe('post');
    });

    it('has URL validator function', () => {
      expect(typeof discordConfig.urlValidator).toBe('function');
    });

    it('URL validator accepts valid Discord webhook URLs', () => {
      expect(discordConfig.urlValidator('https://discord.com/api/webhooks/123456789/abcdef')).toBe(true);
      expect(discordConfig.urlValidator('https://discord.com/api/webhooks/123/abc')).toBe(true);
    });

    it('URL validator rejects invalid URLs', () => {
      expect(discordConfig.urlValidator('https://example.com/webhook')).toBe(false);
      expect(discordConfig.urlValidator('https://discord.com/api/other')).toBe(false);
      expect(discordConfig.urlValidator('https://evil.com?discord.com=fake')).toBe(false);
      expect(discordConfig.urlValidator('invalid-url')).toBe(false);
    });

    it('has credential fields', () => {
      expect(discordConfig.credentialFields).toBeInstanceOf(Array);
      expect(discordConfig.credentialFields.length).toBeGreaterThan(0);
    });

    it('webhook URL field is required', () => {
      const webhookField = discordConfig.credentialFields.find(f => f.key === 'webhookUrl');
      expect(webhookField).toBeDefined();
      expect(webhookField?.required).toBe(true);
      expect(webhookField?.type).toBe('text');
    });

    it('username field is optional', () => {
      const usernameField = discordConfig.credentialFields.find(f => f.key === 'username');
      expect(usernameField).toBeDefined();
      expect(usernameField?.required).toBe(false);
    });

    it('webhook URL validator validates Discord URLs', () => {
      const webhookField = discordConfig.credentialFields.find(f => f.key === 'webhookUrl');
      const validator = webhookField?.validator;
      expect(typeof validator).toBe('function');

      if (validator) {
        // Valid URLs
        expect(validator('https://discord.com/api/webhooks/123/abc')).toBe(true);
        expect(validator('https://discord.com/api/webhooks/123456789/abcdef')).toBe(true);

        // Invalid URLs
        expect(validator('https://example.com')).not.toBe(true);
        expect(validator('https://discord.com/api/other')).not.toBe(true);
        expect(validator('https://evil.com?discord.com=fake')).not.toBe(true);
        expect(validator('invalid-url')).not.toBe(true);
      }
    });
  });

  describe('discordDestinationType', () => {
    it('has correct ID', () => {
      expect(discordDestinationType.id).toBe('discord');
    });

    it('has display name', () => {
      expect(discordDestinationType.name).toBe('Discord');
    });

    it('has description', () => {
      expect(discordDestinationType.description).toBeTruthy();
      expect(typeof discordDestinationType.description).toBe('string');
    });

    it('has icon', () => {
      expect(discordDestinationType.icon).toBeTruthy();
    });

    it('has image', () => {
      expect(discordDestinationType.image).toBeTruthy();
    });

    it('is marked as popular', () => {
      expect(discordDestinationType.popular).toBe(true);
    });

    it('has correct category', () => {
      expect(discordDestinationType.category).toBe('messaging');
    });
  });
});
