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
import { createPipelinesContextProvider } from './pipelinesContextProvider';

describe('createPipelinesContextProvider', () => {
  it('should create a context provider for creating new pipeline', () => {
    const pipelineObj = {
      currentSelectedPipeline: {
        id: 'pipeline-123',
        name: 'Test Pipeline'
      },
      isEditPipeline: false
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-456'
        }
      }
    };

    const provider = createPipelinesContextProvider(pipelineObj, store);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Pipelines');
    expect(context.pipelineId).toBe('pipeline-123');
    expect(context.pipelineName).toBe('Test Pipeline');
    expect(context.organization_identifier).toBe('org-456');
    expect(context.user_intent).toBe('create new pipeline');
  });

  it('should create a context provider for editing existing pipeline', () => {
    const pipelineObj = {
      currentSelectedPipeline: {
        id: 'pipeline-789',
        name: 'Updated Pipeline'
      },
      isEditPipeline: true
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-123'
        }
      }
    };

    const provider = createPipelinesContextProvider(pipelineObj, store);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Pipelines');
    expect(context.pipelineId).toBe('pipeline-789');
    expect(context.pipelineName).toBe('Updated Pipeline');
    expect(context.organization_identifier).toBe('org-123');
    expect(context.user_intent).toBe('edit existing pipeline');
  });

  it('should handle missing pipeline data gracefully', () => {
    const pipelineObj = { currentSelectedPipeline: null, isEditPipeline: false };
    const store = { state: { selectedOrganization: null } };

    const provider = createPipelinesContextProvider(pipelineObj, store);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Pipelines');
    expect(context.pipelineId).toBe('');
    expect(context.pipelineName).toBe('');
    expect(context.organization_identifier).toBe('');
  });
});
