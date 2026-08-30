import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  type PropertyMeta,
  type SensorData,
  type SSEConnection,
  fetchDevices,
  fetchLatest,
  createSSEConnection,
} from '../api'

export const useDeviceStore = defineStore('devices', () => {
  const devicesMeta = ref<Record<string, Record<string, PropertyMeta>>>({})
  const latestData = ref<Record<string, Record<string, SensorData>>>({})
  const online = ref(true)
  const statusText = ref('在线')
  const lastSseTime = ref(0)
  const sseCount = ref(0)

  let sseConnection: SSEConnection | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollErrorLogged = false

  async function loadDevices() {
    const resp = await fetchDevices()
    const meta: Record<string, Record<string, PropertyMeta>> = {}
    for (const dev of resp.devices) {
      meta[dev.device_name] = dev.properties
    }
    devicesMeta.value = meta
  }

  async function refreshLatest() {
    let hasSuccess = false
    for (const dname of Object.keys(devicesMeta.value)) {
      try {
        const json = await fetchLatest(dname)
        if (json.code === 0 && json.data) {
          if (!latestData.value[dname]) {
            latestData.value[dname] = {}
          }
          for (const item of json.data) {
            latestData.value[dname][item.identifier] = {
              ...item,
              mode: item.mode || '只读',
            }
          }
          hasSuccess = true
        }
      } catch (err) {
        // 只在首次失败或恢复后首次失败时打印，避免刷屏
      }
    }
    if (hasSuccess) {
      pollErrorLogged = false
      if (!online.value) {
        online.value = true
        statusText.value = '在线 · 实时更新中'
      }
    } else if (!pollErrorLogged) {
      console.error('[轮询] 所有设备请求失败，后端可能未启动')
      pollErrorLogged = true
    }
    latestData.value = { ...latestData.value }
  }

  function startSSE() {
    sseConnection = createSSEConnection(
      (data) => {
        const deviceNames = Object.keys(data)
        let totalProps = 0
        for (const [dname, props] of Object.entries(data)) {
          if (!latestData.value[dname]) {
            latestData.value[dname] = {}
          }
          for (const [ident, item] of Object.entries(props)) {
            const typedItem = item as Record<string, unknown>
            latestData.value[dname][ident] = {
              identifier: ident,
              value: typedItem.value as string | number,
              time: typedItem.time as number,
              name: (typedItem.name as string) || ident,
              unit: (typedItem.unit as string) || '',
              mode: (typedItem.mode as string) || '只读',
              enum_desc: (typedItem.enum_desc as Record<string, string>) || {},
            }
            totalProps++
          }
        }
        latestData.value = { ...latestData.value }
        sseCount.value++
        lastSseTime.value = Date.now()
        pollErrorLogged = false
        online.value = true
        statusText.value = '在线 · 实时更新中'
        console.log(`[SSE] 第${sseCount.value}次推送: ${deviceNames.length}个设备, ${totalProps}个属性, ${new Date(lastSseTime.value).toLocaleTimeString('zh-CN')}`)
      },
      (isOnline: boolean) => {
        online.value = isOnline
        if (!isOnline) {
          statusText.value = '离线 · 尝试重连...'
        }
      }
    )
  }

  function startPolling() {
    pollTimer = setInterval(refreshLatest, 10000)
  }

  async function init() {
    await loadDevices()
    await refreshLatest()
    startSSE()
    startPolling()
  }

  function destroy() {
    if (sseConnection) {
      sseConnection.close()
      sseConnection = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pollErrorLogged = false
  }

  return {
    devicesMeta,
    latestData,
    online,
    statusText,
    lastSseTime,
    sseCount,
    loadDevices,
    refreshLatest,
    startSSE,
    startPolling,
    init,
    destroy,
  }
})