import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './index.css'

import App from './App'
import { queryClient } from './lib/queryClient'

const AUDIO_AUDIT_VARIABLE = /^(?:audio_audit_.+|audiorecord1)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAudioAuditVariable(value: unknown): value is string {
  return typeof value === 'string' && AUDIO_AUDIT_VARIABLE.test(value.trim())
}

function sanitizeAudioFiles(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const result: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [variableName, rawValue] of Object.entries(value)) {
    if (!isAudioAuditVariable(variableName) || typeof rawValue !== 'string') continue
    const mediaRef = rawValue.trim()
    if (!mediaRef) continue

    const normalizedVariable = variableName.trim()
    const key = normalizedVariable.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result[normalizedVariable] = mediaRef
  }
  return result
}

function sanitizeAudioItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []

  const result: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const rawItem of value) {
    if (!isRecord(rawItem)) continue

    const variableName = typeof rawItem.variable_name === 'string' ? rawItem.variable_name.trim() : ''
    if (!isAudioAuditVariable(variableName)) continue

    const mediaUrl = typeof rawItem.media_url === 'string' ? rawItem.media_url.trim() : ''
    const fileName = typeof rawItem.file_name === 'string' ? rawItem.file_name.trim() : ''
    if (!mediaUrl && !fileName) continue

    const key = variableName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...rawItem, variable_name: variableName })
  }
  return result
}

function sanitizeAudioListeningDetail(payload: unknown): unknown {
  if (!isRecord(payload)) return payload

  const audioFiles = sanitizeAudioFiles(payload.audio_files)
  const audioItems = sanitizeAudioItems(payload.audio_file_items)
  const seenVariables = new Set(
    audioItems
      .map((item) => (typeof item.variable_name === 'string' ? item.variable_name.toLowerCase() : ''))
      .filter(Boolean),
  )

  for (const [variableName, mediaRef] of Object.entries(audioFiles)) {
    if (seenVariables.has(variableName.toLowerCase())) continue
    audioItems.push({
      variable_name: variableName,
      label: variableName,
      file_name: mediaRef,
      media_url: mediaRef,
    })
    seenVariables.add(variableName.toLowerCase())
  }

  const firstItem = audioItems[0]
  const primaryAudio = firstItem
    ? (typeof firstItem.media_url === 'string' && firstItem.media_url.trim()) ||
      (typeof firstItem.file_name === 'string' && firstItem.file_name.trim()) ||
      null
    : Object.values(audioFiles)[0] ?? null

  return {
    ...payload,
    audio_file_items: audioItems,
    audio_files: audioFiles,
    audio_url: primaryAudio,
  }
}

function isAudioListeningDetailPath(pathname: string) {
  return pathname.startsWith('/api/main-survey/audio-listening/') && pathname.endsWith('/detail')
}

async function sanitizeAudioListeningResponse(response: Response, pathname: string): Promise<Response> {
  if (!response.ok || !isAudioListeningDetailPath(pathname)) return response
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return response

  try {
    const payload = await response.clone().json()
    const sanitizedPayload = sanitizeAudioListeningDetail(payload)
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(JSON.stringify(sanitizedPayload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return response
  }
}

// Keep every API request workspace-aware, including file downloads that do not
// go through apiFetch. Bulk case search is intentionally unpaged so a pasted
// list returns the complete matching set instead of only the first 50.
// Silent Listening detail responses are also normalized here so the three
// category dashboards render only real SurveyCTO audio-audit recordings: no
// questionnaire media (for example `radioplay`), no duplicate variables, and
// no generic fallback audio when a respondent genuinely has zero audit tracks.
const nativeFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const requestInput =
    typeof input === 'string' && input.startsWith('/')
      ? new URL(input, window.location.origin).toString()
      : input
  const request = new Request(requestInput, init)
  const url = new URL(request.url, window.location.origin)
  const headers = new Headers(request.headers)
  const workspace = window.sessionStorage.getItem('efina_platform_workspace')

  if (workspace && url.pathname.startsWith('/api/') && !headers.has('X-Workspace')) {
    headers.set('X-Workspace', workspace)
  }

  let replacementBody: string | undefined
  if (request.method.toUpperCase() === 'POST' && url.pathname === '/api/main-survey/cases/bulk-search') {
    try {
      const rawBody = await request.clone().text()
      const payload = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {}
      if (Array.isArray(payload.terms) && payload.terms.length > 0) {
        payload.page = 1
        payload.page_size = 100_000
        replacementBody = JSON.stringify(payload)
        headers.set('Content-Type', 'application/json')
      }
    } catch {
      // Fall through with the original request if the body is not valid JSON.
    }
  }

  const nextRequest = new Request(request, {
    headers,
    ...(replacementBody !== undefined ? { body: replacementBody } : {}),
  })
  const response = await nativeFetch(nextRequest)
  return sanitizeAudioListeningResponse(response, url.pathname)
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
