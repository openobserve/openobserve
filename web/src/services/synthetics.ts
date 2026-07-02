// Copyright 2026 OpenObserve Inc.
import http from './http'

const syntheticsService = {
  create: (orgIdentifier: string, payload: unknown, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : ''
    return http().post(`/api/${orgIdentifier}/synthetics${params}`, payload)
  },

  update: (orgIdentifier: string, id: string, payload: unknown, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : ''
    return http().put(`/api/${orgIdentifier}/synthetics/${id}`, payload)
  },

  get: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}`),

  list: (orgIdentifier: string) =>
    http().get(`/api/${orgIdentifier}/synthetics`),

  listByFolderId: (orgIdentifier: string, folderId?: string) => {
    const params = folderId && folderId !== 'all' ? `?folder=${folderId}` : ''
    return http().get(`/api/${orgIdentifier}/synthetics${params}`)
  },

  delete: (orgIdentifier: string, id: string, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : ''
    return http().delete(`/api/${orgIdentifier}/synthetics/${id}${params}`)
  },

  bulkDelete: (orgIdentifier: string, payload: { ids: string[] }, folderId?: string) => {
    const params = folderId ? `?folder=${folderId}` : ''
    return http().delete(`/api/${orgIdentifier}/synthetics${params}`, { data: payload })
  },

  enable: (orgIdentifier: string, id: string, payload: unknown) =>
    http().put(`/api/${orgIdentifier}/synthetics/${id}/enable`, payload),

  run: (orgIdentifier: string, id: string, payload: unknown) =>
    http().post(`/api/${orgIdentifier}/synthetics/${id}/run`, payload),

  summary: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/summary`),

  results: (orgIdentifier: string, id: string, params?: Record<string, string | number>) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/results`, { params }),

  getArtifacts: (orgIdentifier: string, id: string, jobId: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/results/${jobId}/artifacts`),

  artifactUrl: (orgIdentifier: string, id: string, jobId: string, type: 'screenshot' | 'trace', step?: string) => {
    const params = new URLSearchParams({ type })
    if (step) params.set('step', step)
    return `/api/${orgIdentifier}/synthetics/${id}/results/${jobId}/artifact?${params}`
  },

  getLocations: (orgIdentifier: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/locations`),
}

export default syntheticsService
