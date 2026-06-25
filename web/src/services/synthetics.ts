// Copyright 2026 OpenObserve Inc.
import http from './http'

const syntheticsService = {
  create: (orgIdentifier: string, payload: unknown) =>
    http().post(`/api/${orgIdentifier}/synthetics`, payload),

  update: (orgIdentifier: string, id: string, payload: unknown) =>
    http().put(`/api/${orgIdentifier}/synthetics/${id}`, payload),

  get: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}`),

  list: (orgIdentifier: string) =>
    http().get(`/api/${orgIdentifier}/synthetics`),

  delete: (orgIdentifier: string, id: string) =>
    http().delete(`/api/${orgIdentifier}/synthetics/${id}`),

  enable: (orgIdentifier: string, id: string, payload: unknown) =>
    http().put(`/api/${orgIdentifier}/synthetics/${id}/enable`, payload),

  run: (orgIdentifier: string, id: string, payload: unknown) =>
    http().post(`/api/${orgIdentifier}/synthetics/${id}/run`, payload),

  summary: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/summary`),

  results: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/synthetics/${id}/results`),
}

export default syntheticsService
