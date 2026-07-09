// ==================== 类型定义 ====================
export interface PropertyMeta {
  name: string
  unit: string
  mode: string
  enum_desc?: Record<string, string>
}

export interface DeviceMeta {
  device_name: string
  product_name?: string
  properties: Record<string, PropertyMeta>
}

export interface SensorData {
  identifier: string
  value: number | string
  time: number
  name: string
  unit: string
  data_type?: string
  mode: string
  enum_desc?: Record<string, string>
}

export interface LatestResponse {
  code: number
  data: SensorData[]
}

export interface HistoryRecord {
  time: string
  value: string
}

export interface HistoryResponse {
  error?: string
  data?: {
    data?: {
      list: HistoryRecord[]
    }
  }
  property_name?: string
  unit?: string
}

export interface DevicesResponse {
  devices: DeviceMeta[]
}

// ==================== API 函数 ====================
const BASE = '/api'

export async function fetchDevices(): Promise<DevicesResponse> {
  const resp = await fetch(`${BASE}/devices`)
  return resp.json()
}

export async function fetchLatest(deviceName: string): Promise<LatestResponse> {
  const resp = await fetch(`${BASE}/latest/api?device_name=${deviceName}`)
  return resp.json()
}

export async function fetchHistory(
  deviceName: string,
  identifier: string,
  start: number,
  end: number,
  limit = 100
): Promise<HistoryResponse> {
  const url = `${BASE}/history?device_name=${deviceName}&identifier=${identifier}&start=${start}&end=${end}&limit=${limit}`
  const resp = await fetch(url)
  return resp.json()
}

export interface SSEConnection {
  close(): void
}

// ==================== YYA 智能决策 API ====================
const YYA_BASE = '/api'

export interface ChatStreamChunk {
  chunk?: string
  done?: boolean
  tts_text?: string
  full_response?: string
  error?: string
}

export async function chatStream(
  message: string,
  onChunk: (html: string) => void,
  onDone: (ttsText: string) => void,
  onError: (err: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const resp = await fetch(`${YYA_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  })

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data: ChatStreamChunk = JSON.parse(line.slice(6))

      if (data.chunk) {
        onChunk(data.chunk)
      } else if (data.done) {
        onDone(data.tts_text || '')
      } else if (data.error) {
        onError(data.error)
      }
    }
  }
}

export async function fetchASR(audioBlob: Blob): Promise<string> {
  const formData = new FormData()
  formData.append('file', audioBlob, 'voice.webm')
  const resp = await fetch(`${YYA_BASE}/asr`, { method: 'POST', body: formData })
  const data = await resp.json()
  return data.text || ''
}

const TTS_URL = 'http://127.0.0.1:9000/tts-stream'

export function getTtsUrl(text: string): string {
  return `${TTS_URL}?text=${encodeURIComponent(text)}`
}

// ==================== 智能决策建议 API ====================
export interface DecisionAdvice {
  category: string
  icon: string
  title: string
  level: 'danger' | 'warning' | 'safe' | 'info'
  items: string[]
}

export interface ProblematicSensor {
  device: string
  name: string
  value: number
  unit: string
  status: 'danger' | 'warning'
  reason: string
}

export interface DecisionAlert {
  level: 'danger' | 'warning' | 'info'
  device: string
  message: string
}

export interface DecisionSummaryData {
  summary: string
  advices: DecisionAdvice[]
  problematicSensors: ProblematicSensor[]
  alerts: DecisionAlert[]
}

export interface DecisionSummaryResponse {
  code: number
  message?: string
  data?: DecisionSummaryData
}

export async function fetchDecisionSummary(prompt: string): Promise<DecisionSummaryResponse> {
  const resp = await fetch('/api/decision/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  return resp.json()
}

// ==================== 阈值管理 API ====================
export interface ThresholdStage {
  id: number
  stageName: string
  stageOrder: number
  typicalStartMonth: number
  typicalEndMonth: number
  gddThresholdLow: number
  gddThresholdHigh: number
  description: string
}

export interface StageThresholdItem {
  id: number
  propertyIdentifier: string
  propertyName: string
  thresholdType: string
  thresholdTypeName: string
  thresholdValue: number
  unit: string
  isActive: boolean
  soilConfigId: number | null
}

export interface ThresholdSnapshotItem {
  id: number
  oldValue: number
  newValue: number
  changeReason: string
  changeSource: string
  operator: string
  changedAt: string
}

export interface CurrentThresholdItem {
  propertyIdentifier: string
  propertyName: string
  thresholdType: string
  thresholdTypeName: string
  value: number
}

export interface CurrentThresholdsData {
  stageName: string
  stageOrder: number
  soilType: string
  description: string
  thresholds: CurrentThresholdItem[]
}

export interface ApiResult<T> {
  code: number
  message?: string
  data?: T
}

export async function fetchCurrentThresholds(soilType = 'LOAM'): Promise<ApiResult<CurrentThresholdsData>> {
  const resp = await fetch(`${BASE}/thresholds/current?soilType=${soilType}`)
  return resp.json()
}

export async function fetchThresholdStages(): Promise<ApiResult<ThresholdStage[]>> {
  const resp = await fetch(`${BASE}/thresholds/stages`)
  return resp.json()
}

export async function fetchStageThresholds(stageId: number): Promise<ApiResult<StageThresholdItem[]>> {
  const resp = await fetch(`${BASE}/thresholds/stages/${stageId}`)
  return resp.json()
}

export async function updateThresholdValue(id: number, value: number, reason = '人工调整', operator = 'admin'): Promise<ApiResult<Record<string, unknown>>> {
  const resp = await fetch(`${BASE}/thresholds/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, reason, operator }),
  })
  return resp.json()
}

export async function fetchThresholdHistory(id: number): Promise<ApiResult<ThresholdSnapshotItem[]>> {
  const resp = await fetch(`${BASE}/thresholds/${id}/history`)
  return resp.json()
}

export async function overridePhenologyStage(cropId: number, stageId: number): Promise<ApiResult<Record<string, unknown>>> {
  const resp = await fetch(`${BASE}/thresholds/phenology/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cropId, stageId }),
  })
  return resp.json()
}

export async function clearPhenologyOverride(cropId: number): Promise<ApiResult<Record<string, unknown>>> {
  const resp = await fetch(`${BASE}/thresholds/phenology/override?cropId=${cropId}`, {
    method: 'DELETE',
  })
  return resp.json()
}

export function createSSEConnection(
  onMessage: (data: Record<string, Record<string, { value: unknown; time: number; name?: string; unit?: string; mode?: string }>>) => void,
  onStatusChange: (online: boolean) => void
): SSEConnection {
  let es: EventSource | null = null
  let retryDelay = 1000
  const MAX_DELAY = 30000
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false
  let errorLogged = false

  function connect() {
    if (destroyed) return
    es = new EventSource(`${BASE}/stream`)

    es.onopen = () => {
      console.log('[SSE] 连接已建立')
      retryDelay = 1000
      errorLogged = false
      onStatusChange(true)
    }

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const deviceCount = typeof data === 'object' && data !== null ? Object.keys(data).length : 0
        if (deviceCount === 0) {
          console.warn('[SSE] 收到空数据或格式异常:', typeof data)
        }
        onMessage(data)
      } catch (err) {
        console.error('[SSE] JSON解析失败:', err)
      }
    }

    es.onerror = () => {
      if (es) {
        es.close()
        es = null
      }
      onStatusChange(false)

      if (!errorLogged) {
        console.error(`[SSE] 连接失败，${retryDelay / 1000}s 后重试 (后端可能未启动)`)
        errorLogged = true
      }

      if (!destroyed) {
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_DELAY)
          connect()
        }, retryDelay)
      }
    }
  }

  console.log('[SSE] 正在建立连接...')
  connect()

  return {
    close() {
      destroyed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      if (es) {
        es.close()
        es = null
      }
    },
  }
}