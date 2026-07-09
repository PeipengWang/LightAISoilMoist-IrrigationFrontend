# 前端技术栈文档

## LightAI 苹果智慧果园管理系统

> Vue 3 + Element Plus 前端管理系统

---

## 环境要求

| 工具 | 版本 |
|------|------|
| **Node.js** | >= 18.x（当前 v20.20.0） |
| **npm** | >= 9.x（当前 10.8.2） |

## 核心框架

| 技术 | 版本 | 说明 |
|------|------|------|
| **Vue** | 3.5.39 | 渐进式 JavaScript 框架，Composition API + `<script setup>` |
| **Vite** | 8.1.3 | 新一代前端构建工具，开发服务器秒级热更新 |
| **TypeScript** | 6.0.3 | 类型安全的 JavaScript 超集 |

## 主要依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| **vue-router** | 5.1.0 | Vue 官方路由管理器 |
| **pinia** | 3.0.4 | Vue 官方状态管理库（Vuex 替代） |
| **element-plus** | 2.14.2 | 企业级 Vue 3 UI 组件库（表格 / 按钮 / 菜单 / 表单 等） |
| **@element-plus/icons-vue** | 2.3.2 | Element Plus 图标组件库 |

## 开发工具

| 依赖 | 版本 | 说明 |
|------|------|------|
| **@vitejs/plugin-vue** | 6.0.7 | Vite 的 Vue 3 单文件组件编译插件 |
| **vue-tsc** | 3.3.6 | Vue 模板 TypeScript 类型检查工具 |
| **sass** | 1.101.0 | CSS 预处理器 |
| **unplugin-auto-import** | 21.0.0 | API 自动导入（ref / reactive / computed 等无需手动 import） |
| **unplugin-vue-components** | 32.1.0 | Element Plus 组件按需自动导入 |

## 项目结构

```
LightAISoilMoist-IrrigationFrontend/
├── index.html                          # 入口 HTML
├── package.json                        # 依赖与脚本
├── vite.config.ts                      # Vite 配置（插件 / 代理 / 端口）
├── tsconfig.json                       # TypeScript 项目引用配置
├── tsconfig.app.json                   # 应用 TypeScript 配置
├── tsconfig.node.json                  # Node 端 TypeScript 配置
├── public/
│   └── favicon.svg                     # 网站图标
└── src/
    ├── main.ts                         # 应用入口（注册 Router / Pinia / ElementPlus）
    ├── App.vue                         # 根组件
    ├── style.css                       # 全局样式
    ├── api/
    │   └── index.ts                    # API 客户端（类型定义 + fetch/SSE 函数）
    ├── router/
    │   └── index.ts                    # 路由配置（Layout + 实时/历史/决策页面）
    ├── stores/
    │   └── devices.ts                  # Pinia 设备状态管理（SSE/轮询/设备元数据）
    └── views/
        ├── LayoutView.vue              # 主布局（顶栏 + Tab导航 + 内容区）
        ├── RealTimeView.vue            # 实时数据监测（多要素传感器卡片 + SSE推送）
        ├── HistoryView.vue             # 历史数据分析（Chart.js 折线图 + 数据表）
        ├── DecisionView.vue            # 智能决策管理（设备控制 + AI建议 + 决策日志）
        ├── HomeView.vue                # 首页（未使用）
        └── DemoView.vue                # 示例表格页（未使用）
```

## 启动方式

```bash
# 安装依赖
npm install

# 开发模式启动（默认 http://localhost:3000）
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview
```

## 开发代理

Vite 配置了 API 代理，开发环境下 `/api` 前缀的请求自动转发到后端 `http://localhost:8086`，解决跨域问题。

## 组件按需导入

配置了 `unplugin-auto-import` 和 `unplugin-vue-components`，Element Plus 组件无需手动 import，直接在模板中使用即可。

## 变更记录

### 2026-07-08 — 智能决策模块集成（前后端分离）

**背景**: 将 YYA 智能决策前端（原 `E:\code\LightAISoilMoist-IrrigationBackend\YYA\static\index.html`）整合到 Vue 前端项目中，实现前后端分离架构。

**修改**:
- **`src/views/DecisionView.vue`**: 重构为设备决策管理主页面 + AI助手浮动弹窗：
  - 主页面：设备开关控制、出水量/工作时长/工作间隔调节、阈值设置（湿度上下限、温度补偿、时段限制）、实时参数面板、决策日志表格
  - 右下角 FAB 浮动按钮（"小沂"），点击打开 `el-drawer` 侧边抽屉，内含完整 AI 农事助手聊天界面
  - 聊天支持：流式 SSE 推送、Markdown 渲染、语音输入（ASR）、语音播报（TTS）
- **`vite.config.ts`**: 新增 `/api/chat`、`/api/memory`、`/api/asr` 代理规则，指向 YYA 后端 `http://localhost:8001`（优先级高于原有 `/api` → 8086 规则）
- **`src/api/index.ts`**: 新增 `chatStream`（SSE 流式聊天）、`fetchASR`（语音识别）、`getTtsUrl`（TTS 地址）函数
- **`package.json`**: 新增 `marked` 依赖用于 Markdown 渲染

**后端端口**:
| 服务 | 端口 | 说明 |
|------|------|------|
| 原数据后端 | 8086 | 设备数据、实时流、历史数据 |
| YYA 智能决策后端 | 8001 | 聊天流、记忆管理 |
| TTS 服务 | 9000 | 文本转语音 |

### 2026-07-05 — SSE 数据流可见性增强

**问题**: SSE 实时推送数据的接收和刷新状态不可见，无法确认数据是否到达并更新到 UI。

**修改**:
- **`src/api/index.ts`**: SSE 连接增加 `onopen`/`onmessage`/`onerror` 日志，输出连接状态、数据摘要和错误原因
- **`src/stores/devices.ts`**: 
  - SSE 回调补充 `enum_desc` 字段（修复 SSE 推送数据丢失枚举描述导致告警检测失效的 bug）
  - 新增 `lastSseTime`、`sseCount` 响应式变量追踪推送状态
  - 每次 SSE 推送输出设备数/属性数/时间戳日志
- **`src/views/RealTimeView.vue`**: 
  - 新增 SSE 状态栏（推送次数 + 最后推送时刻）
  - 每个设备卡片显示"数据更新"时间戳

### 2026-07-05 — 后端断连时前端错误日志优化

**问题**: 后端未启动时，SSE 默认每 3 秒重试 + 轮询每 10 秒报错，控制台持续刷屏 `ECONNREFUSED` / `ECONNRESET`。

**修改**:
- **`src/api/index.ts`**: 
  - 用**手动退避重连**替代浏览器默认 EventSource 重连（1s → 2s → 4s → 8s → 16s → 30s 上限）
  - 连接成功后重置退避延迟
  - 首次失败后抑制后续重复错误日志，重连成功后恢复
  - `createSSEConnection` 返回 `SSEConnection` 接口（仅暴露 `close()`），不再暴露原始 EventSource
  - 回调从 `onError()` 改为 `onStatusChange(online: boolean)`，状态语义更清晰
- **`src/stores/devices.ts`**: 
  - 适配 `SSEConnection` 类型和 `onStatusChange` 回调
  - 轮询失败时仅打印一次 `[轮询] 所有设备请求失败`，恢复成功后重置标记
  - 轮询恢复成功后自动恢复在线状态
