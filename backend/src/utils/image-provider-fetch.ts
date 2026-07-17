import type { ProviderRequest } from '../services/adapters/types.js'
import type { AIConfig } from '../services/ai.js'
import {
  isApimartProvider,
  isRetryableApimartFetchError,
  isRetryableApimartHttpStatus,
  listApimartApiBases,
} from '../constants/apimart.js'
import { logTaskWarn } from './task-logger.js'

type FetchImageRequestOptions = {
  config: AIConfig
  buildRequest: (config: AIConfig) => ProviderRequest
  logLabel?: string
  taskId?: number
}

export async function fetchImageProviderRequest(options: FetchImageRequestOptions): Promise<{
  config: AIConfig
  request: ProviderRequest
  response: Response
  result: any
}> {
  const bases = isApimartProvider(options.config.provider)
    ? listApimartApiBases(options.config)
    : [options.config.baseUrl]

  let lastError = 'APIMart 所有域名均不可达'
  for (let i = 0; i < bases.length; i += 1) {
    const baseUrl = bases[i]
    const activeConfig = { ...options.config, baseUrl }
    const request = options.buildRequest(activeConfig)
    const isFormData = typeof FormData !== 'undefined' && request.body instanceof FormData

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: isFormData
          ? { Authorization: request.headers.Authorization || request.headers.authorization || '' }
          : request.headers,
        body: isFormData ? request.body : (request.body != null ? JSON.stringify(request.body) : undefined),
        signal: AbortSignal.timeout(600_000),
      })

      const text = await response.text()
      let result: any
      try {
        result = text ? JSON.parse(text) : {}
      } catch {
        result = { raw: text.slice(0, 800) }
      }

      if (!response.ok) {
        const message = `API error ${response.status}: ${text.slice(0, 500)}`
        if (
          isApimartProvider(options.config.provider)
          && i < bases.length - 1
          && isRetryableApimartHttpStatus(response.status)
        ) {
          lastError = message
          logTaskWarn('ImageTask', options.logLabel || 'apimart-mirror-retry', {
            id: options.taskId,
            baseUrl,
            status: response.status,
            attempt: i + 1,
            total: bases.length,
          })
          continue
        }
        throw new Error(message)
      }

      if (isApimartProvider(options.config.provider) && i > 0) {
        logTaskWarn('ImageTask', 'apimart-mirror-active', {
          id: options.taskId,
          baseUrl,
          attempt: i + 1,
        })
      }

      return { config: activeConfig, request, response, result }
    } catch (error: any) {
      const message = String(error?.message || error)
      if (
        isApimartProvider(options.config.provider)
        && i < bases.length - 1
        && isRetryableApimartFetchError(error)
      ) {
        lastError = message
        logTaskWarn('ImageTask', options.logLabel || 'apimart-mirror-retry', {
          id: options.taskId,
          baseUrl,
          error: message,
          attempt: i + 1,
          total: bases.length,
        })
        continue
      }
      throw error
    }
  }

  throw new Error(lastError)
}
