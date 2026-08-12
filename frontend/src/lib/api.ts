export interface AuthUser {
  id: string
  username: string
  role: string
  fullName: string
  email: string
}

export interface UserAccount {
  user_id: string
  username: string
  full_name: string
  email: string | null
  is_active: boolean
  created_at: string | null
  roles: string[]
}

export interface DashboardOverview {
  statusCounts: Record<string, number>
  listingCounts: Record<string, number>
  issueCounts: Record<string, number>
  changeCounts: Record<string, number>
  syncState: Record<string, string | null>
  stateEaSummary: StateEaSummaryItem[]
}

export interface StateEaSummaryItem {
  state: string
  targetEas: number
  totalEas: number
  completedEas: number
  approvedEas: number
  rejectedEas: number
}

export interface CaseListItem {
  submission_key: string
  ea_id: string
  boundary_id: string | null
  interviewer_id: string | null
  supervisor_id: string | null
  approval_status: string
  submission_date: string | null
  completion_date: string | null
  ea_name: string | null
  lga_name: string | null
  state_name: string | null
  region_label?: string | null
  region_respondent_ordinal?: number | null
  sector_label?: string | null
  gps_lat?: number | string | null
  gps_long?: number | string | null
  approved_by: string | null
  sample_type: string | null
  household_count: number
  building_only_count: number
  sampled_household_count: number
  open_issue_count: number
  qc_flag_count?: number
  pending_change_count: number
}

export interface InterviewerStat {
  interviewer_id: string
  total_submissions: number
  approved_count: number
  rejected_count: number
  pending_count: number
  total_households: number
  total_buildings: number
  total_sampled: number
  open_issues: number
  total_issues: number
  [key: string]: string | number
}

export interface QcProductivityItem {
  username: string
  full_name: string
  total_pushed: number
  completed: number
  pending: number
  approved?: number
  canceled?: number
}

export interface QcProductivityTotals {
  totalCases?: number
  approved: number
  pending: number
  canceled: number
}

export interface QcProductivityByDatePayload {
  dates: string[]
  items: Array<{
    username: string
    full_name: string
    counts: Record<string, number>
  }>
}

export interface ListingRow {
  listing_row_id: string
  building_no: number | null
  household_no_within_building: number | null
  row_type: string
  sample_flag: boolean
  gps_lat: number | null
  gps_long: number | null
  gps_source: string | null
  record: Record<string, unknown>
}

export interface SelectedRow {
  selected_id: string
  selected_repeat_no: number
  selected_join_key: string | null
  sample_case_id: string | null
  sample_case_label: string | null
  slot_type: string | null
  record: Record<string, unknown>
}

export interface IssueItem {
  issue_id: string
  issue_status: string
  issue_summary: string
  rule_code?: string | null
  severity?: string | null
  table_name?: string | null
  row_identifier?: string | null
  field_name?: string | null
  variable_label?: string | null
  case_id?: string | null
  case_label?: string | null
  current_value?: string | null
  matching_case_keys?: string[]
  matching_cases?: Array<{
    submission_key: string
    case_label: string
  }>
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
}

export interface PendingChange {
  change_id: string
  issue_id?: string | null
  case_id?: string | null
  table_name: string
  row_identifier: string | null
  field_name: string
  current_value: string | null
  proposed_value: string | null
  change_reason: string
  change_status: string
  requested_by_user_id?: string | null
  reviewed_by_user_id?: string | null
  requested_by_name?: string | null
  reviewed_by_name?: string | null
  requested_device_id?: string | null
  reviewed_device_id?: string | null
  requested_at: string
  reviewed_at: string | null
  review_note: string | null
}

export interface StatusHistory {
  status_history_id: string
  previous_status: string | null
  new_status: string
  change_note: string | null
  changed_at: string
  device_id?: string | null
  changed_by_user_id?: string | null
  changed_by_name?: string | null
  changed_by_email?: string | null
}

export interface ListingCaseDetail {
  case: Record<string, unknown>
  listingRows: ListingRow[]
  selectedRows: SelectedRow[]
  issues: IssueItem[]
  pendingChanges: PendingChange[]
  history: StatusHistory[]
  eaFeature?: Record<string, unknown> | null
}

export interface MainCaseListItem {
  submission_key: string
  case_id: string
  ea_id: string | null
  interviewer_id: string | null
  supervisor_id: string | null
  approval_stage: string
  submitted_at: string | null
  start_time?: string | null
  updated_at: string | null
  ea_name: string | null
  lga_name: string | null
  state_name: string | null
  region_label?: string | null
  region_respondent_ordinal?: number | null
  sector_label?: string | null
  gps_lat?: number | string | null
  gps_long?: number | string | null
  approved_by: string | null
  is_auto_approved?: boolean
  slot_type: string | null
  username: string | null
  final_outcome_code: string | null
  section_count: number
  open_issue_count: number
  qc_flag_count?: number
  pending_change_count: number
  has_callback_history: boolean
  has_audio_history: boolean
  callback_assigned_to_user_id?: string | null
  callback_assigned_to_name?: string | null
  audio_assigned_to_user_id?: string | null
  audio_assigned_to_name?: string | null
  supacc_confirm: string | null
  selected_panel_labels?: string | null
  auto_flagged_qc_issue_codes?: string | null
  auto_flagged_qc_issues?: string | null
}

export interface MainCaseSection {
  section_row_id: string
  section_name: string
  row_no: number
  record: Record<string, unknown>
}

export interface MainCaseDetail {
  case: Record<string, unknown>
  sections: MainCaseSection[]
  issues: IssueItem[]
  pendingChanges: PendingChange[]
  history: StatusHistory[]
  activity_timeline?: Array<{
    event_type: string
    title: string
    queue: string
    status: string | null
    event_time: string | null
    actor_user_id?: string | null
    actor_name?: string | null
    assignee_user_id?: string | null
    assignee_name?: string | null
    note?: string | null
    metadata?: Record<string, unknown>
  }>
  selectedPanelBauSnapshot?: Array<{
    panelCode: string
    panelLabel: string
    variableName: string
    variableLabel: string
    value: string
  }>
}

export interface MainCaseListResponse {
  items: MainCaseListItem[]
  total: number
  totalOpenIssues?: number
  limit: number
  offset: number
  has_more: boolean
  filterOptions?: {
    cities?: string[]
    interviewers?: string[]
  }
}

export interface ExportFileItem {
  file_id: string
  export_job_id?: string
  export_profile: string
  export_format: string
  file_name: string
  file_path: string
  generated_at: string
  row_count: number
  byte_size: number
  job_status?: string
  job_message?: string | null
  download_ready?: boolean
}

export interface MapGpsPoint {
  point_id: string
  submission_key: string
  ea_id: string | null
  row_type: string
  sample_flag: boolean
  gps_lat: number
  gps_long: number
  approval_status: string | null
  ea_name: string | null
  state_name?: string | null
  selected_panel_labels?: string | null
  gender?: string | null
}

export interface MapSummary {
  eaCount: number
  gpsPointCount: number
  approvedEaCount: number
  issueEaCount: number
}

export interface ListingMapPageInfo {
  offset: number
  limit: number
  returnedFeatures: number
  returnedGpsPoints: number
  hasMore: boolean
  hasMoreFeatures?: boolean
  hasMoreGpsPoints?: boolean
  viewportFiltered?: boolean
}

export interface ListingMapPayload {
  type: 'FeatureCollection'
  features: Array<Record<string, unknown>>
  gpsPoints: MapGpsPoint[]
  summary: MapSummary
  pageInfo?: ListingMapPageInfo
}

export interface StateBoundariesPayload {
  type: 'FeatureCollection'
  features: Array<Record<string, unknown>>
}

export interface MainSurveyFilterOptionsPayload {
  states: string[]
  genders: string[]
  maritalStatuses: string[]
  educationLevels: string[]
}

export interface SectionFilters {
  states: string[]
  genders: string[]
  maritalStatuses: string[]
  educationLevels: string[]
}

export interface MainSurveySectionSummary {
  section: string
  title: string
  slug: string
  pageEnabled: boolean
  dictionaryLoaded: boolean
  variableCount: number
  codedCount: number
  helperCount: number
  blockCount: number
  recordCount: number
}

export interface MainSurveyOverviewPayload {
  status: 'records' | 'dictionary-only'
  workbookPath: string
  summary: string
  totalPageSections: number
  dictionaryBackedSections: number
  populatedSections: number
  totalVariables: number
  totalRecords: number
  sections: MainSurveySectionSummary[]
}

export interface MainSurveyDictionaryRowPayload {
  variable: string
  label: string
  storageType: string
  measure: string
  valueLabels: string
}

export interface MainSurveyBlockRowPayload {
  block: string
  variableCount: number
  focus: string
  note: string
}

export interface MainSurveyChartPoint {
  label: string
  value: number
}

export interface MainSurveyChartPayload {
  key?: string
  title: string
  variable?: string
  label?: string
  source?: 'records'
  data: MainSurveyChartPoint[]
}

export interface MainSurveyQuestionTableRowPayload {
  code: string
  label: string
  count: number
  percent: number
}

export interface MainSurveyQuestionCardPayload {
  variable: string
  label: string
  storageType: string
  measure: string
  valueLabels: string
  source: 'records' | 'dictionary'
  isMultiSelect: boolean
  responseCount: number
  distinctResponseCount: number
  note: string
  tableRows: MainSurveyQuestionTableRowPayload[]
  chartData: MainSurveyChartPoint[]
}

export interface MainSurveySectionPayload {
  status: 'records' | 'dictionary-only'
  workbookPath: string
  summary: string
  section: MainSurveySectionSummary
  stats: {
    variableCount: number
    codedCount: number
    helperCount: number
    blockCount: number
    recordCount: number
    observedQuestionCount: number
  }
  blockRows: MainSurveyBlockRowPayload[]
  metadataCharts: MainSurveyChartPayload[]
  variableCharts: MainSurveyChartPayload[]
  questionCards: MainSurveyQuestionCardPayload[]
  dictionary: MainSurveyDictionaryRowPayload[]
}

export interface MainSurveyDemographicsBin {
  value: string
  count: number
  pct: number
}

export interface MainSurveyOverviewDemographicsPayload {
  category: string
  totalRespondents: number
  monthsAvailable: string[]
  monthsSelected: string[]
  statesSelected?: string[]
  pipelineKpis?: {
    totalEAs: number
    totalHouseholds: number
    approvedHH: number
    rejectedHH: number
  }
  distributions: {
    state?: MainSurveyDemographicsBin[]
    gender?: MainSurveyDemographicsBin[]
    ageGroup?: MainSurveyDemographicsBin[]
    sec?: MainSurveyDemographicsBin[]
    maritalStatus?: MainSurveyDemographicsBin[]
    education?: MainSurveyDemographicsBin[]
    incomeSource?: MainSurveyDemographicsBin[]
    incomeFrequency?: MainSurveyDemographicsBin[]
    incomeMode?: MainSurveyDemographicsBin[]
    householdHead?: MainSurveyDemographicsBin[]
  }
}

export interface MainSurveyStateEaRow {
  state_name: string;
  ea_id?: string | null;
  ea_name?: string | null;
  target_cases: number;
  total_cases: number;
  main_achieved_cases: number;
  replacement_achieved_cases: number;
  approved_cases: number;
  rejected_cases: number;
  pending_cases: number;
  accompaniment_yes: number;
  accompaniment_pct: number;
}

export interface MainSurveyStateEaSummary {
  stateRows: MainSurveyStateEaRow[];
  eaRows: MainSurveyStateEaRow[];
}

export interface MainSurveyEaGpsPoint {
  submission_key: string;
  case_id: string | null;
  approval_stage: string | null;
  lat: number;
  lng: number;
}

export interface MainSurveyEaListingGpsPoint {
  point_id: string;
  submission_key: string;
  ea_id: string | null;
  row_type: string;
  sample_flag: boolean;
  gps_lat: number;
  gps_long: number;
  approval_status: string | null;
  ea_name: string | null;
  state_name?: string | null;
  sample_status?: string | null;
}

export interface MainSurveyEaCaseSummary {
  submission_key: string;
  case_id: string | null;
  approval_stage: string | null;
  submitted_at: string | null;
  interviewer_id: string | null;
  supervisor_id: string | null;
}

export interface MainSurveyEaOverview {
  eaId: string;
  eaName: string;
  stateName: string;
  lgaName: string | null;
  totalCases: number;
  approvedCases: number;
  rejectedCases: number;
  pendingCases: number;
  gpsPoints: MainSurveyEaGpsPoint[];
  listingGpsPoints?: MainSurveyEaListingGpsPoint[];
  cases: MainSurveyEaCaseSummary[];
  eaFeature?: Record<string, unknown> | null;
}

export interface AnalysisBreakdownRow {
  submission_key: string;
  state_name: string | null;
  ea_name: string | null;
  submitted_at: string | null;
  interviewer_id: string | null;
  approval_stage?: string | null;
}

export interface BreakdownState {
  module: "main" | "listing";
  questionLabel: string;
  answerLabel: string;
  answerCode: string;
  sectionSlug?: string;
  questionVariable?: string;
  isMultiSelect?: boolean;
  fieldKey?: string;
  filterState?: string;
  filterEaId?: string;
  filterStatuses?: string[];
  storageType?: string;
  allowFreeformEdit?: boolean;
}

export interface CustomTableQuestionRef {
  id: string
  label: string
  sectionId: string
  sectionTitle: string
  questionCodes: string[]
  codeLabels?: Record<string, string>
}

export interface CustomTableChiSquare {
  statistic: number
  degreesOfFreedom: number
}

export interface CustomTableColumnBlock {
  id: string
  topQuestion: CustomTableQuestionRef
  columnLabels: string[]
  columnLetterLabels: string[]
  columnBases: number[]
  counts: number[][]
  significanceLetters: string[][]
  pairRespondents: number
  chiSquare: CustomTableChiSquare | null
  notes: string[]
}

export interface CustomTableResultTable {
  id: string
  sideQuestion: CustomTableQuestionRef
  rowLabels: string[]
  rowBases: number[]
  rowCounts: number[]
  totalRespondents: number
  topBlocks: CustomTableColumnBlock[]
}

export interface CustomTableResponse {
  category: string
  displayMode: string
  analysisOptions: string[]
  formatOptions: Record<string, unknown>
  totalRespondents: number
  generatedAt: string
  tables: CustomTableResultTable[]
}

export interface CustomTableSelectionPayload {
  slug: string
  topQuestions: CustomTableQuestionRef[]
  sideQuestions: CustomTableQuestionRef[]
  displayMode: 'row_pct' | 'column_pct' | 'total_pct' | 'counts'
  analysisOptions: string[]
  formatOptions: Record<string, unknown>
  filters: Record<string, string[]>
  months: string[]
}

const EXPLICIT_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
const API_RESPONSE_CACHE_TTL_MS = 60_000
const API_RESPONSE_CACHE = new Map<string, { createdAt: number; payload: unknown }>()
const API_PENDING_CACHE = new Map<string, Promise<unknown>>()
const DEVICE_ID_STORAGE_KEY = 'efina_platform_device_id'
const API_REQUEST_TIMEOUT_MS = 45_000

function apiBaseCandidates(path: string) {
  if (path.startsWith('/api')) {
    if (EXPLICIT_API_BASE) {
      return [EXPLICIT_API_BASE]
    }

    return ['']
  }

  if (EXPLICIT_API_BASE) {
    return [EXPLICIT_API_BASE, '']
  }

  return ['']
}

async function parseErrorDetail(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null)
  if (payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string') {
    return payload.detail
  }
  return fallbackMessage
}

function buildCacheKey(path: string, token?: string | null, method?: string) {
  return `${method ?? 'GET'}:${token ?? 'anonymous'}:${path}`
}

function getOrCreateDeviceId() {
  if (typeof window === 'undefined') {
    return 'server-render'
  }

  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const generated =
    typeof window.crypto !== 'undefined' && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated)
  return generated
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
  timeoutMs: number = API_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  headers.set('Content-Type', 'application/json')
  headers.set('X-Device-Id', getOrCreateDeviceId())
  if (typeof window !== 'undefined') {
    const workspace = window.sessionStorage.getItem('efina_platform_workspace')
    if (workspace) headers.set('X-Workspace', workspace)
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const candidates = apiBaseCandidates(path)
  let lastError: Error | null = null

  for (let index = 0; index < candidates.length; index += 1) {
    const base = candidates[index]

    try {
      const controller = new AbortController()
      const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

      if (init.signal) {
        if (init.signal.aborted) {
          controller.abort()
        } else {
          init.signal.addEventListener('abort', () => controller.abort(), { once: true })
        }
      }

      const response = await fetch(`${base}${path}`, { ...init, headers, signal: controller.signal })
      globalThis.clearTimeout(timeoutId)
      if (!response.ok) {
        const canRetryWithNextCandidate =
          base === '' &&
          index < candidates.length - 1 &&
          response.status === 404 &&
          typeof window !== 'undefined'

        if (canRetryWithNextCandidate) {
          continue
        }

        throw new Error(await parseErrorDetail(response, 'Request failed.'))
      }

      return response.json() as Promise<T>
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new Error('The backend took too long to respond. Please try again.')
      } else {
        lastError = error instanceof Error ? error : new Error('Request failed.')
      }

      if (index < candidates.length - 1) {
        continue
      }
    }
  }

  throw lastError ?? new Error('Request failed.')
}

export async function apiFetchCached<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
  options: { forceRefresh?: boolean; timeoutMs?: number; maxAgeMs?: number } = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const workspace = typeof window !== 'undefined' ? window.sessionStorage.getItem('efina_platform_workspace') ?? '' : ''
  const cacheKey = `${workspace}:${buildCacheKey(path, token, method)}`
  const maxAgeMs = options.maxAgeMs ?? API_RESPONSE_CACHE_TTL_MS

  if (method !== 'GET') {
    return apiFetch<T>(path, init, token, options.timeoutMs)
  }

  if (!options.forceRefresh && API_RESPONSE_CACHE.has(cacheKey)) {
    const cached = API_RESPONSE_CACHE.get(cacheKey)
    if (cached && Date.now() - cached.createdAt < maxAgeMs) {
      return cached.payload as T
    }
    API_RESPONSE_CACHE.delete(cacheKey)
  }

  if (!options.forceRefresh && API_PENDING_CACHE.has(cacheKey)) {
    return API_PENDING_CACHE.get(cacheKey) as Promise<T>
  }

  const request = apiFetch<T>(path, init, token, options.timeoutMs)
    .then((payload) => {
      API_RESPONSE_CACHE.set(cacheKey, { createdAt: Date.now(), payload })
      API_PENDING_CACHE.delete(cacheKey)
      return payload
    })
    .catch((error) => {
      API_PENDING_CACHE.delete(cacheKey)
      throw error
    })

  API_PENDING_CACHE.set(cacheKey, request as Promise<unknown>)
  return request
}

export function clearApiCache() {
  API_RESPONSE_CACHE.clear()
  API_PENDING_CACHE.clear()
}

export function prefetchPostLoginData(token: string) {
  void Promise.allSettled([
    apiFetchCached<DashboardOverview>('/api/dashboard/overview', {}, token),
  ])
}

export async function downloadFile(path: string, fileName: string, token: string): Promise<void> {
  const candidates = apiBaseCandidates(path)
  let lastError: Error | null = null

  for (let index = 0; index < candidates.length; index += 1) {
    const base = candidates[index]

    try {
      const response = await fetch(`${base}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Device-Id': getOrCreateDeviceId(),
        },
      })

      if (!response.ok) {
        const canRetryWithNextCandidate =
          base === '' &&
          index < candidates.length - 1 &&
          response.status === 404 &&
          typeof window !== 'undefined'

        if (canRetryWithNextCandidate) {
          continue
        }

        throw new Error(await parseErrorDetail(response, 'Download failed.'))
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      URL.revokeObjectURL(url)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Download failed.')

      if (index < candidates.length - 1) {
        continue
      }
    }
  }

  throw lastError ?? new Error('Download failed.')
}

// ─── Listing Analysis ────────────────────────────────────────────────────────

export interface ListingAnalysisFilterOptions {
  states: string[]
  eas: Array<{ ea_id: string; ea_name: string }>
}

export interface ListingAnalysisCard {
  variable: string
  label: string
  responseCount: number
  tableRows: Array<{ code: string; label: string; count: number; percent: number }>
  stats?: { mean: number; median: number; mode: number }
}

export interface ListingAnalysisPayload {
  totalHouseholds: number
  cards: ListingAnalysisCard[]
}
