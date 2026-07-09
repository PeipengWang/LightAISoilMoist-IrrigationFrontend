<script setup lang="ts">
import { computed } from 'vue'
import { useDeviceStore } from '../stores/devices'

const store = useDeviceStore()

interface DeviceCard {
  deviceName: string
  title: string
  badge: string
  badgeClass: string
  productName: string
}

const deviceCards: DeviceCard[] = [
  { deviceName: 'DHT11', title: '🌡️ 土壤温湿度传感器 (DHT11)', badge: '产品: 09B8L0Ji9W', badgeClass: '', productName: '09B8L0Ji9W' },
  { deviceName: 'device', title: '🌿 多要素环境监测 (device)', badge: '产品: FeGVC46Lne', badgeClass: 'agri', productName: 'FeGVC46Lne' },
]

function getSensors(deviceName: string) {
  const data = store.latestData[deviceName]
  if (!data) return []
  const meta = store.devicesMeta[deviceName] || {}
  return Object.entries(data).map(([ident, item]) => {
    const m = meta[ident] || {}
    const name = m.name || item.name || ident
    const unit = m.unit || item.unit || ''
    const val = item.value
    const ts = item.time || 0
    const timeStr = ts ? new Date(ts).toLocaleTimeString('zh-CN') : '--'
    const mode = m.mode || item.mode || '只读'

    let cssClass = ''
    const enumDesc = m.enum_desc || item.enum_desc || {}
    if (enumDesc) {
      const desc = enumDesc[String(val)] || ''
      if (desc.includes('报警') || desc.includes('异常')) cssClass = 'alarm'
    }

    let displayVal = (val !== null && val !== undefined) ? val : '--'
    if (enumDesc && enumDesc[String(val)]) {
      displayVal = enumDesc[String(val)]
    }

    return { ident, name, unit, displayVal, cssClass, timeStr, mode }
  })
}

function hasData(deviceName: string): boolean {
  return !!store.latestData[deviceName] && Object.keys(store.latestData[deviceName]).length > 0
}

const lastSseTimeStr = computed(() => {
  if (!store.lastSseTime) return '--'
  return new Date(store.lastSseTime).toLocaleTimeString('zh-CN')
})

function getDeviceLatestTime(deviceName: string): string {
  const data = store.latestData[deviceName]
  if (!data) return '--'
  let maxTime = 0
  for (const item of Object.values(data)) {
    if (item.time && item.time > maxTime) maxTime = item.time
  }
  return maxTime ? new Date(maxTime).toLocaleTimeString('zh-CN') : '--'
}
</script>

<template>
  <div class="sse-status-bar">
    <span class="sse-dot" :class="{ active: store.online }"></span>
    <span>SSE 推送次数: {{ store.sseCount }}</span>
    <span class="sse-time">最后推送: {{ lastSseTimeStr }}</span>
  </div>
  <div class="grid-2">
    <div v-for="card in deviceCards" :key="card.deviceName" class="card">
      <div class="card-header">
        <div>
          <h3>{{ card.title }}</h3>
          <span class="card-update-time">数据更新: {{ getDeviceLatestTime(card.deviceName) }}</span>
        </div>
        <span class="badge" :class="card.badgeClass">{{ card.badge }}</span>
      </div>
      <div v-if="!hasData(card.deviceName)" class="loading">
        <div class="spinner"></div>
        <p>加载中...</p>
      </div>
      <div v-else class="sensor-grid">
        <div
          v-for="s in getSensors(card.deviceName)"
          :key="s.ident"
          class="sensor-item"
          :class="s.cssClass"
        >
          <div class="label">{{ s.name }} {{ s.mode === '读写' ? '✏️' : '' }}</div>
          <div class="value">{{ s.displayVal }}</div>
          <div class="unit">{{ s.unit }}</div>
          <div class="time">{{ s.timeStr }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sse-status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  margin-bottom: 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  font-size: 0.85rem;
  color: #607d8b;
}

.sse-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #bdbdbd;
  transition: background 0.3s;
}

.sse-dot.active {
  background: #69f0ae;
  box-shadow: 0 0 6px #69f0ae;
}

.sse-time {
  margin-left: auto;
}

.card-update-time {
  display: block;
  font-size: 0.75rem;
  color: #9e9e9e;
  margin-top: 2px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
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

.badge {
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: 20px;
  background: #e8f5e9;
  color: #2e7d32;
}

.badge.agri {
  background: #e3f2fd;
  color: #1565c0;
}

.sensor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.sensor-item {
  background: #fafafa;
  border-radius: 8px;
  padding: 12px 14px;
  text-align: center;
  border: 1px solid #e0e0e0;
  transition: all 0.2s;
}

.sensor-item:hover {
  background: #f5f5f5;
  transform: translateY(-1px);
}

.sensor-item .label {
  font-size: 0.75rem;
  color: #607d8b;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sensor-item .value {
  font-size: 1.6rem;
  font-weight: 700;
  color: #2e7d32;
  line-height: 1.2;
}

.sensor-item .unit {
  font-size: 0.8rem;
  color: #607d8b;
}

.sensor-item .time {
  font-size: 0.7rem;
  color: #bdbdbd;
  margin-top: 4px;
}

.sensor-item.alarm .value {
  color: #c62828;
}

.sensor-item.warning .value {
  color: #f57f17;
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

@media (max-width: 900px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>