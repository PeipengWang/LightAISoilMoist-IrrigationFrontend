<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useDeviceStore } from '../stores/devices'
import { fetchHistory } from '../api'
import Chart from 'chart.js/auto'

const store = useDeviceStore()

// ==================== 筛选条件 ====================
const histDevice = ref('DHT11')
const histProperties = ref<string[]>([])
const histRange = ref('24h')
const customStart = ref('')
const customEnd = ref('')

const loading = ref(false)
const chartCanvas = ref<HTMLCanvasElement | null>(null)
let chartInstance: Chart | null = null

// ==================== 查询结果 ====================
interface HistoryRecord {
  time: string
  timeStr: string
  values: Record<string, number>
}
const records = ref<HistoryRecord[]>([])
const totalCount = ref(0)
const queryDone = ref(false)
const queryError = ref('')
const showChart = ref(true)
const showTable = ref(true)

// ==================== 分页 ====================
const currentPage = ref(1)
const pageSize = ref(20)
const pageSizeOptions = [10, 20, 50]

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return records.value.slice(start, start + pageSize.value)
})

const totalPages = computed(() => Math.ceil(records.value.length / pageSize.value))

function goPage(p: number) {
  if (p >= 1 && p <= totalPages.value) {
    currentPage.value = p
  }
}

watch([histDevice, histRange], () => {
  currentPage.value = 1
})

// ==================== 设备/属性选项 ====================
const deviceOptions = computed(() => {
  return Object.keys(store.devicesMeta).map(name => ({
    value: name,
    label: name,
  }))
})

const propertyOptions = computed(() => {
  const meta = store.devicesMeta[histDevice.value] || {}
  return Object.entries(meta).map(([ident, prop]) => ({
    value: ident,
    label: prop.name || ident,
    unit: prop.unit || '',
  }))
})

const propertyNameMap = computed(() => {
  const map: Record<string, string> = {}
  for (const p of propertyOptions.value) {
    map[p.value] = p.label
  }
  return map
})

const propertyUnitMap = computed(() => {
  const map: Record<string, string> = {}
  for (const p of propertyOptions.value) {
    map[p.value] = p.unit
  }
  return map
})

function onDeviceChange() {
  histProperties.value = []
  if (propertyOptions.value.length > 0) {
    histProperties.value = [propertyOptions.value[0].value]
  }
}

watch(() => store.devicesMeta, () => {
  if (Object.keys(store.devicesMeta).length > 0 && !histDevice.value) {
    const names = Object.keys(store.devicesMeta)
    histDevice.value = names[0]
    onDeviceChange()
  }
}, { immediate: true })

watch(histDevice, () => {
  onDeviceChange()
})

// ==================== 时间范围 ====================
const rangeOptions = [
  { value: '1h', label: '近1小时' },
  { value: '6h', label: '近6小时' },
  { value: '24h', label: '近24小时' },
  { value: '3d', label: '近3天' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
]

const isCustomRange = computed(() => histRange.value === 'custom')

function onRangeChange() {
  if (histRange.value !== 'custom') {
    customStart.value = ''
    customEnd.value = ''
  }
}

function getTimeRange(): [number, number] {
  if (histRange.value === 'custom') {
    const s = customStart.value ? new Date(customStart.value).getTime() : Date.now() - 86400000
    const e = customEnd.value ? new Date(customEnd.value).getTime() : Date.now()
    return [s, e]
  }
  const end = Date.now()
  const rangeMap: Record<string, number> = {
    '1h': 3600000, '6h': 21600000, '24h': 86400000, '3d': 259200000, '7d': 604800000, '30d': 2592000000,
  }
  return [end - (rangeMap[histRange.value] || 86400000), end]
}

// ==================== 图表颜色 ====================
const chartColors = [
  '#2e7d32', '#1565c0', '#e65100', '#7b1fa2', '#c62828', '#00838f', '#f9a825', '#4e342e',
]

// ==================== 查询历史 ====================
const statsCards = ref<{ prop: string; name: string; max: number; min: number; avg: number }[]>([])
const summaryTitle = ref('')

async function queryHistory() {
  if (histProperties.value.length === 0) return

  loading.value = true
  queryDone.value = false
  queryError.value = ''
  records.value = []
  statsCards.value = []
  totalCount.value = 0

  const [start, end] = getTimeRange()

  // 并发请求所有选中属性
  const results = await Promise.all(
    histProperties.value.map(async (prop) => {
      try {
        const json = await fetchHistory(histDevice.value, prop, start, end, 200)
        if (json.error) return { prop, error: json.error, list: [] as { time: string; value: string }[] }
        return { prop, error: '', list: json.data?.data?.list || [] }
      } catch (err: unknown) {
        return { prop, error: (err as Error).message, list: [] as { time: string; value: string }[] }
      }
    })
  )

  // 检查是否有错误
  const errors = results.filter(r => r.error)
  if (errors.length > 0 && results.every(r => r.error)) {
    queryError.value = errors[0].error
    loading.value = false
    queryDone.value = true
    return
  }

  // 合并数据：按时间点聚合
  const timeMap = new Map<string, Record<string, number>>()
  for (const r of results) {
    for (const item of r.list) {
      const t = item.time
      if (!timeMap.has(t)) timeMap.set(t, {})
      timeMap.get(t)![r.prop] = parseFloat(item.value)
    }
  }

  // 排序并转为数组
  const sorted = Array.from(timeMap.entries())
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))

  records.value = sorted.map(([time, vals]) => ({
    time,
    timeStr: formatTime(parseInt(time)),
    values: vals,
  }))
  totalCount.value = records.value.length
  currentPage.value = 1

  // 统计卡片
  statsCards.value = histProperties.value.map(prop => {
    const vals = sorted.map(([, v]) => v[prop]).filter(v => v !== undefined && !isNaN(v))
    if (vals.length === 0) return { prop, name: propertyNameMap.value[prop] || prop, max: 0, min: 0, avg: 0 }
    return {
      prop,
      name: propertyNameMap.value[prop] || prop,
      max: Math.max(...vals),
      min: Math.min(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    }
  })

  // 汇总标题
  const rangeLabel = rangeOptions.find(r => r.value === histRange.value)?.label || '自定义'
  const propNames = histProperties.value.map(p => propertyNameMap.value[p] || p).join('+')
  summaryTitle.value = `【${deviceOptions.value.find(d => d.value === histDevice.value)?.label || histDevice.value}】${propNames} - ${rangeLabel}`

  loading.value = false
  queryDone.value = true

  // 渲染图表（先 loading=false 让 canvas 出现在 DOM 中）
  await nextTick()
  renderChart()
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ==================== 图表渲染 ====================
function renderChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null }
  if (!chartCanvas.value || records.value.length === 0) return

  const labels = records.value.map(r => r.timeStr)
  const isMulti = histProperties.value.length > 1

  const datasets = histProperties.value.map((prop, i) => {
    const data = records.value.map(r => r.values[prop] ?? NaN)
    return {
      label: `${propertyNameMap.value[prop] || prop} (${propertyUnitMap.value[prop] || ''})`,
      data,
      borderColor: chartColors[i % chartColors.length],
      backgroundColor: isMulti ? 'transparent' : `${chartColors[i % chartColors.length]}15`,
      fill: !isMulti,
      tension: 0.3,
      pointRadius: records.value.length > 200 ? 0 : 2,
      pointHoverRadius: 5,
      borderWidth: 2,
    }
  })

  // 自适应时间刻度
  const totalMs = records.value.length > 1
    ? new Date(records.value[records.value.length - 1].timeStr).getTime() - new Date(records.value[0].timeStr).getTime()
    : 0
  let maxTicks = 15
  if (totalMs <= 3600000) maxTicks = 12       // ≤1h: 按5分钟
  else if (totalMs <= 86400000) maxTicks = 24  // ≤1d: 按小时
  else if (totalMs <= 604800000) maxTicks = 7  // ≤7d: 按天
  else maxTicks = 15                            // >7d: 自动

  chartInstance = new Chart(chartCanvas.value, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 20, padding: 15, font: { size: 12 } } },
        tooltip: {
          enabled: true,
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (item) => {
              const val = item.raw as number
              return `${item.dataset.label}: ${isNaN(val) ? '无数据' : val.toFixed(2)}`
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: maxTicks, font: { size: 10 }, autoSkip: true },
          grid: { display: false },
        },
        y: {
          ticks: { font: { size: 10 } },
        },
      },
    },
  })
}

function resetFilters() {
  histRange.value = '24h'
  customStart.value = ''
  customEnd.value = ''
  currentPage.value = 1
  if (histProperties.value.length === 0 && propertyOptions.value.length > 0) {
    histProperties.value = [propertyOptions.value[0].value]
  }
  queryHistory()
}

function refreshLatest() {
  store.refreshLatest()
}

// ==================== 导出 ====================
function exportCSV() {
  if (records.value.length === 0) return
  const props = histProperties.value
  let csv = '﻿时间,' + props.map(p => propertyNameMap.value[p] || p).join(',') + '\n'
  for (const r of records.value) {
    const vals = props.map(p => r.values[p] ?? '')
    csv += `${r.timeStr},${vals.join(',')}\n`
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `history_${histDevice.value}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ==================== 生命周期 ====================
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>

<template>
  <div class="history-page">
    <!-- 筛选栏 -->
    <div class="card filter-card">
      <div class="card-header">
        <h3>📊 历史数据分析</h3>
        <div class="header-actions">
          <el-button size="small" @click="resetFilters">重置筛选条件</el-button>
          <el-button size="small" plain @click="queryHistory" :loading="loading">查询</el-button>
        </div>
      </div>

      <div class="filter-row">
        <div class="filter-item">
          <label>设备</label>
          <el-select v-model="histDevice" size="small" style="width:200px">
            <el-option v-for="d in deviceOptions" :key="d.value" :label="d.label" :value="d.value" />
          </el-select>
        </div>

        <div class="filter-item">
          <label>属性（可多选）</label>
          <el-select v-model="histProperties" size="small" multiple style="width:320px" placeholder="选择监测属性">
            <el-option v-for="p in propertyOptions" :key="p.value" :label="`${p.label} (${p.unit})`" :value="p.value" />
          </el-select>
        </div>

        <div class="filter-item">
          <label>时间范围</label>
          <el-select v-model="histRange" size="small" style="width:140px" @change="onRangeChange">
            <el-option v-for="r in rangeOptions" :key="r.value" :label="r.label" :value="r.value" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </div>

        <template v-if="isCustomRange">
          <div class="filter-item">
            <label>开始时间</label>
            <el-date-picker v-model="customStart" type="datetime" size="small" placeholder="选择开始时间" style="width:190px" format="YYYY-MM-DD HH:mm" />
          </div>
          <div class="filter-item">
            <label>结束时间</label>
            <el-date-picker v-model="customEnd" type="datetime" size="small" placeholder="选择结束时间" style="width:190px" format="YYYY-MM-DD HH:mm" />
          </div>
        </template>
      </div>
    </div>

    <!-- 汇总标题 -->
    <div class="summary-bar" v-if="queryDone && records.length > 0">
      <span class="summary-title">{{ summaryTitle }}</span>
      <span class="summary-count">共 {{ totalCount }} 条记录</span>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row" v-if="statsCards.length > 0">
      <div v-for="s in statsCards" :key="s.prop" class="stat-card">
        <div class="stat-name">{{ s.name }}</div>
        <div class="stat-values">
          <span class="stat-item max">最高 <strong>{{ s.max.toFixed(1) }}</strong></span>
          <span class="stat-item min">最低 <strong>{{ s.min.toFixed(1) }}</strong></span>
          <span class="stat-item avg">平均 <strong>{{ s.avg.toFixed(1) }}</strong></span>
        </div>
      </div>
    </div>

    <!-- 图表区域 -->
    <div class="card chart-card" v-if="queryDone || loading">
      <div class="card-header">
        <h4>📈 趋势折线图</h4>
        <el-switch v-if="records.length > 0" v-model="showChart" size="small" active-text="显示" inactive-text="隐藏" />
      </div>

      <div v-if="loading" class="chart-placeholder">
        <div class="spinner"></div>
        <p>数据加载中...</p>
      </div>
      <div v-else-if="queryError" class="chart-placeholder error">
        <p>⚠️ {{ queryError }}</p>
      </div>
      <div v-else-if="records.length === 0" class="chart-placeholder">
        <p>📭 当前设备该时间段无采集数据，请更换筛选条件</p>
      </div>
      <div v-show="showChart && records.length > 0" class="chart-container">
        <canvas ref="chartCanvas"></canvas>
      </div>
    </div>

    <!-- 明细表格 -->
    <div class="card table-card" v-if="records.length > 0">
      <div class="card-header">
        <h4>📋 数据明细</h4>
        <div class="header-actions">
          <el-switch v-model="showTable" size="small" active-text="显示" inactive-text="隐藏" />
          <el-button size="small" plain @click="exportCSV">导出 CSV</el-button>
        </div>
      </div>

      <div v-show="showTable">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th v-for="prop in histProperties" :key="prop">
                  {{ propertyNameMap[prop] || prop }} ({{ propertyUnitMap[prop] || '' }})
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="paginatedRecords.length === 0">
                <td :colspan="histProperties.length + 1" class="empty-cell">暂无数据</td>
              </tr>
              <tr v-for="(r, i) in paginatedRecords" :key="i">
                <td class="time-cell">{{ r.timeStr }}</td>
                <td v-for="prop in histProperties" :key="prop" class="value-cell">
                  {{ r.values[prop] !== undefined ? r.values[prop].toFixed(1) : '--' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页 -->
        <div class="pagination-bar">
          <div class="page-info">
            共 {{ totalCount }} 条，每页
            <el-select v-model="pageSize" size="small" style="width:80px">
              <el-option v-for="s in pageSizeOptions" :key="s" :label="String(s)" :value="s" />
            </el-select>
            条
          </div>
          <div class="page-controls">
            <el-button size="small" :disabled="currentPage <= 1" @click="goPage(1)">首页</el-button>
            <el-button size="small" :disabled="currentPage <= 1" @click="goPage(currentPage - 1)">上一页</el-button>
            <span class="page-num">{{ currentPage }} / {{ totalPages }}</span>
            <el-button size="small" :disabled="currentPage >= totalPages" @click="goPage(currentPage + 1)">下一页</el-button>
            <el-button size="small" :disabled="currentPage >= totalPages" @click="goPage(totalPages)">末页</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-page {
  min-height: calc(100vh - 180px);
}

/* ========== 卡片基础 ========== */
.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 20px;
  border: 1px solid #e0e0e0;
  margin-bottom: 16px;
}

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

.card-header h3 {
  font-size: 1.05rem;
  color: #2e7d32;
  font-weight: 600;
  margin: 0;
}

.card-header h4 {
  font-size: 0.95rem;
  color: #37474f;
  font-weight: 600;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 6px;
}

/* ========== 筛选栏 ========== */
.filter-card {
  margin-bottom: 12px;
}

.filter-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: flex-end;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-item label {
  font-size: 0.78rem;
  color: #607d8b;
}

/* ========== 汇总标题 ========== */
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: #e8f5e9;
  border-radius: 8px;
}

.summary-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #2e7d32;
}

.summary-count {
  font-size: 0.8rem;
  color: #607d8b;
}

/* ========== 统计卡片 ========== */
.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 200px;
  background: #fff;
  border-radius: 10px;
  padding: 14px 16px;
  border: 1px solid #e0e0e0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.stat-name {
  font-size: 0.8rem;
  color: #607d8b;
  margin-bottom: 8px;
  font-weight: 500;
}

.stat-values {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.stat-item {
  font-size: 0.82rem;
  color: #546e7a;
}

.stat-item strong {
  margin-left: 2px;
}

.stat-item.max strong { color: #c62828; }
.stat-item.min strong { color: #1565c0; }
.stat-item.avg strong { color: #2e7d32; }

/* ========== 图表 ========== */
.chart-card {
  min-height: 200px;
}

.chart-container {
  position: relative;
  height: 380px;
}

.chart-container canvas {
  width: 100% !important;
  height: 100% !important;
}

.chart-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #90a4ae;
  font-size: 0.9rem;
}

.chart-placeholder.error {
  color: #c62828;
}

/* ========== 表格 ========== */
.table-card {
  margin-bottom: 0;
}

.table-wrapper {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

th {
  background: #e8f5e9;
  color: #2e7d32;
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
}

td {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.time-cell {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 0.8rem;
  color: #37474f;
  white-space: nowrap;
}

.value-cell {
  font-family: 'Consolas', 'Courier New', monospace;
  font-weight: 500;
  color: #263238;
}

.empty-cell {
  text-align: center;
  color: #b0bec5;
  padding: 30px !important;
}

/* ========== 分页 ========== */
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
  flex-wrap: wrap;
  gap: 10px;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: #607d8b;
}

.page-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.page-num {
  font-size: 0.85rem;
  color: #37474f;
  font-weight: 500;
  min-width: 80px;
  text-align: center;
}

/* ========== 加载spinner ========== */
.spinner {
  display: inline-block;
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: #2e7d32;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .filter-row {
    flex-direction: column;
    gap: 10px;
  }
  .filter-item {
    width: 100%;
  }
  .stats-row {
    flex-direction: column;
  }
  .pagination-bar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
