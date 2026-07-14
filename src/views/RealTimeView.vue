<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDeviceStore } from '../stores/devices'

const store = useDeviceStore()
const router = useRouter()

// ==================== 数值格式化 ====================
function formatValue(val: number | string, ident: string): string {
  if (val === null || val === undefined) return '--'
  const num = Number(val)
  if (isNaN(num)) return String(val)
  if (Number.isInteger(num)) return String(num)
  const lower = ident.toLowerCase()
  if (lower.includes('temp') || lower.includes('humi') || lower.includes('ph')) {
    return num.toFixed(1)
  }
  return num.toFixed(1)
}

// ==================== 看板配置 ====================
interface DashboardConfig {
  selectedDevices: string[]
  deviceProperties: Record<string, string[]>
}

const STORAGE_KEY = 'dashboard_config_v1'

function loadConfig(): DashboardConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { selectedDevices: [], deviceProperties: {} }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboardConfig.value))
}

const dashboardConfig = ref<DashboardConfig>(loadConfig())

// 所有可用设备
const allDeviceNames = computed(() => Object.keys(store.devicesMeta))

// 所有属性标识
const allPropertyIdents = computed(() => {
  const set = new Set<string>()
  for (const props of Object.values(store.devicesMeta)) {
    for (const ident of Object.keys(props)) {
      set.add(ident)
    }
  }
  return Array.from(set)
})

// 属性标识 -> 中文名
const propertyNameMap = computed(() => {
  const map: Record<string, string> = {}
  for (const props of Object.values(store.devicesMeta)) {
    for (const [ident, meta] of Object.entries(props)) {
      if (!map[ident]) map[ident] = meta.name || ident
    }
  }
  return map
})

// 当前选中的设备
const selectedDevices = computed({
  get: () => {
    if (dashboardConfig.value.selectedDevices.length === 0 && allDeviceNames.value.length > 0) {
      return [...allDeviceNames.value]
    }
    return dashboardConfig.value.selectedDevices.filter(d => allDeviceNames.value.includes(d))
  },
  set: (val) => {
    dashboardConfig.value.selectedDevices = val
    saveConfig()
  },
})

// 配置面板可见性
const configVisible = ref(false)

// 当前编辑中的设备属性
const editingDevice = ref<string | null>(null)

function getDeviceProperties(deviceName: string): string[] {
  if (!dashboardConfig.value.deviceProperties[deviceName]) {
    const meta = store.devicesMeta[deviceName]
    if (meta) return Object.keys(meta)
    return []
  }
  return dashboardConfig.value.deviceProperties[deviceName].filter(p => {
    const meta = store.devicesMeta[deviceName]
    return meta && p in meta
  })
}

function setDeviceProperties(deviceName: string, props: string[]) {
  dashboardConfig.value.deviceProperties[deviceName] = props
  saveConfig()
}

function toggleDevice(deviceName: string) {
  const idx = selectedDevices.value.indexOf(deviceName)
  if (idx >= 0) {
    selectedDevices.value = selectedDevices.value.filter(d => d !== deviceName)
  } else {
    selectedDevices.value = [...selectedDevices.value, deviceName]
  }
}

function toggleProperty(deviceName: string, prop: string) {
  const current = getDeviceProperties(deviceName)
  if (current.includes(prop)) {
    setDeviceProperties(deviceName, current.filter(p => p !== prop))
  } else {
    setDeviceProperties(deviceName, [...current, prop])
  }
}

// 快捷模板
interface QuickTemplate {
  name: string
  properties: string[]
}

const quickTemplates: QuickTemplate[] = [
  { name: '温湿度模板', properties: ['temperature', 'humidity'] },
  { name: '土壤监测', properties: ['temperature', 'humidity', 'PH'] },
  { name: '完整环境', properties: ['temperature', 'humidity', 'PH', 'light'] },
  { name: '灌溉相关', properties: ['humidity', 'temperature', 'pump'] },
  { name: '土壤养分', properties: ['M', 'N', 'O'] },
]

function applyTemplate(tpl: QuickTemplate) {
  for (const dev of selectedDevices.value) {
    const available = Object.keys(store.devicesMeta[dev] || {})
    const matched = tpl.properties.filter(p => available.includes(p))
    if (matched.length > 0) {
      setDeviceProperties(dev, matched)
    }
  }
  configVisible.value = false
}

// ==================== 设备数据 ====================
function getDeviceSensors(deviceName: string) {
  const data = store.latestData[deviceName]
  if (!data) return []
  const meta = store.devicesMeta[deviceName] || {}
  const selectedProps = getDeviceProperties(deviceName)
  const result = []
  for (const ident of selectedProps) {
    const item = data[ident]
    const m = meta[ident] || {}
    const name = m.name || (item?.name) || ident
    const unit = m.unit || (item?.unit) || ''
    const val = item ? item.value : null
    const mode = m.mode || (item?.mode) || '只读'

    let cssClass = ''
    const enumDesc = m.enum_desc || (item?.enum_desc) || {}
    if (enumDesc) {
      const desc = enumDesc[String(val)] || ''
      if (desc.includes('报警') || desc.includes('异常')) cssClass = 'alarm'
    }

    let displayVal = (val !== null && val !== undefined) ? formatValue(val, ident) : '--'
    if (enumDesc && enumDesc[String(val)]) {
      displayVal = enumDesc[String(val)]
      cssClass = 'alarm'
    }

    result.push({ ident, name, unit, displayVal, cssClass, mode })
  }
  return result
}

function hasData(deviceName: string): boolean {
  return !!store.latestData[deviceName] && Object.keys(store.latestData[deviceName]).length > 0
}

function getDeviceLatestTime(deviceName: string): string {
  const data = store.latestData[deviceName]
  if (!data) return '--'
  let maxTime = 0
  for (const item of Object.values(data)) {
    if (item.time && item.time > maxTime) maxTime = item.time
  }
  return maxTime ? new Date(maxTime).toLocaleTimeString('zh-CN') : '--'
}

function getProductName(deviceName: string): string {
  return deviceName
}

// ==================== SSE 状态 ====================
const sseCount = computed(() => store.sseCount)
const pushLatency = computed(() => store.pushLatency)

function resetSseCount() {
  store.sseCount = 0
}

// 推送延迟计算
const lastSseTime = ref(0)
setInterval(() => {
  if (store.lastSseTime && store.online) {
    store.pushLatency = Date.now() - store.lastSseTime
  }
}, 1000)

const lastSseTimeStr = computed(() => {
  if (!store.lastSseTime) return '--'
  return new Date(store.lastSseTime).toLocaleTimeString('zh-CN')
})

function goHistory(deviceName: string) {
  router.push({ name: 'History', query: { device: deviceName } })
}

function goThresholds() {
  router.push({ name: 'Thresholds' })
}
</script>

<template>
  <div class="realtime-page">
    <!-- SSE 状态栏 -->
    <div class="sse-status-bar">
      <span class="sse-dot" :class="{ active: store.online }"></span>
      <span class="sse-status-text">{{ store.online ? '在线 · 实时更新中' : '离线 · 尝试重连...' }}</span>
      <span class="sse-stat">在线设备: {{ allDeviceNames.length }}</span>
      <span v-if="!store.online" class="sse-stat offline-count">离线设备: {{ allDeviceNames.length }}</span>
      <span class="sse-stat">推送次数: {{ sseCount }}</span>
      <span class="sse-stat">推送延迟: {{ pushLatency }}ms</span>
      <span class="sse-time">最后推送: {{ lastSseTimeStr }}</span>
      <button class="sse-reset-btn" @click="resetSseCount" title="重置推送计数">重置计数</button>
      <button class="config-toggle-btn" @click="configVisible = !configVisible">
        {{ configVisible ? '关闭配置' : '看板配置' }}
      </button>
    </div>

    <!-- 看板配置面板 -->
    <div class="config-panel" v-if="configVisible">
      <div class="config-section">
        <h4>设备选择</h4>
        <div class="config-device-chips">
          <label
            v-for="dev in allDeviceNames"
            :key="dev"
            :class="['chip-checkbox', { checked: selectedDevices.includes(dev) }]"
          >
            <input type="checkbox" :checked="selectedDevices.includes(dev)" @change="toggleDevice(dev)" />
            {{ dev }}
          </label>
          <div v-if="allDeviceNames.length === 0" class="config-empty">暂无可用设备</div>
        </div>
      </div>

      <div class="config-section" v-if="selectedDevices.length > 0">
        <h4>快捷模板</h4>
        <div class="template-chips">
          <button
            v-for="tpl in quickTemplates"
            :key="tpl.name"
            class="template-btn"
            @click="applyTemplate(tpl)"
          >
            {{ tpl.name }}
          </button>
        </div>
      </div>

      <div class="config-section" v-if="selectedDevices.length > 0">
        <h4>单设备属性配置</h4>
        <div class="device-config-list">
          <div v-for="dev in selectedDevices" :key="dev" class="device-config-item">
            <div class="device-config-name" @click="editingDevice = editingDevice === dev ? null : dev">
              <span class="expand-arrow">{{ editingDevice === dev ? '▼' : '▶' }}</span>
              {{ dev }}
            </div>
            <div v-if="editingDevice === dev" class="device-config-props">
              <label
                v-for="prop in allPropertyIdents"
                :key="prop"
                :class="['chip-checkbox', { checked: getDeviceProperties(dev).includes(prop), disabled: !(store.devicesMeta[dev] && prop in store.devicesMeta[dev]) }]"
              >
                <input
                  type="checkbox"
                  :checked="getDeviceProperties(dev).includes(prop)"
                  :disabled="!(store.devicesMeta[dev] && prop in store.devicesMeta[dev])"
                  @change="toggleProperty(dev, prop)"
                />
                {{ propertyNameMap[prop] || prop }}
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 设备卡片网格 -->
    <div class="device-grid" :class="{ 'grid-1': selectedDevices.length === 1, 'grid-2': selectedDevices.length >= 2 }">
      <div v-for="deviceName in selectedDevices" :key="deviceName" class="card">
        <!-- 统一卡片头部 -->
        <div class="card-header">
          <div class="card-header-left">
            <h3>🌿 {{ deviceName }}</h3>
            <span class="product-tag">{{ getProductName(deviceName) }}</span>
          </div>
          <div class="card-header-actions">
            <el-button size="small" plain @click="goHistory(deviceName)">查看历史</el-button>
            <el-button size="small" plain @click="goThresholds">修改阈值</el-button>
          </div>
        </div>

        <!-- 无数据状态 -->
        <div v-if="!hasData(deviceName)" class="loading">
          <div class="spinner"></div>
          <p>等待数据...</p>
        </div>

        <!-- 传感器网格 -->
        <div v-else class="sensor-grid">
          <div
            v-for="s in getDeviceSensors(deviceName)"
            :key="s.ident"
            class="sensor-item"
            :class="s.cssClass"
          >
            <div class="label">{{ s.name }} {{ s.mode === '读写' ? '✏️' : '' }}</div>
            <div class="value">{{ s.displayVal }}</div>
            <div class="unit">{{ s.unit }}</div>
          </div>
        </div>

        <!-- 底部采集时间 -->
        <div class="card-footer" v-if="hasData(deviceName)">
          <span class="footer-label">数据采集时间</span>
          <span class="footer-time">{{ getDeviceLatestTime(deviceName) }}</span>
        </div>
      </div>

      <!-- 无设备提示 -->
      <div v-if="selectedDevices.length === 0" class="card empty-card">
        <div class="empty-hint">
          <p>请在「看板配置」中选择需要展示的设备</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.realtime-page {
  min-height: calc(100vh - 180px);
}

/* ========== SSE 状态栏 ========== */
.sse-status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-bottom: 16px;
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e0e0e0;
  font-size: 0.82rem;
  color: #546e7a;
  flex-wrap: wrap;
}

.sse-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #bdbdbd;
  transition: background 0.3s;
  flex-shrink: 0;
}

.sse-dot.active {
  background: #69f0ae;
  box-shadow: 0 0 6px #69f0ae;
}

.sse-status-text {
  font-weight: 600;
  color: #37474f;
}

.sse-stat {
  color: #78909c;
}

.offline-count {
  color: #c62828;
  font-weight: 500;
}

.sse-time {
  color: #90a4ae;
  margin-left: auto;
}

.sse-reset-btn {
  font-size: 0.75rem;
  padding: 3px 10px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #fafafa;
  color: #607d8b;
  cursor: pointer;
}

.sse-reset-btn:hover {
  background: #f0f0f0;
}

.config-toggle-btn {
  font-size: 0.75rem;
  padding: 4px 12px;
  border: 1px solid #43a047;
  border-radius: 4px;
  background: #e8f5e9;
  color: #2e7d32;
  cursor: pointer;
  font-weight: 500;
}

.config-toggle-btn:hover {
  background: #c8e6c9;
}

/* ========== 配置面板 ========== */
.config-panel {
  background: #fff;
  border: 1px solid #c8e6c9;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.config-section {
  margin-bottom: 16px;
}

.config-section:last-child {
  margin-bottom: 0;
}

.config-section h4 {
  font-size: 0.9rem;
  color: #37474f;
  margin-bottom: 10px;
  font-weight: 600;
}

.config-device-chips,
.device-config-props {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 16px;
  font-size: 0.8rem;
  color: #546e7a;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
}

.chip-checkbox input {
  display: none;
}

.chip-checkbox.checked {
  background: #e8f5e9;
  border-color: #81c784;
  color: #2e7d32;
}

.chip-checkbox.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.config-empty {
  color: #90a4ae;
  font-size: 0.85rem;
}

.template-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.template-btn {
  font-size: 0.8rem;
  padding: 5px 14px;
  border: 1px solid #90caf9;
  border-radius: 16px;
  background: #e3f2fd;
  color: #1565c0;
  cursor: pointer;
  transition: all 0.2s;
}

.template-btn:hover {
  background: #bbdefb;
}

.device-config-item {
  margin-bottom: 8px;
}

.device-config-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: #37474f;
  cursor: pointer;
  padding: 6px 0;
  user-select: none;
}

.device-config-name:hover {
  color: #1565c0;
}

.expand-arrow {
  font-size: 0.7rem;
  margin-right: 4px;
}

/* ========== 设备卡片 ========== */
.device-grid {
  display: grid;
  gap: 20px;
}

.device-grid.grid-1 {
  grid-template-columns: 1fr;
}

.device-grid.grid-2 {
  grid-template-columns: 1fr 1fr;
}

@media (max-width: 900px) {
  .device-grid.grid-2 {
    grid-template-columns: 1fr;
  }
}

.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 20px;
  border: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

/* 统一卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #e8f5e9;
  flex-wrap: wrap;
  gap: 8px;
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-header h3 {
  font-size: 1.05rem;
  color: #2e7d32;
  font-weight: 600;
  margin: 0;
}

.product-tag {
  font-size: 0.72rem;
  color: #a0a0a0;
  background: #f5f5f5;
  padding: 2px 8px;
  border-radius: 10px;
}

.card-header-actions {
  display: flex;
  gap: 6px;
}

/* 传感器网格 */
.sensor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  flex: 1;
}

.sensor-item {
  background: #fafafa;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  border: 1px solid #e8e8e8;
  transition: all 0.2s;
}

.sensor-item:hover {
  background: #f5f5f5;
  transform: translateY(-1px);
}

.sensor-item .label {
  font-size: 0.72rem;
  color: #607d8b;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sensor-item .value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #2e7d32;
  line-height: 1.2;
}

.sensor-item .unit {
  font-size: 0.78rem;
  color: #78909c;
}

.sensor-item.alarm .value {
  color: #c62828;
}

/* 卡片底部时间 */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #e0e0e0;
  font-size: 0.75rem;
}

.footer-label {
  color: #b0bec5;
}

.footer-time {
  color: #78909c;
  font-weight: 500;
}

/* 加载状态 */
.loading {
  text-align: center;
  padding: 50px 20px;
  color: #90a4ae;
}

.spinner {
  display: inline-block;
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: #2e7d32;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 空状态 */
.empty-card {
  grid-column: 1 / -1;
}

.empty-hint {
  text-align: center;
  padding: 60px 20px;
  color: #b0bec5;
  font-size: 0.9rem;
}
</style>
