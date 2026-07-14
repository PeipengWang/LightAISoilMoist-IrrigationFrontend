# NPK传感器（氮磷钾）前端适配方案

## 背景

设备端已新增氮磷钾传感器，OneNET平台标识符分别为：
- **M** = 氮（单位：mg/kg，数据类型：int32，只读）
- **N** = 磷（单位：mg/kg，数据类型：int32，只读）
- **O** = 钾（单位：mg/kg，数据类型：int32，只读）

## 现状分析

### 后端：无需改动

`DeviceConfig.java` 已完整注册 M、N、O 三个属性。后端架构是属性驱动的（property-driven），以下端点**自动生效**：
- `GET /api/devices` — 元数据中自动包含 M、N、O 的名称、单位
- `GET /api/latest` — 自动查询并返回 M、N、O 最新值
- `GET /api/history?identifier=M/N/O` — 自动查询历史数据
- `SSE /api/stream` — 自动推送 M、N、O 实时数据

### 前端：大部分自动生效，少量硬编码需补充

前端核心数据流也是属性驱动的：
- **DeviceStore** — `devicesMeta` 和 `latestData` 动态遍历所有属性，M/N/O 自动出现
- **HistoryView** — 属性下拉选项、图表渲染、表格展示、统计卡片、CSV导出全部动态生成，**无需任何改动**
- **API 层** — `fetchLatest()`、`fetchHistory()`、`fetchDevices()` 全部参数化，**无需改动**

需要改动的只有**3个文件中的硬编码映射表**：

| 文件 | 硬编码内容 | 影响 |
|------|-----------|------|
| `RealTimeView.vue` | 快捷模板列表 | NPK模板缺失，用户无法一键选中氮磷钾 |
| `DecisionView.vue` | `propertyLabelMap` | 阈值面板中 M/N/O 显示为原始标识符而非中文名 |
| `ThresholdConfigView.vue` | `propertyLabelMap`、`propertyColorMap`、排序数组 | 若后续配置 NPK 阈值，显示会缺少中文名和颜色 |

---

## 修改方案

### 1. RealTimeView.vue — 新增 NPK 快捷模板

**位置**：第 130-135 行 `quickTemplates` 数组

**现状**：4 个模板均基于 DHT11 设备属性（`temperature`、`humidity`、`PH`、`light`、`pump`）

**改动**：新增一条 NPK 土壤养分模板

```typescript
const quickTemplates: QuickTemplate[] = [
  { name: '温湿度模板', properties: ['temperature', 'humidity'] },
  { name: '土壤监测', properties: ['temperature', 'humidity', 'PH'] },
  { name: '完整环境', properties: ['temperature', 'humidity', 'PH', 'light'] },
  { name: '灌溉相关', properties: ['humidity', 'temperature', 'pump'] },
  { name: '土壤养分', properties: ['M', 'N', 'O'] },  // 新增
]
```

**说明**：`applyTemplate()` 会自动按设备过滤——农业终端设备匹配 M/N/O，DHT11 设备匹配不到则跳过。

---

### 2. DecisionView.vue — 补充 M/N/O 属性名称映射

**位置**：第 37-43 行 `propertyLabelMap`

**现状**：
```typescript
const propertyLabelMap: Record<string, string> = {
  A: '土壤pH值',
  B: '土壤湿度',
  C: '环境温度',
  D: '环境湿度',
  E: '光照',
}
```

**改动**：新增 M、N、O 三个条目

```typescript
const propertyLabelMap: Record<string, string> = {
  A: '土壤pH值',
  B: '土壤湿度',
  C: '环境温度',
  D: '环境湿度',
  E: '光照',
  M: '氮',
  N: '磷',
  O: '钾',
}
```

**说明**：该映射仅在当前阈值面板中使用（`groupedCurrentThresholds` 渲染时查找中文名）。NPK 暂无阈值，添加映射是为了完整性和后续扩展。

---

### 3. ThresholdConfigView.vue — 补充 M/N/O 映射、颜色和排序

**位置**：
- `propertyLabelMap`：第 42-48 行
- `propertyColorMap`：第 50-56 行
- `groupedThresholds` 排序数组：第 169 行

**改动**：

```typescript
// propertyLabelMap 新增
const propertyLabelMap: Record<string, string> = {
  A: '土壤pH值',
  B: '土壤湿度',
  C: '环境温度',
  D: '环境湿度',
  E: '光照',
  M: '氮',
  N: '磷',
  O: '钾',
}

// propertyColorMap 新增（颜色建议沿用农业/化学惯例）
const propertyColorMap: Record<string, string> = {
  A: '#7b1fa2',   // 紫色 - pH
  B: '#1565c0',   // 蓝色 - 湿度
  C: '#e65100',   // 橙色 - 温度
  D: '#00838f',   // 青色 - 湿度
  E: '#f9a825',   // 黄色 - 光照
  M: '#2e7d32',   // 绿色 - 氮
  N: '#c62828',   // 红色 - 磷
  O: '#6a1b9a',   // 深紫 - 钾
}

// groupedThresholds 排序数组新增 M, N, O
const order = ['B', 'A', 'C', 'D', 'E', 'M', 'N', 'O']
```

---

## 不需要改动的内容

以下模块**完全不需要修改**，M/N/O 数据会自动流通：

| 模块 | 原因 |
|------|------|
| `src/api/index.ts` | 所有接口参数化，`identifier` 为字符串 |
| `src/stores/devices.ts` | `latestData` 和 `devicesMeta` 动态遍历所有属性键 |
| `HistoryView.vue` 属性下拉 | 动态读取 `store.devicesMeta`，M/N/O 自动出现 |
| `HistoryView.vue` 图表/表格 | 动态渲染，M/N/O 自动支持双Y轴对比 |
| `HistoryView.vue` 统计卡片 | 动态计算 max/min/avg |
| `HistoryView.vue` CSV导出 | 动态遍历属性 |
| `RealTimeView.vue` 传感器卡片 | `getDeviceSensors()` 动态遍历 |
| `RealTimeView.vue` 看板配置面板 | `allPropertyIdents` 动态收集 |

---

## 测试验证

### 1. 实时数据验证
- 打开实时监测页面，点击「看板配置」
- 选择农业终端设备，展开属性配置
- 确认 M(氮)、N(磷)、O(钾) 出现在可选属性列表中
- 勾选后确认卡片显示正确的数值和单位（mg/kg）
- 点击「土壤养分」快捷模板，确认自动选中 M/N/O

### 2. 历史数据验证
- 进入历史数据分析页面
- 选择农业终端设备
- 在属性下拉中确认 M、N、O 可选
- 选择 M（氮），设置时间范围，点击查询
- 确认折线图正常渲染、统计卡片显示数据、表格分页正常
- 选择 M+N 双属性对比，确认双Y轴图表正常
- 测试 CSV 导出功能

### 3. 决策/阈值页面验证
- 进入智能决策页面，确认传感器指标区域能展示氮磷钾数值
- 进入阈值配置页面，确认页面不报错（当前 NPK 无阈值数据为正常状态）

### 4. 边界情况
- 设备离线/无 NPK 数据时，实时卡片应显示 `--`
- 历史查询无数据时，图表和表格应显示空状态提示

---

## 改动量统计

| 文件 | 改动行数 |
|------|---------|
| `RealTimeView.vue` | +1 行（快捷模板） |
| `DecisionView.vue` | +3 行（映射表） |
| `ThresholdConfigView.vue` | +6 行（映射表 + 颜色 + 排序） |
| **合计** | **约 10 行代码** |

---

## 风险点

- **无**。所有改动均为纯增量（新增映射条目），不修改现有逻辑，不影响已有功能。
- 若 OneNET 平台 M/N/O 数据尚未实际上报，前端会正常显示 `--` 占位，不会报错。