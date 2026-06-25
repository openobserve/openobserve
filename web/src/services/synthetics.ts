// Copyright 2026 OpenObserve Inc.
import http from './http'

const syntheticsService = {
  create: (orgIdentifier: string, payload: unknown) =>
    http().post(`/api/${orgIdentifier}/synthetics/browser`, payload),

  update: (orgIdentifier: string, id: string, payload: unknown) =>
    http().put(`/api/${orgIdentifier}/synthetics/browser/${id}`, payload),

  get: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/browser/${id}`),

  list: (orgIdentifier: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/browser`),

  delete: (orgIdentifier: string, id: string) =>
    http().delete(`/api/${orgIdentifier}/synthetics/browser/${id}`),
}

export default syntheticsService
