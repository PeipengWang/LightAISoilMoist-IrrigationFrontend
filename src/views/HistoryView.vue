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
const MAX_PROPERTIES = 2

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

// ==================== 视图切换 ====================
type ViewMode = 'chart' | 'table'
const viewMode = ref<ViewMode>('table')

// ==================== 图表缺失数据 ====================
interface GapSegment {
  start: number
  end: number
}

// ==================== 分页 ====================
const currentPage = ref(1)
const pageSize = ref(10)
const pageSizeOptions = [10, 20, 50]

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return records.value.slice(start, start + pageSize.value)
})

const totalPages = computed(() => Math.ceil(records.value.length / pageSize.value))

function goPage(p: number) {
  if (p >= 1 && p <= totalPages.value) currentPage.value = p
}

watch([histDevice, histRange], () => { currentPage.value = 1 })

// ==================== 设备/属性选项 ====================
const deviceOptions = computed(() => {
  return Object.keys(store.devicesMeta).map(name => ({ value: name, label: name }))
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
  for (const p of propertyOptions.value) map[p.value] = p.label
  return map
})

const propertyUnitMap = computed(() => {
  const map: Record<string, string> = {}
  for (const p of propertyOptions.value) map[p.value] = p.unit
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

watch(histDevice, () => { onDeviceChange() })

function onPropertiesChange(vals: string[]) {
  if (vals.length > MAX_PROPERTIES) {
    histProperties.value = vals.slice(0, MAX_PROPERTIES)
  }
}

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
const chartColors = ['#2e7d32', '#1565c0']

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

  const errors = results.filter(r => r.error)
  if (errors.length > 0 && results.every(r => r.error)) {
    queryError.value = errors[0].error
    loading.value = false
    queryDone.value = true
    return
  }

  // 按时间点聚合
  const timeMap = new Map<string, Record<string, number>>()
  for (const r of results) {
    for (const item of r.list) {
      const t = item.time
      if (!timeMap.has(t)) timeMap.set(t, {})
      timeMap.get(t)![r.prop] = parseFloat(item.value)
    }
  }

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

  const rangeLabel = rangeOptions.find(r => r.value === histRange.value)?.label || '自定义'
  const propNames = histProperties.value.map(p => propertyNameMap.value[p] || p).join(' + ')
  summaryTitle.value = `【${deviceOptions.value.find(d => d.value === histDevice.value)?.label || histDevice.value}】${propNames} - ${rangeLabel}`

  loading.value = false
  queryDone.value = true
  viewMode.value = 'chart'

  await nextTick()
  await nextTick()
  renderChart()
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function detectGaps(prop: string): GapSegment[] {
  const gaps: GapSegment[] = []
  const MAX_GAP_COUNT = 20
  for (let i = 1; i < records.value.length; i++) {
    const prev = records.value[i - 1].values[prop]
    const curr = records.value[i].values[prop]
    if ((prev === undefined || isNaN(prev)) !== (curr === undefined || isNaN(curr))) {
      if (gaps.length === 0 || gaps[gaps.length - 1].end !== i - 1) {
        gaps.push({ start: i - 1, end: i })
      } else {
        gaps[gaps.length - 1].end = i
      }
    }
  }
  return gaps.filter(g => g.end - g.start <= MAX_GAP_COUNT)
}

// ==================== 图表渲染 ====================
function renderChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null }
  if (!chartCanvas.value || records.value.length === 0) return

  const labels = records.value.map(r => r.timeStr)
  const isMulti = histProperties.value.length > 1

  // 自适应时间刻度
  const totalMs = records.value.length > 1
    ? new Date(records.value[records.value.length - 1].timeStr).getTime() - new Date(records.value[0].timeStr).getTime()
    : 0
  let maxTicks = 15
  if (totalMs <= 3600000) maxTicks = 12
  else if (totalMs <= 86400000) maxTicks = 24
  else if (totalMs <= 604800000) maxTicks = 7
  else maxTicks = 12

  const xTickCallback = (() => {
    if (totalMs <= 86400000) {
      return (val: string | number, index: number) => {
        const label = labels[index]
        return label ? label.slice(11, 16) : ''
      }
    }
    if (totalMs <= 604800000) {
      return (val: string | number, index: number) => {
        const label = labels[index]
        return label ? label.slice(5, 10) : ''
      }
    }
    return undefined
  })()

  // 为每个属性计算值域范围
  const propRanges = histProperties.value.map(prop => {
    const vals = records.value.map(r => r.values[prop]).filter(v => v !== undefined && !isNaN(v)) as number[]
    if (vals.length === 0) return { min: 0, max: 10 }
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const padding = (max - min) * 0.1 || 1
    return { min: min - padding, max: max + padding }
  })

  // 构建数据集：处理缺失值用虚线连接
  const datasets: any[] = []
  for (let i = 0; i < histProperties.value.length; i++) {
    const prop = histProperties.value[i]
    const color = chartColors[i]
    const rawData = records.value.map(r => r.values[prop])

    // 找出连续的有效段
    const segments: { data: (number | null)[]; borderDash?: number[]; label: string; yAxisID: string }[] = []
    let currentSeg: (number | null)[] = []
    let hasGap = false

    for (let j = 0; j < rawData.length; j++) {
      const v = rawData[j]
      if (v !== undefined && !isNaN(v)) {
        currentSeg.push(v)
      } else {
        if (currentSeg.length > 0) {
          segments.push({
            data: currentSeg,
            borderDash: undefined,
            label: `${propertyNameMap.value[prop] || prop} (${propertyUnitMap.value[prop] || ''})`,
            yAxisID: isMulti ? `y-${i}` : 'y',
          })
          currentSeg = []
          hasGap = true
        }
        currentSeg.push(null) // NaN equivalent for gap
      }
    }
    if (currentSeg.length > 0) {
      segments.push({
        data: currentSeg,
        borderDash: undefined,
        label: hasGap ? '' : `${propertyNameMap.value[prop] || prop} (${propertyUnitMap.value[prop] || ''})`,
        yAxisID: isMulti ? `y-${i}` : 'y',
      })
    }

    // 使用 spanGaps 处理缺失值
    datasets.push({
      label: `${propertyNameMap.value[prop] || prop} (${propertyUnitMap.value[prop] || ''})`,
      data: rawData.map(v => (v !== undefined && !isNaN(v) ? v : null)),
      borderColor: color,
      backgroundColor: isMulti ? 'transparent' : `${color}15`,
      fill: !isMulti,
      tension: 0.3,
      pointRadius: records.value.length > 200 ? 0 : 2,
      pointHoverRadius: 5,
      borderWidth: 2,
      spanGaps: false,
      segment: {
        borderDash: (ctx: any) => {
          // 如果前后点之间有null的跳变，说明是缺失数据区间，用虚线
          const prev = ctx.p0 ? rawData[ctx.p0DataIndex] : undefined
          const curr = ctx.p1 ? rawData[ctx.p1DataIndex] : undefined
          if (prev === undefined || curr === undefined || isNaN(prev) || isNaN(curr)) return undefined
          // Check if there's a gap between p0DataIndex and p1DataIndex
          for (let k = ctx.p0DataIndex + 1; k < ctx.p1DataIndex; k++) {
            const mv = rawData[k]
            if (mv === undefined || isNaN(mv)) return [5, 3]
          }
          return undefined
        },
        borderColor: (ctx: any) => {
          if (ctx.p1 && ctx.p1.parsed && ctx.p1.parsed.y !== undefined) return color
          for (let k = ctx.p0DataIndex + 1; k < ctx.p1DataIndex; k++) {
            const mv = rawData[k]
            if (mv === undefined || isNaN(mv)) return '#bdbdbd'
          }
          return color
        },
      },
      yAxisID: isMulti ? `y-${i}` : 'y',
    })
  }

  // Y轴配置
  const scalesConfig: any = {}

  if (isMulti) {
    // 左侧Y轴 - 第一个属性
    scalesConfig['y-0'] = {
      type: 'linear',
      position: 'left',
      title: {
        display: true,
        text: `${propertyUnitMap.value[histProperties.value[0]] || ''}`,
        color: chartColors[0],
      },
      ticks: { font: { size: 10 }, color: chartColors[0] },
      grid: { display: true },
      min: propRanges[0].min,
      max: propRanges[0].max,
    }
    // 右侧Y轴 - 第二个属性
    scalesConfig['y-1'] = {
      type: 'linear',
      position: 'right',
      title: {
        display: true,
        text: `${propertyUnitMap.value[histProperties.value[1]] || ''}`,
        color: chartColors[1],
      },
      ticks: { font: { size: 10 }, color: chartColors[1] },
      grid: { display: false },
      min: propRanges[1].min,
      max: propRanges[1].max,
    }
  } else {
    scalesConfig['y'] = {
      type: 'linear',
      title: {
        display: true,
        text: `${propertyUnitMap.value[histProperties.value[0]] || ''}`,
      },
      ticks: { font: { size: 10 } },
      min: propRanges[0].min,
      max: propRanges[0].max,
    }
  }

  // X轴配置
  const xConfig: any = {
    ticks: { maxTicksLimit: maxTicks, font: { size: 10 }, autoSkip: true, maxRotation: 45 },
    grid: { display: false },
  }
  if (xTickCallback) {
    xConfig.ticks.callback = xTickCallback
  }
  scalesConfig['x'] = xConfig

  chartInstance = new Chart(chartCanvas.value, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            boxWidth: 20,
            padding: 15,
            font: { size: 12 },
            filter: (item: any) => item.text !== '',
          },
        },
        tooltip: {
          enabled: true,
          callbacks: {
            title: (items) => {
              return `采集时间：${items[0]?.label || ''}`
            },
            label: (item) => {
              const val = item.raw as number | null
              if (val === null) return `${item.dataset.label}: 无采集数据`
              return `${item.dataset.label}: ${val.toFixed(2)}`
            },
          },
        },
      },
      scales: scalesConfig,
    },
  })
}

// 切换到图表视图时重新渲染
watch(viewMode, async (mode) => {
  if (mode === 'chart' && records.value.length > 0) {
    await nextTick()
    await nextTick()
    renderChart()
  }
})

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

// ==================== 导出 ====================
function exportCSV() {
  if (records.value.length === 0) return
  const props = histProperties.value
  let csv = '﻿时间,' + props.map(p => propertyNameMap.value[p] || p).join(',') + '\n'
  for (const r of records.value) {
    const vals = props.map(p => r.values[p] !== undefined && !isNaN(r.values[p]) ? r.values[p] : '--')
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

onUnmounted(() => {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null }
})
</script>

<template>
  <div class="history-page">
    <!-- 筛选栏 -->
    <div class="card filter-card">
      <div class="card-header">
        <h3>📊 历史数据分析</h3>
      </div>

      <div class="filter-row">
        <div class="filter-item">
          <label>设备</label>
          <el-select v-model="histDevice" size="small" style="width:180px">
            <el-option v-for="d in deviceOptions" :key="d.value" :label="d.label" :value="d.value" />
          </el-select>
        </div>

        <div class="filter-item">
          <label>属性（最多{{ MAX_PROPERTIES }}个）</label>
          <el-select
            v-model="histProperties"
            size="small"
            multiple
            :multiple-limit="MAX_PROPERTIES"
            style="width:280px"
            placeholder="选择监测属性"
            @change="onPropertiesChange"
          >
            <el-option v-for="p in propertyOptions" :key="p.value" :label="`${p.label} (${p.unit})`" :value="p.value" />
          </el-select>
        </div>

        <div class="filter-item">
          <label>时间范围</label>
          <el-select v-model="histRange" size="small" style="width:130px" @change="onRangeChange">
            <el-option v-for="r in rangeOptions" :key="r.value" :label="r.label" :value="r.value" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </div>

        <template v-if="isCustomRange">
          <div class="filter-item">
            <label>开始时间</label>
            <el-date-picker v-model="customStart" type="datetime" size="small" placeholder="开始时间" style="width:180px" format="YYYY-MM-DD HH:mm" />
          </div>
          <div class="filter-item">
            <label>结束时间</label>
            <el-date-picker v-model="customEnd" type="datetime" size="small" placeholder="结束时间" style="width:180px" format="YYYY-MM-DD HH:mm" />
          </div>
        </template>

        <div class="filter-item filter-actions">
          <label>&nbsp;</label>
          <div class="filter-btns">
            <el-button size="small" type="primary" @click="queryHistory" :loading="loading">
              <span class="btn-icon">🔍</span> 查询
            </el-button>
            <el-button size="small" @click="resetFilters">
              <span class="btn-icon">🔄</span> 重置
            </el-button>
          </div>
        </div>
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

    <!-- 图表/表格 同一卡片，Tab切换 -->
    <div class="card view-card">
      <div class="card-header">
        <div class="tab-bar">
          <div
            :class="['tab-item', { active: viewMode === 'table' }]"
            @click="viewMode = 'table'"
          >
            📋 数据明细
          </div>
          <div
            :class="['tab-item', { active: viewMode === 'chart' }]"
            @click="viewMode = 'chart'"
          >
            📈 趋势折线图
          </div>
        </div>
        <el-button v-if="viewMode === 'table' && records.length > 0" size="small" plain @click="exportCSV">导出 CSV</el-button>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="view-placeholder">
        <div class="spinner"></div>
        <p>数据加载中...</p>
      </div>

      <!-- 错误 -->
      <div v-else-if="queryError" class="view-placeholder error">
        <p>⚠️ {{ queryError }}</p>
      </div>

      <!-- 尚无查询 -->
      <div v-else-if="!queryDone" class="view-placeholder">
        <p>📊 请选择设备、属性并点击查询按钮，查看历史数据</p>
      </div>

      <!-- 无数据 -->
      <div v-else-if="records.length === 0" class="view-placeholder">
        <p>📭 当前设备该时间段无采集数据，请更换筛选条件</p>
      </div>

      <!-- 图表视图 -->
      <div v-show="viewMode === 'chart' && queryDone && records.length > 0" class="chart-container">
        <canvas ref="chartCanvas"></canvas>
      </div>

      <!-- 表格视图 -->
      <div v-show="viewMode === 'table' && (queryDone || records.length > 0)">
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
                  <span
                    v-if="r.values[prop] !== undefined && !isNaN(r.values[prop])"
                  >{{ r.values[prop].toFixed(1) }}</span>
                  <span
                    v-else
                    class="missing-cell"
                    title="该时刻传感器未上报采集数据（设备离线/信号异常）"
                  >--</span>
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
  gap: 14px;
  flex-wrap: wrap;
  align-items: flex-end;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.filter-item label {
  font-size: 0.78rem;
  color: #607d8b;
  white-space: nowrap;
}

.filter-actions {
  align-self: flex-end;
}

.filter-btns {
  display: flex;
  gap: 8px;
}

.btn-icon {
  font-style: normal;
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
  min-width: 180px;
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
  gap: 14px;
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

/* ========== 视图卡片 ========== */
.view-card {
  margin-bottom: 0;
}

.tab-bar {
  display: flex;
  gap: 0;
}

.tab-item {
  padding: 7px 20px;
  font-size: 0.88rem;
  color: #78909c;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  user-select: none;
}

.tab-item:hover {
  color: #37474f;
}

.tab-item.active {
  color: #2e7d32;
  border-bottom-color: #2e7d32;
  font-weight: 600;
}

/* ========== 图表 ========== */
.chart-container {
  position: relative;
  height: 420px;
}

.chart-container canvas {
  width: 100% !important;
  height: 100% !important;
}

.view-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 340px;
  color: #90a4ae;
  font-size: 0.9rem;
}

.view-placeholder.error {
  color: #c62828;
}

/* ========== 表格 ========== */
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

.missing-cell {
  color: #bdbdbd;
  cursor: help;
  text-decoration: underline dotted;
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
  min-width: 70px;
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

/* ========== 响应式 ========== */
@media (max-width: 900px) {
  .filter-row {
    gap: 10px;
  }
  .filter-item {
    flex: 1 1 100%;
    min-width: 0;
  }
  .stats-row {
    flex-direction: column;
  }
  .pagination-bar {
    flex-direction: column;
    align-items: flex-start;
  }
  .chart-container {
    height: 300px;
  }
}
</style>
