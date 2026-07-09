<script setup lang="ts">
import { ref, onUnmounted, nextTick, watch } from 'vue'
import { useDeviceStore } from '../stores/devices'
import { fetchHistory } from '../api'
import Chart from 'chart.js/auto'

const store = useDeviceStore()

const histDevice = ref('DHT11')
const histProperty = ref('')
const histRange = ref('24h')

const chartCanvas = ref<HTMLCanvasElement | null>(null)
let chartInstance: Chart | null = null

const historyTableHtml = ref('')
const loading = ref(false)

const deviceOptions = [
  { value: 'DHT11', label: '土壤温湿度 (DHT11)' },
  { value: 'device', label: '多要素环境监测 (device)' },
]

const rangeOptions = [
  { value: '1h', label: '最近1小时' },
  { value: '6h', label: '最近6小时' },
  { value: '24h', label: '最近24小时' },
  { value: '3d', label: '最近3天' },
  { value: '7d', label: '最近7天' },
]

const propertyOptions = ref<{ value: string; label: string }[]>([])

function onDeviceChange() {
  const meta = store.devicesMeta[histDevice.value] || {}
  propertyOptions.value = Object.entries(meta).map(([ident, prop]) => ({
    value: ident,
    label: `${ident} — ${prop.name} (${prop.unit || '无单位'})`,
  }))
  if (propertyOptions.value.length > 0) {
    histProperty.value = propertyOptions.value[0].value
  }
}

async function queryHistory() {
  if (!histProperty.value) return

  loading.value = true
  historyTableHtml.value = '<div class="loading"><div class="spinner"></div><p>查询中...</p></div>'

  const end = Date.now()
  const rangeMap: Record<string, number> = {
    '1h': 3600000, '6h': 21600000, '24h': 86400000, '3d': 259200000, '7d': 604800000,
  }
  const start = end - (rangeMap[histRange.value] || 86400000)

  try {
    const json = await fetchHistory(histDevice.value, histProperty.value, start, end, 100)

    if (json.error) {
      historyTableHtml.value = `<p style="color:red;">错误: ${json.error}</p>`
      loading.value = false
      return
    }

    const records = (json.data?.data?.list) || []
    const propName = json.property_name || histProperty.value
    const unit = json.unit || ''

    if (records.length === 0) {
      historyTableHtml.value = '<p>该时间段内无数据</p>'
      if (chartInstance) { chartInstance.destroy(); chartInstance = null }
      loading.value = false
      return
    }

    const labels = records.map(r => new Date(parseInt(r.time)).toLocaleString('zh-CN')).reverse()
    const values = records.map(r => parseFloat(r.value)).reverse()

    await nextTick()
    if (chartCanvas.value) {
      if (chartInstance) chartInstance.destroy()
      chartInstance = new Chart(chartCanvas.value, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: `${propName} ${unit}`,
            data: values,
            borderColor: '#2e7d32',
            backgroundColor: 'rgba(46,125,50,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, position: 'top' } },
          scales: {
            x: { ticks: { maxTicksLimit: 15, font: { size: 11 } } },
            y: { ticks: { font: { size: 11 } }, title: { display: true, text: unit } },
          },
        },
      })
    }

    const tableRecords = records.slice(0, 20)
    let html = `<p style="margin-top:12px;font-size:0.85rem;color:#607d8b;">共 ${records.length} 条记录，显示最近 ${tableRecords.length} 条:</p>`
    html += `<table><tr><th>时间</th><th>${propName} ${unit}</th></tr>`
    for (const r of tableRecords) {
      const t = new Date(parseInt(r.time)).toLocaleString('zh-CN')
      html += `<tr><td>${t}</td><td>${r.value} ${unit}</td></tr>`
    }
    html += '</table>'
    historyTableHtml.value = html
  } catch (err: unknown) {
    historyTableHtml.value = `<p style="color:red;">请求失败: ${(err as Error).message}</p>`
  } finally {
    loading.value = false
  }
}

function refreshLatest() {
  store.refreshLatest()
}

// 切换到历史 tab 时重绘图表
defineExpose({ resizeChart: () => chartInstance?.resize() })

watch(() => store.devicesMeta, () => {
  if (Object.keys(store.devicesMeta).length > 0) {
    onDeviceChange()
  }
}, { immediate: true })

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>

<template>
  <div class="grid-1">
    <div class="card">
      <div class="card-header">
        <h3>📊 历史数据分析</h3>
      </div>
      <div class="controls">
        <label>设备
          <select v-model="histDevice" @change="onDeviceChange()">
            <option v-for="d in deviceOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <label>属性
          <select v-model="histProperty">
            <option v-for="p in propertyOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </label>
        <label>时间范围
          <select v-model="histRange">
            <option v-for="r in rangeOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </label>
        <button class="btn btn-primary" @click="queryHistory()">🔍 查询</button>
        <button class="btn btn-outline" @click="refreshLatest()">🔄 刷新实时数据</button>
      </div>
      <div class="chart-container">
        <canvas ref="chartCanvas"></canvas>
      </div>
      <div v-html="historyTableHtml"></div>
    </div>
  </div>
</template>

<style scoped>
.grid-1 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 20px;
  border: 1px solid #e0e0e0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #e8f5e9;
}

.card-header h3 {
  font-size: 1.05rem;
  color: #2e7d32;
  font-weight: 600;
}

.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 16px;
}

.controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #607d8b;
}

.controls select,
.controls input {
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 0.9rem;
  background: #fafafa;
  min-width: 140px;
}

.btn {
  padding: 9px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: #2e7d32;
  color: #fff;
}

.btn-primary:hover {
  background: #1b5e20;
}

.btn-outline {
  background: #fff;
  color: #2e7d32;
  border: 1px solid #2e7d32;
}

.btn-outline:hover {
  background: #e8f5e9;
}

.chart-container {
  position: relative;
  height: 350px;
}

.chart-container canvas {
  width: 100% !important;
  height: 100% !important;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #607d8b;
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
  to {
    transform: rotate(360deg);
  }
}

:deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

:deep(th) {
  background: #e8f5e9;
  color: #2e7d32;
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
}

:deep(td) {
  padding: 8px 12px;
  border-bottom: 1px solid #e0e0e0;
}

:deep(tr:hover td) {
  background: #fafafa;
}
</style>