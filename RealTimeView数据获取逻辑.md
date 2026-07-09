# RealTimeView 实时数据获取逻辑梳理

## 1. 整体架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        LayoutView.vue                           │
│  onMounted() → store.init()                                     │
│  onUnmounted() → store.destroy()                                │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    RealTimeView.vue                       │   │
│  │                                                          │   │
│  │  store.latestData[name]  ──→  getSensors(name)  ──→ UI  │   │
│  │  store.devicesMeta[name] ──→  getSensors(name)  ──→ UI  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 数据获取方式（双通道）

实时数据通过 **两个通道** 同时获取，互为补充：

| 通道 | 实现 | 用途 | 实时性 |
|------|------|------|--------|
| **SSE (Server-Sent Events)** | `EventSource` 长连接 | 服务端主动推送数据变更 | 高（秒级） |
| **HTTP 轮询** | `setInterval` + `fetch` | 兜底拉取，补充 SSE 可能遗漏的数据 | 中（10秒间隔） |

### 2.1 SSE 通道

**位置**: `src/api/index.ts` → `createSSEConnection()`

```
GET /api/stream
Accept: text/event-stream
```

- 建立持久 HTTP 连接，服务端持续推送 JSON 数据
- 服务端推送的数据格式：`Record<deviceName, Record<identifier, { value, time, name, unit, mode }>>`
- 收到消息后直接更新 `store.latestData`
- `onerror` 时设置 `store.online = false`，状态文本变为"离线 · 尝试重连..."
- `onmessage` 成功时设置 `store.online = true`，状态文本变为"在线 · 实时更新中"

**代码流程**:
```
api/index.ts: createSSEConnection()
  → new EventSource('/api/stream')
  → es.onmessage → JSON.parse → onMessage(data)
  → store.startSSE() 回调 → 更新 latestData.value
```

### 2.2 HTTP 轮询通道

**位置**: `src/api/index.ts` → `fetchLatest()` + `src/stores/devices.ts` → `refreshLatest()`

```
GET /api/latest/api?device_name={deviceName}
```

- 每 **10秒** 执行一次 `refreshLatest()`
- 遍历 `devicesMeta` 中的所有设备，逐个调用 `fetchLatest(deviceName)`
- 每次获取到数据后合并进 `store.latestData[deviceName][identifier]`
- 轮询失败时仅 `console.error`，不阻断其他设备请求

**代码流程**:
```
store.startPolling()
  → setInterval(refreshLatest, 10000)
  → refreshLatest()
    → for each deviceName in devicesMeta:
      → api/index.ts: fetchLatest(deviceName)
        → fetch('/api/latest/api?device_name={deviceName}')
      → 合并到 store.latestData[deviceName][identifier]
    → latestData.value = { ...latestData.value }  // 触发 Vue 响应式
```

## 3. Store 初始化流程

**位置**: `src/stores/devices.ts` → `useDeviceStore.init()`

```
LayoutView.vue onMounted()
  → store.init()
    ├── 1. loadDevices()        // 获取设备元数据
    │     → GET /api/devices
    │     → 填充 store.devicesMeta
    │
    ├── 2. refreshLatest()      // 首次拉取最新数据
    │     → 遍历所有设备，逐个 GET /api/latest/api
    │     → 填充 store.latestData
    │
    ├── 3. startSSE()           // 建立 SSE 长连接
    │     → GET /api/stream
    │     → 持续监听推送
    │
    └── 4. startPolling()       // 启动 10 秒轮询
          → setInterval(refreshLatest, 10000)
```

## 4. Store 状态结构

```typescript
// src/stores/devices.ts

devicesMeta: Record<string, Record<string, PropertyMeta>>
// 示例: { "DHT11": { "temperature": { name:"温度", unit:"°C", mode:"只读", enum_desc:{} } } }

latestData: Record<string, Record<string, SensorData>>
// 示例: { "DHT11": { "temperature": { identifier:"temperature", value:25.3, time:1751596800000, name:"温度", unit:"°C", mode:"只读" } } }

online: boolean      // 连接状态
statusText: string   // 状态描述文字
```

## 5. RealTimeView.vue 渲染逻辑

**位置**: `src/views/RealTimeView.vue`

### 5.1 设备卡片定义（硬编码）

```typescript
const deviceCards: DeviceCard[] = [
  { deviceName: 'DHT11',     title: '设备: DHT11',           productName: '09B8L0Ji9W' },
  { deviceName: 'device',    title: '设备: device (农业监测)', productName: 'FeGVC46Lne' },
]
```

UI 根据 `deviceCards` 渲染两张卡片，每张卡片代表一个 OneNET 设备。

### 5.2 hasData() — 数据是否就绪

检查 `store.latestData[deviceName]` 是否存在且非空。返回 `false` 时显示 loading spinner，返回 `true` 时渲染传感器网格。

### 5.3 getSensors() — 数据转换核心

```typescript
function getSensors(deviceName: string)
```

**输入**: `store.latestData[deviceName]` + `store.devicesMeta[deviceName]`

**处理逻辑**:
1. 遍历 `latestData` 中的每个属性（identifier）
2. 从 `devicesMeta` 中取对应的元数据（名称、单位、模式、枚举映射）
3. 优先使用元数据的 `name/unit/mode`，其次使用数据本身的字段，最后用 ident 兜底
4. 时间戳 `item.time` 转换为本地时间字符串 `HH:MM:SS`
5. 枚举值处理：如果 `enum_desc` 中存在当前值，用枚举描述替换显示值
6. 告警判断：枚举描述中包含"报警"或"异常"字样则添加 `alarm` CSS class

**输出**: `Array<{ ident, name, unit, displayVal, cssClass, timeStr, mode }>`

### 5.4 UI 渲染

```
card → 无数据? → <spinner动画 + "加载中...">
     → 有数据? → sensor-grid (CSS Grid 自适应列)
                  ┌─────────────────────────┐
                  │ 温度 (✏️ 如果mode=读写)  │
                  │    25.3                  │
                  │    °C                    │
                  │    14:30:05              │
                  ├─────────────────────────┤
                  │ 湿度                     │
                  │    68.5                  │
                  │    %                     │
                  │    14:30:05              │
                  └─────────────────────────┘
```

### 5.5 样式要点

- 两列网格布局（`grid-template-columns: 1fr 1fr`），窄屏自动切换为单列
- 告警数据红色显示（`.alarm .value { color: #c62828 }`）
- 读写模式属性显示 ✏️ 图标

## 6. 完整数据流时序

```
页面加载
  │
  ├─ LayoutView.vue onMounted()
  │    └─ store.init()
  │         ├─ [HTTP] GET /api/devices ──→ devicesMeta
  │         ├─ [HTTP] GET /api/latest/api?device_name=DHT11 ──→ latestData.DHT11
  │         ├─ [HTTP] GET /api/latest/api?device_name=device ──→ latestData.device
  │         ├─ [SSE]  GET /api/stream ──→ 持续接收推送 ──→ 更新 latestData
  │         └─ [Timer] setInterval(10s) ──→ 每10秒:
  │              ├─ GET /api/latest/api?device_name=DHT11
  │              └─ GET /api/latest/api?device_name=device
  │
  ├─ RealTimeView.vue (响应式渲染)
  │    └─ watch(store.latestData) → hasData()? → getSensors() → 更新 DOM
  │
  └─ 页面离开 / 组件销毁
       └─ LayoutView.vue onUnmounted()
            └─ store.destroy()
                 ├─ SSE EventSource.close()
                 └─ clearInterval(pollTimer)
```

## 7. API 端点汇总

| 端点 | 方法 | 用途 | 调用位置 |
|------|------|------|----------|
| `/api/devices` | GET | 获取所有设备及其属性元数据 | `store.loadDevices()` |
| `/api/latest/api?device_name={name}` | GET | 获取指定设备最新数据 | `store.refreshLatest()` / 轮询 |
| `/api/stream` | GET (SSE) | 服务端主动推送数据变更 | `store.startSSE()` |

## 8. 关键设计细节

1. **双通道互补**: SSE 提供低延迟推送，HTTP 轮询作为兜底防止 SSE 断连丢数据
2. **响应式触发**: `latestData.value = { ...latestData.value }` 强制触发 Vue 响应式更新（因为直接修改嵌套对象属性可能不会被检测到）
3. **元数据与数据分离**: `devicesMeta` 存储属性的静态元信息（名称、单位、枚举），`latestData` 存储动态数值，渲染时合并
4. **生命周期绑定**: 数据获取在 `LayoutView` 的 `onMounted/onUnmounted` 中管理，确保页面切换时正确清理（SSE 连接关闭 + 定时器清除）
5. **容错处理**: 单个设备轮询失败不影响其他设备，仅打印错误日志