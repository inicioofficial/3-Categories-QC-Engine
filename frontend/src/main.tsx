import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './index.css'

import App from './App'
import { queryClient } from './lib/queryClient'

// Keep every API request workspace-aware, including file downloads that do not
// go through apiFetch. Bulk case search is intentionally unpaged so a pasted
// list returns the complete matching set instead of only the first 50.
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
  return nativeFetch(nextRequest)
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
