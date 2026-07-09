<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { marked } from 'marked'
import { chatStream, fetchASR, getTtsUrl, fetchDecisionSummary, fetchCurrentThresholds, type DecisionSummaryData, type CurrentThresholdsData, type CurrentThresholdItem } from '../api'
import { useDeviceStore } from '../stores/devices'

marked.setOptions({ breaks: true, gfm: true })

const store = useDeviceStore()

// ==================== 设备控制参数 ====================
const wateringActive = ref(false)
const waterVolume = ref(50)
const waterDuration = ref(15)
const waterInterval = ref(6)
const allowedStart = ref('06:00')
const allowedEnd = ref('20:00')

function toggleWatering() {
  wateringActive.value = !wateringActive.value
}

// ==================== 当前生效阈值（从后端获取） ====================
const currentStageName = ref('')
const currentSoilType = ref('LOAM')
const currentThresholds = ref<CurrentThresholdsData['thresholds']>([])
const thresholdsLoading = ref(false)

const soilTypeOptions = [
  { label: '壤土 (LOAM)', value: 'LOAM' },
  { label: '砂土 (SAND)', value: 'SAND' },
  { label: '砂壤土 (SANDY_LOAM)', value: 'SANDY_LOAM' },
  { label: '粘壤土 (CLAY_LOAM)', value: 'CLAY_LOAM' },
  { label: '粘土 (CLAY)', value: 'CLAY' },
]

const propertyLabelMap: Record<string, string> = {
  A: '土壤pH值',
  B: '土壤湿度',
  C: '环境温度',
  D: '环境湿度',
  E: '光照',
}

async function loadCurrentThresholds() {
  thresholdsLoading.value = true
  try {
    const resp = await fetchCurrentThresholds(currentSoilType.value)
    if (resp.code === 200 && resp.data) {
      currentStageName.value = resp.data.stageName
      currentThresholds.value = resp.data.thresholds
    }
  } catch {
    // 后端不可用，保持空数据
  } finally {
    thresholdsLoading.value = false
  }
}

const groupedCurrentThresholds = computed(() => {
  const groups: Record<string, CurrentThresholdItem[]> = {}
  for (const t of currentThresholds.value) {
    if (!groups[t.propertyIdentifier]) groups[t.propertyIdentifier] = []
    groups[t.propertyIdentifier].push(t)
  }
  return groups
})

// ==================== 智能决策数据（来自智能体） ====================
const decisionLoading = ref(false)
const decisionError = ref('')
const decisionData = ref<DecisionSummaryData>({
  summary: '',
  advices: [],
  problematicSensors: [],
  alerts: [],
})

const DECISION_PROMPT = '请分析当前果园状况，给出今日农田管理建议'

async function refreshDecision() {
  decisionLoading.value = true
  decisionError.value = ''
  try {
    const resp = await fetchDecisionSummary(DECISION_PROMPT)
    if (resp.code === 0 && resp.data) {
      decisionData.value = resp.data
    } else {
      decisionError.value = resp.message || '智能体返回异常'
    }
  } catch {
    decisionError.value = '智能体服务未连接，请确认后端已启动'
  } finally {
    decisionLoading.value = false
  }
}

// 所有传感器（用于异常指标展示）
const allSensors = computed(() => {
  const result: { device: string; name: string; value: number; unit: string; time: number }[] = []
  for (const [dname, props] of Object.entries(store.latestData)) {
    for (const [ident, item] of Object.entries(props)) {
      result.push({
        device: dname,
        name: item.name || ident,
        value: Number(item.value),
        unit: item.unit || '',
        time: item.time,
      })
    }
  }
  return result
})

// 整体状态等级
const overallLevel = computed(() => {
  const levels = decisionData.value.advices.map(a => a.level)
  if (levels.includes('danger')) return 'danger'
  if (levels.includes('warning')) return 'warning'
  if (levels.length > 0) return 'safe'
  return 'info'
})

onMounted(() => {
  refreshDecision()
  loadCurrentThresholds()
})

// ==================== 决策日志 ====================
interface DecisionLog {
  time: string
  trigger: string
  result: string
  status: string
}
const decisionLogs = ref<DecisionLog[]>([
  { time: '2026-07-08 06:15', trigger: '土壤湿度低于30%', result: '自动开启灌溉', status: '已执行' },
  { time: '2026-07-07 18:30', trigger: '土壤湿度低于30%', result: '自动开启灌溉', status: '已执行' },
  { time: '2026-07-07 06:10', trigger: '定时灌溉', result: '自动开启灌溉', status: '已执行' },
  { time: '2026-07-06 18:22', trigger: '土壤湿度低于30%', result: '自动开启灌溉', status: '已执行' },
  { time: '2026-07-06 06:05', trigger: '定时灌溉', result: '自动开启灌溉', status: '已执行' },
])

// ==================== 聊天弹窗 ====================
const chatVisible = ref(false)

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
}

const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const isStreaming = ref(false)
const isRecording = ref(false)
const showEmpty = ref(true)

const messagesContainer = ref<HTMLDivElement>()
const textareaRef = ref<HTMLTextAreaElement>()

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let currentAudio: HTMLAudioElement | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
const toastMsg = ref('')
const toastVisible = ref(false)

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text) as string
}

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function showToast(msg: string, duration = 2000) {
  if (toastTimer) clearTimeout(toastTimer)
  toastMsg.value = msg
  toastVisible.value = true
  toastTimer = setTimeout(() => {
    toastVisible.value = false
  }, duration)
}

function playTTS(text: string) {
  if (!text) return
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    URL.revokeObjectURL(currentAudio.src)
    currentAudio = null
  }
  fetch(getTtsUrl(text))
    .then(res => {
      if (!res.ok) throw new Error('TTS请求失败')
      return res.blob()
    })
    .then(blob => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio
      audio.play().catch(() => {})
      audio.onended = () => {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
      }
    })
    .catch(() => {})
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return

  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    URL.revokeObjectURL(currentAudio.src)
    currentAudio = null
  }

  inputText.value = ''
  showEmpty.value = false
  messages.value.push({ role: 'user', content: text })

  const aiIndex = messages.value.length
  messages.value.push({ role: 'ai', content: '' })
  isStreaming.value = true
  scrollToBottom()

  let fullText = ''
  let ttsText = ''

  try {
    await chatStream(
      text,
      (chunk) => {
        fullText += chunk
        messages.value[aiIndex].content = renderMarkdown(fullText)
        scrollToBottom()
      },
      (tts) => {
        ttsText = tts
        messages.value[aiIndex].content = renderMarkdown(fullText)
        isStreaming.value = false
        scrollToBottom()
        if (ttsText) playTTS(ttsText)
      },
      (err) => {
        messages.value[aiIndex].content = '抱歉，出错了：' + err
        isStreaming.value = false
      }
    )
  } catch {
    messages.value[aiIndex].content = '网络错误，请确保后端服务已启动'
    isStreaming.value = false
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function autoResize() {
  const ta = textareaRef.value
  if (ta) {
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }
}

async function toggleRecording() {
  if (isRecording.value) {
    stopRecording()
  } else {
    await startRecording()
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    mediaRecorder = new MediaRecorder(stream)
    audioChunks = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(audioChunks, { type: mimeType })
      await transcribeAudio(blob)
    }
    mediaRecorder.start()
    isRecording.value = true
    showToast('正在录音...')
  } catch {
    showToast('无法访问麦克风')
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording.value) {
    mediaRecorder.stop()
    isRecording.value = false
  }
}

async function transcribeAudio(blob: Blob) {
  showToast('语音识别中...')
  try {
    const text = await fetchASR(blob)
    if (text) {
      showToast('识别成功，自动发送')
      inputText.value = text
      await sendMessage()
    } else {
      showToast('未识别到语音内容')
    }
  } catch {
    showToast('语音识别失败')
  }
}

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
  }
})
</script>

<template>
  <div class="decision-page">
    <!-- ==================== 设备控制面板 ==================== -->
    <div class="grid-3">
      <div class="card">
        <div class="card-header">
          <h3>🔧 设备控制</h3>
          <el-switch
            v-model="wateringActive"
            active-text="开启"
            inactive-text="关闭"
            size="large"
            @change="toggleWatering"
          />
        </div>
        <div class="control-body">
          <div class="control-row">
            <span class="label">当前状态</span>
            <span :class="['status-tag', wateringActive ? 'on' : 'off']">
              {{ wateringActive ? '设备运行中' : '设备已停止' }}
            </span>
          </div>
          <div class="control-row">
            <span class="label">出水量</span>
            <el-slider v-model="waterVolume" :min="10" :max="100" :step="5" show-input />
          </div>
          <div class="control-row">
            <span class="label">工作时长 (分钟)</span>
            <el-input-number v-model="waterDuration" :min="1" :max="120" size="small" />
          </div>
          <div class="control-row">
            <span class="label">工作间隔 (小时)</span>
            <el-input-number v-model="waterInterval" :min="1" :max="24" size="small" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>📐 当前生效阈值</h3>
          <div style="display:flex;align-items:center;gap:8px;">
            <span v-if="currentStageName" class="badge">{{ currentStageName }}</span>
            <el-select v-model="currentSoilType" size="small" style="width:160px" @change="loadCurrentThresholds">
              <el-option v-for="s in soilTypeOptions" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </div>
        </div>
        <div class="control-body" v-loading="thresholdsLoading">
          <template v-if="currentThresholds.length > 0">
            <div v-for="(group, propId) in groupedCurrentThresholds" :key="propId" class="threshold-prop-group">
              <div class="threshold-prop-label">{{ propertyLabelMap[propId] || propId }}</div>
              <div class="threshold-values">
                <template v-for="t in (group as CurrentThresholdItem[])" :key="t.thresholdType">
                  <span v-if="t.thresholdType === 'LOWER'" class="threshold-tag lower">下限 {{ t.value }}</span>
                  <span v-else-if="t.thresholdType === 'UPPER'" class="threshold-tag upper">上限 {{ t.value }}</span>
                  <span v-else class="threshold-tag target">{{ t.thresholdTypeName }} {{ t.value }}</span>
                </template>
              </div>
            </div>
          </template>
          <div v-else-if="!thresholdsLoading" class="empty-hint">
            暂无阈值数据，请确认后端阈值服务已启动
          </div>
        </div>
      </div>

      <div class="card decision-card">
        <div class="card-header">
          <h3>🧠 小沂智能决策建议</h3>
          <span :class="['badge', `badge-${overallLevel}`]">
            {{ decisionLoading ? '分析中...' : overallLevel === 'danger' ? '需处理' : overallLevel === 'warning' ? '需关注' : overallLevel === 'safe' ? '正常' : '等待数据' }}
          </span>
        </div>

        <!-- 加载状态 -->
        <div v-if="decisionLoading && decisionData.advices.length === 0" class="loading-hint">
          🌾 小沂正在分析传感器数据，生成决策建议...
        </div>

        <!-- 错误提示 -->
        <div v-if="decisionError && decisionData.advices.length > 0" class="fallback-hint">
          ⚠️ {{ decisionError }}
        </div>

        <!-- 综合建议摘要 -->
        <div v-if="decisionData.summary" :class="['summary-box', overallLevel]">
          <div class="summary-icon">
            {{ overallLevel === 'danger' ? '🔴' : overallLevel === 'warning' ? '🟡' : '🟢' }}
          </div>
          <div class="summary-text">{{ decisionData.summary }}</div>
        </div>
        <div v-else-if="!decisionLoading" class="summary-box info">
          <div class="summary-icon">🔵</div>
          <div class="summary-text">等待传感器数据上报...</div>
        </div>

        <!-- 分项建议列表 -->
        <div class="advices-section" v-if="decisionData.advices.length > 0">
          <div
            v-for="(adv, i) in decisionData.advices"
            :key="i"
            :class="['advice-category', adv.level]"
          >
            <div class="advice-cat-header">
              <span class="advice-cat-icon">{{ adv.icon }}</span>
              <span class="advice-cat-title">{{ adv.title }}</span>
              <span :class="['advice-cat-level', adv.level]">
                {{ adv.level === 'danger' ? '需处理' : adv.level === 'warning' ? '需关注' : adv.level === 'safe' ? '正常' : '信息' }}
              </span>
            </div>
            <ul class="advice-items">
              <li v-for="(item, j) in adv.items" :key="j">{{ item }}</li>
            </ul>
          </div>
        </div>

        <!-- 异常传感器指标 -->
        <div class="sensors-section" v-if="decisionData.problematicSensors.length > 0">
          <div class="section-title">⚠️ 异常传感器指标</div>
          <div class="sensor-chips">
            <div
              v-for="(s, i) in decisionData.problematicSensors"
              :key="i"
              :class="['sensor-chip', s.status]"
            >
              <span class="chip-device">{{ s.device }}</span>
              <span class="chip-name">{{ s.name }}</span>
              <span class="chip-value">{{ s.value }}{{ s.unit }}</span>
              <span class="chip-reason">{{ s.reason }}</span>
            </div>
          </div>
        </div>
        <div class="sensors-ok" v-else-if="allSensors.length > 0 && !decisionLoading">
          <div class="section-title">📊 传感器指标</div>
          <div class="sensor-chips">
            <div
              v-for="(s, i) in allSensors.slice(0, 4)"
              :key="i"
              class="sensor-chip normal"
            >
              <span class="chip-device">{{ s.device }}</span>
              <span class="chip-name">{{ s.name }}</span>
              <span class="chip-value safe">{{ s.value }}{{ s.unit }}</span>
            </div>
          </div>
        </div>

        <!-- 告警信息 -->
        <div class="alerts-section" v-if="decisionData.alerts.length > 0">
          <div class="section-title">🚨 告警信息</div>
          <div
            v-for="(a, i) in decisionData.alerts"
            :key="i"
            :class="['alert-item', a.level]"
          >
            <span class="alert-dot"></span>
            <span class="alert-device">{{ a.device }}</span>
            <span class="alert-msg">{{ a.message }}</span>
          </div>
        </div>
        <div class="alerts-empty" v-else-if="!decisionLoading">
          ✅ 当前无告警
        </div>
      </div>
    </div>

    <!-- ==================== 决策日志 ==================== -->
    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h3>📝 决策日志</h3>
        <el-button size="small" type="primary" plain>导出日志</el-button>
      </div>
      <el-table :data="decisionLogs" stripe size="small" style="width:100%">
        <el-table-column prop="time" label="时间" width="180" />
        <el-table-column prop="trigger" label="触发条件" />
        <el-table-column prop="result" label="决策结果" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === '已执行' ? 'success' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- ==================== 浮动AI助手按钮 ==================== -->
    <div class="fab-btn" @click="chatVisible = true">
      <span class="fab-icon">🍎</span>
      <span class="fab-label">小沂</span>
    </div>

    <!-- ==================== AI助手聊天抽屉 ==================== -->
    <el-drawer
      v-model="chatVisible"
      title="🍎 苹果智能农事助手"
      direction="rtl"
      size="480"
      :close-on-click-modal="false"
    >
      <div class="chat-wrapper">
        <!-- Messages -->
        <div class="messages" ref="messagesContainer">
          <div v-if="showEmpty" class="empty-chat">
            <div class="empty-icon">🍎</div>
            <p>您好，我是小沂，请问果园需要什么帮助？</p>
            <p class="hint">可以问我灌溉建议、施肥方案、病虫害防治、环境调控等问题</p>
          </div>

          <div
            v-for="(msg, i) in messages"
            :key="i"
            :class="['msg', msg.role]"
            v-html="msg.content"
          ></div>
        </div>

        <!-- Input Area -->
        <div class="input-area">
          <div class="input-wrapper">
            <textarea
              ref="textareaRef"
              v-model="inputText"
              rows="1"
              placeholder="输入农事问题..."
              :disabled="isStreaming"
              @keydown="handleKeyDown"
              @input="autoResize"
            ></textarea>
            <button
              class="send-btn"
              :disabled="isStreaming || !inputText.trim()"
              @click="sendMessage"
            >
              ➤
            </button>
          </div>
          <button
            :class="['mic-btn', { recording: isRecording }]"
            @click="toggleRecording"
          >
            {{ isRecording ? '⏹' : '🎤' }}
          </button>
        </div>

        <!-- Toast -->
        <Transition name="toast-fade">
          <div v-if="toastVisible" class="toast">{{ toastMsg }}</div>
        </Transition>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
/* ========== 决策页面 ========== */
.decision-page {
  position: relative;
  min-height: calc(100vh - 180px);
}

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
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

/* 控制面板 */
.control-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
}

.control-row .label {
  color: #607d8b;
  min-width: 110px;
  flex-shrink: 0;
}

.status-tag {
  padding: 3px 14px;
  border-radius: 14px;
  font-size: 0.8rem;
  font-weight: 500;
}
.status-tag.on {
  background: #e8f5e9;
  color: #2e7d32;
}
.status-tag.off {
  background: #fbe9e7;
  color: #bf360c;
}

/* 指标列表 */
.metric-list {
  display: flex;
  flex-direction: column;
}
.metric-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px dashed #e0e0e0;
  font-size: 0.85rem;
}
.metric-item:last-child { border-bottom: none; }
.metric-label { color: #607d8b; }
.metric-value { font-weight: 600; color: #263238; }
.metric-value.low { color: #e65100; }

/* 当前生效阈值显示 */
.threshold-prop-group {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed #e0e0e0;
}
.threshold-prop-group:last-child { border-bottom: none; }
.threshold-prop-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #37474f;
  min-width: 80px;
}
.threshold-values {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.threshold-tag {
  font-size: 0.78rem;
  padding: 2px 10px;
  border-radius: 12px;
  font-weight: 500;
}
.threshold-tag.lower {
  background: #e3f2fd;
  color: #1565c0;
}
.threshold-tag.upper {
  background: #fce4ec;
  color: #c62828;
}
.threshold-tag.target {
  background: #e8f5e9;
  color: #2e7d32;
}
.empty-hint {
  text-align: center;
  color: #90a4ae;
  font-size: 0.85rem;
  padding: 20px 0;
}

/* ========== 智能决策建议卡片 ========== */
.decision-card {
  overflow-y: auto;
  max-height: 520px;
}
.decision-card::-webkit-scrollbar { width: 4px; }
.decision-card::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

.badge-danger {
  background: #fbe9e7;
  color: #bf360c;
}
.badge-warning {
  background: #fff8e1;
  color: #e65100;
}

.loading-hint, .fallback-hint {
  text-align: center;
  padding: 10px;
  font-size: 0.75rem;
  border-radius: 8px;
  margin-bottom: 10px;
}
.loading-hint {
  color: #2e7d32;
  background: #e8f5e9;
}
.fallback-hint {
  color: #e65100;
  background: #fff3e0;
}

/* 综合建议摘要 */
.summary-box {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  margin-bottom: 12px;
}
.summary-box.danger {
  background: linear-gradient(135deg, #fbe9e7, #fff3e0);
  border: 1px solid #ffccbc;
}
.summary-box.warning {
  background: linear-gradient(135deg, #fff8e1, #fffde7);
  border: 1px solid #ffe0b2;
}
.summary-box.safe {
  background: linear-gradient(135deg, #e8f5e9, #f1f8e9);
  border: 1px solid #c8e6c9;
}
.summary-box.info {
  background: linear-gradient(135deg, #e3f2fd, #e8eaf6);
  border: 1px solid #bbdefb;
}
.summary-icon { font-size: 22px; flex-shrink: 0; line-height: 1.3; }
.summary-text { font-size: 0.82rem; color: #37474f; line-height: 1.6; }

/* 分项建议 */
.advices-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.advice-category {
  border-radius: 10px;
  padding: 10px 12px;
}
.advice-category.danger {
  background: #fff5f5;
  border-left: 3px solid #ef5350;
}
.advice-category.warning {
  background: #fffde7;
  border-left: 3px solid #ff9800;
}
.advice-category.safe {
  background: #f1f8e9;
  border-left: 3px solid #66bb6a;
}
.advice-category.info {
  background: #f5f5f5;
  border-left: 3px solid #90a4ae;
}

.advice-cat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.advice-cat-icon { font-size: 16px; }
.advice-cat-title { font-size: 0.85rem; font-weight: 700; color: #263238; }
.advice-cat-level {
  font-size: 0.65rem;
  padding: 1px 8px;
  border-radius: 10px;
  margin-left: auto;
}
.advice-cat-level.danger { background: #ffcdd2; color: #b71c1c; }
.advice-cat-level.warning { background: #ffe0b2; color: #e65100; }
.advice-cat-level.safe { background: #c8e6c9; color: #1b5e20; }
.advice-cat-level.info { background: #e0e0e0; color: #546e7a; }

.advice-items {
  margin: 0;
  padding-left: 18px;
}
.advice-items li {
  font-size: 0.78rem;
  color: #546e7a;
  line-height: 1.6;
  margin-bottom: 2px;
}

/* 传感器指标区域 */
.section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: #546e7a;
  margin-bottom: 8px;
  padding-top: 10px;
  border-top: 1px solid #e0e0e0;
}
.sensors-section .section-title { border-top: 1px solid #ffccbc; }

.sensor-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}
.sensor-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 0.75rem;
}
.sensor-chip.danger {
  background: #fff5f5;
  border: 1px solid #ffcdd2;
}
.sensor-chip.warning {
  background: #fffde7;
  border: 1px solid #ffe0b2;
}
.sensor-chip.normal {
  background: #f5f7fa;
  border: 1px solid #e0e0e0;
}
.chip-device { font-weight: 600; color: #37474f; }
.chip-name { color: #78909c; }
.chip-value { font-weight: 700; }
.chip-value.safe { color: #2e7d32; }
.sensor-chip.danger .chip-value { color: #c62828; }
.sensor-chip.warning .chip-value { color: #e65100; }
.chip-reason {
  color: #90a4ae;
  font-size: 0.7rem;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sensors-ok { margin-bottom: 4px; }

/* 告警列表 */
.alerts-section {
  padding-top: 2px;
}
.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  margin-bottom: 3px;
  font-size: 0.76rem;
}
.alert-item.danger { background: #fff5f5; }
.alert-item.warning { background: #fffde7; }
.alert-item.info { background: #f5f5f5; }

.alert-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}
.alert-item.danger .alert-dot { background: #e53935; }
.alert-item.warning .alert-dot { background: #ff9800; }
.alert-item.info .alert-dot { background: #90a4ae; }

.alert-device {
  font-weight: 600;
  color: #37474f;
  flex-shrink: 0;
  white-space: nowrap;
}
.alert-msg { color: #546e7a; line-height: 1.4; }

.alerts-empty {
  text-align: center;
  padding: 8px 0 2px;
  font-size: 0.75rem;
  color: #a5d6a7;
}

/* ========== FAB浮动按钮 ========== */
.fab-btn {
  position: fixed;
  bottom: 32px;
  right: 32px;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #66bb6a, #43a047);
  color: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(76,175,80,0.4);
  z-index: 100;
  transition: all 0.3s ease;
  user-select: none;
}
.fab-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(76,175,80,0.5);
}
.fab-btn:active { transform: scale(0.95); }
.fab-icon { font-size: 24px; line-height: 1; }
.fab-label {
  font-size: 10px;
  margin-top: -2px;
  font-weight: 500;
}

/* ========== 聊天弹窗样式 ========== */
.chat-wrapper {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 80px);
  min-width: 0;
  --primary: #4caf50;
  --primary-hover: #388e3c;
  --user-bubble: #e8f5e9;
  --ai-bubble: #f6f8fa;
  --border: #e0e0e0;
  --text: #2c3e50;
  --text-secondary: #666;
  --shadow: 0 2px 8px rgba(0,0,0,0.05);
  --radius: 16px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scroll-behavior: smooth;
}
.messages::-webkit-scrollbar { width: 5px; }
.messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }

.empty-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #bbb;
  gap: 8px;
  padding: 40px 20px;
}
.empty-icon { font-size: 48px; }
.empty-chat p { font-size: 14px; text-align: center; }
.empty-chat .hint { font-size: 12px; color: #ccc; }

.msg {
  max-width: 88%;
  padding: 10px 14px;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  animation: fadeIn 0.35s ease;
  line-height: 1.6;
  word-break: break-word;
  font-size: 13px;
}
.msg.user {
  align-self: flex-end;
  background: var(--user-bubble);
  border-bottom-right-radius: 4px;
}
.msg.ai {
  align-self: flex-start;
  background: var(--ai-bubble);
  border-bottom-left-radius: 4px;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Markdown */
.msg :deep(h1), .msg :deep(h2), .msg :deep(h3) { margin: 6px 0 3px; font-weight: 600; }
.msg :deep(h1) { font-size: 1.15em; }
.msg :deep(h2) { font-size: 1.08em; }
.msg :deep(p) { margin: 2px 0; }
.msg :deep(ul), .msg :deep(ol) { padding-left: 16px; margin: 2px 0; }
.msg :deep(blockquote) {
  margin: 4px 0; padding: 3px 10px;
  border-left: 3px solid var(--primary);
  background: rgba(76,175,80,0.06);
  color: #555;
}
.msg :deep(code) {
  background: rgba(0,0,0,0.06);
  padding: 1px 4px; border-radius: 3px;
  font-family: 'Consolas', monospace;
  font-size: 0.88em;
}
.msg :deep(pre) {
  background: #2d2d2d; color: #e0e0e0;
  padding: 8px 12px; border-radius: 6px;
  overflow-x: auto; margin: 4px 0;
  font-size: 11px; line-height: 1.5;
}
.msg :deep(pre code) { background: none; padding: 0; color: inherit; }
.msg :deep(table) { border-collapse: collapse; margin: 4px 0; width: 100%; font-size: 11px; }
.msg :deep(th), .msg :deep(td) { border: 1px solid #d0d0d0; padding: 3px 6px; text-align: left; }
.msg :deep(th) { background: #f0f4f0; }
.msg :deep(a) { color: var(--primary); text-decoration: underline; }

/* Input */
.input-area {
  padding: 10px 0 4px;
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  align-items: flex-end;
}
.input-wrapper {
  flex: 1;
  display: flex;
  align-items: flex-end;
  background: #f6f8fa;
  border-radius: 18px;
  padding: 5px 8px 5px 14px;
  border: 1px solid #e0e0e0;
  transition: all 0.2s ease;
}
.input-wrapper:focus-within {
  border-color: var(--primary);
  background: #fff;
}
.input-wrapper textarea {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  resize: none;
  max-height: 100px;
  min-height: 20px;
  line-height: 1.5;
  padding: 2px 0;
  background: transparent;
}
.input-wrapper textarea::placeholder { color: #aaa; }

.send-btn {
  width: 32px; height: 32px;
  border: none; border-radius: 50%;
  background: var(--primary);
  color: white;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.send-btn:hover { background: var(--primary-hover); }
.send-btn:disabled { background: #ccc; cursor: not-allowed; }

.mic-btn {
  width: 40px; height: 40px;
  border: none; border-radius: 50%;
  background: #e8f5e9;
  color: var(--primary);
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.mic-btn:hover { background: #c8e6c9; }
.mic-btn.recording {
  background: #ff4757; color: white;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,71,87,0.4); }
  50% { box-shadow: 0 0 0 10px rgba(255,71,87,0); }
}

.toast {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 6px 20px;
  border-radius: 20px;
  font-size: 12px;
  z-index: 100;
  pointer-events: none;
}
.toast-fade-enter-active,
.toast-fade-leave-active { transition: opacity 0.3s ease; }
.toast-fade-enter-from,
.toast-fade-leave-to { opacity: 0; }

@media (max-width: 900px) {
  .grid-3 { grid-template-columns: 1fr; }
}
</style>