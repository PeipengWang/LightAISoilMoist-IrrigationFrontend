<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  fetchThresholdStages,
  fetchStageThresholds,
  updateThresholdValue,
  fetchThresholdHistory,
  overridePhenologyStage,
  clearPhenologyOverride,
  type ThresholdStage,
  type StageThresholdItem,
  type ThresholdSnapshotItem,
} from '../api'

// ==================== 物候期列表 ====================
const stages = ref<ThresholdStage[]>([])
const stagesLoading = ref(false)
const selectedStageId = ref<number | null>(null)
const selectedStage = computed(() => stages.value.find(s => s.id === selectedStageId.value))

// ==================== 阈值列表 ====================
const thresholds = ref<StageThresholdItem[]>([])
const thresholdsLoading = ref(false)

// ==================== 编辑阈值 ====================
const editVisible = ref(false)
const editingThreshold = ref<StageThresholdItem | null>(null)
const editValue = ref<number | null>(null)
const editReason = ref('')
const editSaving = ref(false)

// ==================== 变更历史 ====================
const historyVisible = ref(false)
const historyItems = ref<ThresholdSnapshotItem[]>([])
const historyLoading = ref(false)
const historyThreshold = ref<StageThresholdItem | null>(null)

// ==================== 物候期手动指定 ====================
const overrideLoading = ref(false)
const overrideActive = ref(false)

const propertyLabelMap: Record<string, string> = {
  A: '土壤pH值',
  B: '土壤湿度',
  C: '环境温度',
  D: '环境湿度',
  E: '光照',
  M: '氮含量',
  N: '磷含量',
  O: '钾含量',
}

const propertyColorMap: Record<string, string> = {
  A: '#7b1fa2',
  B: '#1565c0',
  C: '#e65100',
  D: '#00838f',
  E: '#f9a825',
  M: '#2e7d32',
  N: '#c62828',
  O: '#6a1b9a',
}

async function loadStages() {
  stagesLoading.value = true
  try {
    const resp = await fetchThresholdStages()
    if (resp.code === 200 && resp.data) {
      stages.value = resp.data
      if (resp.data.length > 0 && !selectedStageId.value) {
        selectedStageId.value = resp.data[0].id
        await loadThresholds()
      }
    }
  } catch {
    // 后端不可用
  } finally {
    stagesLoading.value = false
  }
}

async function loadThresholds() {
  if (!selectedStageId.value) return
  thresholdsLoading.value = true
  try {
    const resp = await fetchStageThresholds(selectedStageId.value)
    if (resp.code === 200 && resp.data) {
      thresholds.value = resp.data
    }
  } catch {
    thresholds.value = []
  } finally {
    thresholdsLoading.value = false
  }
}

function onStageChange() {
  loadThresholds()
}

// ==================== 编辑操作 ====================
function openEdit(t: StageThresholdItem) {
  editingThreshold.value = t
  editValue.value = t.thresholdValue
  editReason.value = ''
  editVisible.value = true
}

async function saveEdit() {
  if (!editingThreshold.value || editValue.value === null) return
  editSaving.value = true
  try {
    const resp = await updateThresholdValue(editingThreshold.value.id, editValue.value, editReason.value || '人工调整')
    if (resp.code === 200) {
      editVisible.value = false
      await loadThresholds()
    }
  } finally {
    editSaving.value = false
  }
}

// ==================== 历史查看 ====================
async function openHistory(t: StageThresholdItem) {
  historyThreshold.value = t
  historyVisible.value = true
  historyLoading.value = true
  try {
    const resp = await fetchThresholdHistory(t.id)
    if (resp.code === 200 && resp.data) {
      historyItems.value = resp.data
    }
  } catch {
    historyItems.value = []
  } finally {
    historyLoading.value = false
  }
}

// ==================== 物候期覆盖 ====================
async function doOverride() {
  if (!selectedStageId.value) return
  overrideLoading.value = true
  try {
    const resp = await overridePhenologyStage(1, selectedStageId.value)
    if (resp.code === 200) {
      overrideActive.value = true
    }
  } finally {
    overrideLoading.value = false
  }
}

async function doClearOverride() {
  overrideLoading.value = true
  try {
    const resp = await clearPhenologyOverride(1)
    if (resp.code === 200) {
      overrideActive.value = false
    }
  } finally {
    overrideLoading.value = false
  }
}

// ==================== 阈值分组 ====================
const groupedThresholds = computed(() => {
  const groups: Record<string, StageThresholdItem[]> = {}
  for (const t of thresholds.value) {
    const key = t.propertyIdentifier
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }
  // 按 B, A, C, D, E 排序
  const order = ['B', 'A', 'C', 'D', 'E', 'M', 'N', 'O']
  return order.filter(k => groups[k]).map(k => ({ propertyId: k, items: groups[k] }))
})

const title = computed(() => {
  const s = selectedStage.value
  if (!s) return '阈值配置'
  const months = s.typicalStartMonth <= s.typicalEndMonth
    ? `${s.typicalStartMonth}月-${s.typicalEndMonth}月`
    : `${s.typicalStartMonth}月-次年${s.typicalEndMonth}月`
  return `${s.stageName}（${months}）· 阈值配置`
})

onMounted(() => {
  loadStages()
})
</script>

<template>
  <div class="threshold-page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h2>🌱 物候期阈值管理</h2>
      </div>
      <div class="toolbar-right">
        <el-button
          :type="overrideActive ? 'warning' : 'primary'"
          size="small"
          :loading="overrideLoading"
          @click="doOverride"
        >
          手动指定为当前物候期
        </el-button>
        <el-button
          v-if="overrideActive"
          size="small"
          :loading="overrideLoading"
          @click="doClearOverride"
        >
          恢复自动判断
        </el-button>
      </div>
    </div>

    <!-- 物候期横向步骤条 -->
    <div class="stage-strip" v-loading="stagesLoading">
      <div
        v-for="s in stages"
        :key="s.id"
        :class="['stage-item', { active: selectedStageId === s.id }]"
        @click="selectedStageId = s.id; onStageChange()"
      >
        <div class="stage-order">{{ s.stageOrder }}</div>
        <div class="stage-name">{{ s.stageName }}</div>
        <div class="stage-months">
          {{ s.typicalStartMonth }}月 → {{ s.typicalEndMonth }}月
        </div>
        <div class="stage-gdd" v-if="s.gddThresholdLow > 0">
          GDD {{ s.gddThresholdLow }}-{{ s.gddThresholdHigh }}
        </div>
      </div>
    </div>

    <!-- 阈值表格区域 -->
    <div class="content-area">
      <div class="card threshold-card" v-loading="thresholdsLoading">
        <div class="card-header">
          <h3>{{ title }}</h3>
          <span class="hint-text">点击行操作按钮编辑阈值，所有修改自动记录快照</span>
        </div>

        <div v-if="groupedThresholds.length === 0 && !thresholdsLoading" class="empty-state">
          📭 该物候期暂无阈值配置
        </div>

        <div v-for="group in groupedThresholds" :key="group.propertyId" class="property-section">
          <div class="property-header">
            <span
              class="property-dot"
              :style="{ background: propertyColorMap[group.propertyId] || '#999' }"
            ></span>
            <span class="property-title">{{ propertyLabelMap[group.propertyId] || group.propertyId }}</span>
            <span class="property-code">({{ group.propertyId }})</span>
          </div>
          <el-table :data="group.items" stripe size="small" style="width:100%">
            <el-table-column prop="thresholdTypeName" label="类型" width="100">
              <template #default="{ row }">
                <el-tag
                  :type="row.thresholdType === 'LOWER' ? 'primary' : row.thresholdType === 'UPPER' ? 'danger' : 'success'"
                  size="small"
                >
                  {{ row.thresholdTypeName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="阈值数值" min-width="150">
              <template #default="{ row }">
                <span class="value-display">{{ row.thresholdValue }}</span>
                <span class="value-unit">{{ row.unit }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="unit" label="单位" width="80" />
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="openEdit(row)">
                  编辑
                </el-button>
                <el-button size="small" type="info" link @click="openHistory(row)">
                  历史
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>

    <!-- 编辑阈值对话框 -->
    <el-dialog v-model="editVisible" title="编辑阈值" width="420px" :close-on-click-modal="false">
      <div v-if="editingThreshold" class="edit-body">
        <div class="edit-info">
          <span class="edit-prop">{{ editingThreshold.propertyName }}</span>
          <el-tag
            :type="editingThreshold.thresholdType === 'LOWER' ? 'primary' : editingThreshold.thresholdType === 'UPPER' ? 'danger' : 'success'"
            size="small"
          >
            {{ editingThreshold.thresholdTypeName }}
          </el-tag>
        </div>
        <div class="edit-row">
          <span class="edit-label">当前值</span>
          <span class="edit-current">{{ editingThreshold.thresholdValue }} {{ editingThreshold.unit }}</span>
        </div>
        <div class="edit-row">
          <span class="edit-label">新值</span>
          <el-input-number v-model="editValue" :precision="1" :step="0.5" size="small" style="width:180px" />
          <span class="edit-unit">{{ editingThreshold.unit }}</span>
        </div>
        <div class="edit-row">
          <span class="edit-label">修改原因</span>
          <el-input v-model="editReason" placeholder="如：根据近期数据调整" size="small" style="width:240px" />
        </div>
      </div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 变更历史对话框 -->
    <el-dialog v-model="historyVisible" title="阈值变更历史" width="560px">
      <div v-if="historyThreshold" class="history-header">
        {{ historyThreshold.propertyName }} · {{ historyThreshold.thresholdTypeName }}
      </div>
      <el-table :data="historyItems" stripe size="small" style="width:100%" v-loading="historyLoading" max-height="360">
        <el-table-column prop="oldValue" label="旧值" width="100" />
        <el-table-column prop="newValue" label="新值" width="100" />
        <el-table-column prop="changeReason" label="原因" min-width="130">
          <template #default="{ row }">
            <span class="reason-text">{{ row.changeReason }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="操作人" width="80" />
        <el-table-column prop="changedAt" label="时间" width="160">
          <template #default="{ row }">
            <span class="time-text">{{ row.changedAt?.replace('T', ' ').substring(0, 19) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="historyItems.length === 0 && !historyLoading" class="empty-small">暂无变更记录</div>
    </el-dialog>
  </div>
</template>

<style scoped>
.threshold-page {
  min-height: calc(100vh - 180px);
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.toolbar-left h2 {
  font-size: 1.2rem;
  color: #2e7d32;
  font-weight: 600;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}

/* 物候期步骤条 */
.stage-strip {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.stage-strip::-webkit-scrollbar { height: 4px; }
.stage-strip::-webkit-scrollbar-thumb { background: #c8e6c9; border-radius: 2px; }

.stage-item {
  flex: 1;
  min-width: 120px;
  background: #fff;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  user-select: none;
}
.stage-item:hover {
  border-color: #a5d6a7;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.stage-item.active {
  border-color: #43a047;
  background: linear-gradient(135deg, #e8f5e9, #f1f8e9);
  box-shadow: 0 2px 12px rgba(76,175,80,0.2);
}
.stage-order {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: #e0e0e0;
  color: #78909c;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  margin-bottom: 6px;
}
.stage-item.active .stage-order {
  background: #43a047;
  color: #fff;
}
.stage-name {
  font-weight: 600;
  color: #37474f;
  font-size: 0.9rem;
}
.stage-months {
  font-size: 0.75rem;
  color: #90a4ae;
  margin-top: 2px;
}
.stage-gdd {
  font-size: 0.7rem;
  color: #a5d6a7;
  margin-top: 2px;
}

/* 内容区 */
.content-area {
  display: flex;
  flex-direction: column;
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
.hint-text {
  font-size: 0.78rem;
  color: #90a4ae;
}

/* 属性分组 */
.property-section {
  margin-bottom: 18px;
}
.property-section:last-child { margin-bottom: 0; }
.property-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.property-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.property-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #37474f;
}
.property-code {
  font-size: 0.75rem;
  color: #b0bec5;
}

.value-display {
  font-size: 1.05rem;
  font-weight: 700;
  color: #263238;
  font-family: 'Consolas', 'Courier New', monospace;
}
.value-unit {
  font-size: 0.8rem;
  color: #90a4ae;
  margin-left: 4px;
}

/* 编辑对话框 */
.edit-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.edit-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-prop {
  font-size: 0.95rem;
  font-weight: 600;
  color: #37474f;
}
.edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-label {
  color: #607d8b;
  min-width: 70px;
  font-size: 0.85rem;
}
.edit-current {
  font-weight: 600;
  color: #1565c0;
}
.edit-unit {
  color: #90a4ae;
  font-size: 0.85rem;
}

/* 历史对话框 */
.history-header {
  font-size: 0.9rem;
  font-weight: 600;
  color: #37474f;
  margin-bottom: 12px;
}
.reason-text {
  font-size: 0.8rem;
  color: #546e7a;
}
.time-text {
  font-size: 0.78rem;
  color: #90a4ae;
}

/* 空状态 */
.empty-state {
  text-align: center;
  color: #b0bec5;
  font-size: 0.9rem;
  padding: 40px 0;
}
.empty-small {
  text-align: center;
  color: #b0bec5;
  font-size: 0.85rem;
  padding: 20px 0;
}

.threshold-card {
  min-height: 300px;
}

@media (max-width: 900px) {
  .stage-strip {
    flex-wrap: nowrap;
  }
  .stage-item {
    min-width: 100px;
    padding: 10px 12px;
  }
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
