<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { marked } from 'marked'
import { ElMessage, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import {
  uploadImage,
  fetchImages,
  fetchImageFolders,
  createImageFolder,
  deleteImageFolder,
  deleteImage,
  batchDeleteImages,
  archiveImage,
  batchArchiveImages,
  fetchImageAnalyses,
  analyzeImageStream,
  imageFileUrl,
  type ImageRecord,
  type ImageFolder,
  type ImageAnalysisItem,
} from '../api'

marked.setOptions({ breaks: true, gfm: true })

// ==================== 目录 ====================
const folders = ref<ImageFolder[]>([])
const activeFolderId = ref<number | null>(null)

// ==================== 图片列表 ====================
const records = ref<ImageRecord[]>([])
const page = ref(0) // 后端 0-based
const size = ref(20)
const total = ref(0)
const galleryLoading = ref(false)

// ==================== 上传 ====================
const dragOver = ref(false)
const uploading = ref(false)
const uploadDone = ref(0)
const uploadTotal = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)

const uploadForm = reactive({
  folderId: null as number | null,
  remark: '',
  plotCode: '',
  cropType: '',
  soilType: '',
  growthStage: '',
  irrigationStatus: '',
  samplingDepth: '',
  captureCondition: '',
  operator: '',
  deviceId: '',
})

const advancedOpen = ref<string[]>([])

// ==================== 分析抽屉 ====================
const drawerVisible = ref(false)
const currentImage = ref<ImageRecord | null>(null)
const analyses = ref<ImageAnalysisItem[]>([])
const analysesLoading = ref(false)
const expandedAnalysisId = ref<number | null>(null)

// ==================== 流式分析 ====================
const analysisPrompt = ref('')
const analyzing = ref(false)
const streamText = ref('')
const streamDone = ref(false)
const streamError = ref('')
const streamBox = ref<HTMLDivElement | null>(null)
let abortController: AbortController | null = null

// ==================== 新建目录 ====================
const folderDialogVisible = ref(false)
const newFolderName = ref('')
const newFolderParentId = ref<number | null>(null)
const folderSaving = ref(false)

// ==================== 数据加载 ====================
async function loadFolders() {
  try {
    const resp = await fetchImageFolders()
    if (resp.code === 200 && resp.data) {
      folders.value = resp.data
    } else {
      folders.value = []
    }
  } catch {
    folders.value = []
  }
}

async function loadImages() {
  galleryLoading.value = true
  try {
    const resp = await fetchImages({ folderId: activeFolderId.value, page: page.value, size: size.value })
    if (resp.code === 200 && resp.data) {
      records.value = resp.data.content || []
      total.value = resp.data.totalElements || 0
      // 删除图片后可能出现越界页，回退到最后一页
      const totalPages = resp.data.totalPages || 0
      if (totalPages > 0 && page.value >= totalPages) {
        page.value = totalPages - 1
        galleryLoading.value = false
        await loadImages()
        return
      }
    } else {
      records.value = []
      total.value = 0
    }
  } catch {
    records.value = []
    total.value = 0
  } finally {
    galleryLoading.value = false
  }
}

function switchFolder(id: number | null) {
  if (activeFolderId.value === id) return
  activeFolderId.value = id
  page.value = 0
  resetSelection()
  loadImages()
}

function onPageChange(p: number) {
  page.value = p - 1
  resetSelection()
  loadImages()
}

// ==================== 上传处理 ====================
function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) handleFiles(files)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length > 0) handleFiles(input.files)
  input.value = ''
}

async function handleFiles(fileList: FileList) {
  if (uploading.value) return
  const list = Array.from(fileList).filter(f => f.type.startsWith('image/'))
  if (list.length === 0) {
    ElMessage.warning('请选择图片文件（JPG / PNG / WEBP 等）')
    return
  }

  uploading.value = true
  uploadDone.value = 0
  uploadTotal.value = list.length
  let ok = 0
  let fail = 0

  for (const file of list) {
    try {
      const resp = await uploadImage({ file, ...uploadForm })
      if (resp.code === 200) {
        ok++
      } else {
        fail++
        ElMessage.error(`「${file.name}」上传失败：${resp.message || '未知错误'}`)
      }
    } catch (e) {
      fail++
      ElMessage.error(`「${file.name}」上传失败：${e instanceof Error ? e.message : '网络异常'}`)
    }
    uploadDone.value++
  }

  uploading.value = false
  if (ok > 0) {
    ElMessage.success(`成功上传 ${ok} 张图片${fail > 0 ? `，${fail} 张失败` : ''}`)
    page.value = 0
    await loadImages()
  }
}

// ==================== 目录管理 ====================
function openFolderDialog() {
  newFolderName.value = ''
  newFolderParentId.value = null
  folderDialogVisible.value = true
}

async function saveNewFolder() {
  const name = newFolderName.value.trim()
  if (!name) {
    ElMessage.warning('请输入目录名称')
    return
  }
  folderSaving.value = true
  try {
    const resp = await createImageFolder(name, newFolderParentId.value)
    if (resp.code === 200) {
      folderDialogVisible.value = false
      ElMessage.success('目录创建成功')
      await loadFolders()
    } else {
      ElMessage.error(resp.message || '创建失败')
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  } finally {
    folderSaving.value = false
  }
}

async function confirmDeleteFolder(f: ImageFolder) {
  try {
    await ElMessageBox.confirm(
      `确定删除目录「${f.name}」吗？其下图片将转为未分类，图片文件不会被删除。`,
      '删除目录',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const resp = await deleteImageFolder(f.id)
    if (resp.code === 200) {
      ElMessage.success('目录已删除')
      if (activeFolderId.value === f.id) activeFolderId.value = null
      await loadFolders()
      page.value = 0
      await loadImages()
    } else {
      ElMessage.error(resp.message || '删除失败')
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

// ==================== 选择 / 删除 / 归档 ====================
const selectedIds = ref<number[]>([])
const batchBusy = ref(false)

// 归档对话框（单张与批量共用）
const moveDialogVisible = ref(false)
const moveTargetFolderId = ref<number | null>(null)
const moveSingle = ref<ImageRecord | null>(null) // 非空表示单张归档模式

const allSelected = computed(
  () => records.value.length > 0 && selectedIds.value.length === records.value.length
)
const moveCount = computed(() => (moveSingle.value ? 1 : selectedIds.value.length))

function isSelected(id: number): boolean {
  return selectedIds.value.includes(id)
}

function toggleSelect(id: number) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(id)
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : records.value.map(r => r.id)
}

function clearSelection() {
  selectedIds.value = []
}

function unselect(id: number) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
}

/** 切换目录/翻页后清空选择，避免跨页误操作 */
function resetSelection() {
  selectedIds.value = []
}

/** 删除单张图片：级联删除磁盘文件与分析结论 */
async function confirmDeleteImage(img: ImageRecord) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${img.originalName}」吗？磁盘文件与该图片的全部分析结论将被永久删除，无法恢复。`,
      '删除图片',
      { confirmButtonText: '永久删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const resp = await deleteImage(img.id)
    if (resp.code === 200) {
      ElMessage.success('图片已删除')
      closeDrawerIfDeleted([img.id])
      unselect(img.id)
      await loadImages()
    } else {
      ElMessage.error(resp.message || '删除失败')
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

/** 批量删除选中的图片 */
async function confirmBatchDelete() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${ids.length} 张图片吗？磁盘文件与关联分析结论将被永久删除，无法恢复。`,
      '批量删除',
      { confirmButtonText: '永久删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  batchBusy.value = true
  try {
    const resp = await batchDeleteImages(ids)
    if (resp.code === 200) {
      ElMessage.success(`已删除 ${resp.data ?? ids.length} 张图片`)
      closeDrawerIfDeleted(ids)
      clearSelection()
      await loadImages()
    } else {
      ElMessage.error(resp.message || '批量删除失败')
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '批量删除失败')
  } finally {
    batchBusy.value = false
  }
}

/** 若正在分析的图片被删除，关闭抽屉并中止流 */
function closeDrawerIfDeleted(ids: number[]) {
  const cur = currentImage.value
  if (cur && ids.includes(cur.id)) {
    if (analyzing.value) stopAnalysis()
    drawerVisible.value = false
  }
}

/** 单张归档：folderId 为 null 表示移出到未分类；revert 用于失败回滚（乐观更新场景） */
async function archiveSingle(img: ImageRecord, folderId: number | null, revert?: number | null) {
  const rollback = () => {
    if (revert === undefined) return
    img.folderId = revert
    const rec = records.value.find(r => r.id === img.id)
    if (rec) rec.folderId = revert
    const cur = currentImage.value
    if (cur && cur.id === img.id) cur.folderId = revert
  }
  try {
    const resp = await archiveImage(img.id, folderId)
    if (resp.code === 200) {
      ElMessage.success(folderId == null ? '已移出目录（未分类）' : '归档成功')
      if (currentImage.value?.id === img.id && resp.data) {
        currentImage.value = resp.data
      }
      await loadImages()
    } else {
      rollback()
      ElMessage.error(resp.message || '归档失败')
    }
  } catch (e) {
    rollback()
    ElMessage.error(e instanceof Error ? e.message : '归档失败')
  }
}

/** 抽屉内切换目录即归档（先本地乐观更新，失败再回滚） */
function onDrawerFolderChange(v: number | null | undefined) {
  const img = currentImage.value
  if (!img) return
  const target = v ?? null
  const prev = img.folderId ?? null
  if (prev === target) return
  img.folderId = target
  const rec = records.value.find(r => r.id === img.id)
  if (rec) rec.folderId = target
  archiveSingle(img, target, prev)
}

/** 卡片上的单张归档入口 */
function openMoveSingle(img: ImageRecord) {
  moveSingle.value = img
  moveTargetFolderId.value = img.folderId ?? null
  moveDialogVisible.value = true
}

/** 批量归档入口 */
function openMoveDialog() {
  if (selectedIds.value.length === 0) return
  moveSingle.value = null
  moveTargetFolderId.value = null
  moveDialogVisible.value = true
}

/** 确认归档（单张 / 批量） */
async function confirmMove() {
  const target = moveTargetFolderId.value ?? null
  const single = moveSingle.value
  moveDialogVisible.value = false
  if (single) {
    moveSingle.value = null
    if ((single.folderId ?? null) === target) {
      ElMessage.info('目录未变化，未做调整')
      return
    }
    await archiveSingle(single, target)
    return
  }
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  batchBusy.value = true
  try {
    const resp = await batchArchiveImages(ids, target)
    if (resp.code === 200) {
      ElMessage.success(`已归档 ${resp.data ?? ids.length} 张图片`)
      clearSelection()
      await loadImages()
    } else {
      ElMessage.error(resp.message || '批量归档失败')
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '批量归档失败')
  } finally {
    batchBusy.value = false
  }
}

// ==================== 分析抽屉 ====================
function openDrawer(img: ImageRecord) {
  if (analyzing.value) stopAnalysis()
  currentImage.value = img
  drawerVisible.value = true
  analyses.value = []
  expandedAnalysisId.value = null
  analysisPrompt.value = ''
  streamText.value = ''
  streamDone.value = false
  streamError.value = ''
  loadAnalyses(img.id)
}

function onDrawerClosed() {
  if (analyzing.value) stopAnalysis()
  currentImage.value = null
}

async function loadAnalyses(imageId: number) {
  analysesLoading.value = true
  try {
    const resp = await fetchImageAnalyses(imageId)
    if (resp.code === 200 && resp.data) {
      analyses.value = resp.data
    } else {
      analyses.value = []
    }
  } catch {
    analyses.value = []
  } finally {
    analysesLoading.value = false
  }
}

function toggleHistory(id: number) {
  expandedAnalysisId.value = expandedAnalysisId.value === id ? null : id
}

// ==================== 流式 AI 分析 ====================
async function startAnalysis() {
  if (!currentImage.value || analyzing.value) return
  analyzing.value = true
  streamDone.value = false
  streamError.value = ''
  streamText.value = ''
  abortController = new AbortController()
  const imageId = currentImage.value.id

  await analyzeImageStream(
    imageId,
    analysisPrompt.value,
    chunk => {
      streamText.value += chunk
      scrollToStreamBottom()
    },
    full => {
      if (full) streamText.value = full
      analyzing.value = false
      streamDone.value = true
      // 本地同步"已分析"标记
      const rec = records.value.find(r => r.id === imageId)
      if (rec) {
        rec.analyzed = true
        rec.analysisStatus = 'DONE'
      }
      if (currentImage.value) {
        currentImage.value.analyzed = true
        currentImage.value.analysisStatus = 'DONE'
      }
      loadAnalyses(imageId)
      ElMessage.success('AI 分析完成，结论已保存')
    },
    err => {
      analyzing.value = false
      streamError.value = err
    },
    abortController.signal
  )
}

function stopAnalysis() {
  abortController?.abort()
  abortController = null
  analyzing.value = false
  streamDone.value = false
  ElMessage.info('已停止本次分析')
}

function scrollToStreamBottom() {
  nextTick(() => {
    const el = streamBox.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// ==================== 元数据展示 ====================
const fileMetaItems = computed(() => {
  const img = currentImage.value
  if (!img) return []
  const items: Array<{ label: string; value: string }> = [
    { label: '原始文件名', value: img.originalName },
    { label: '文件大小', value: formatSize(img.size) },
    { label: '尺寸', value: img.width && img.height ? `${img.width} × ${img.height} px` : '' },
    { label: '格式', value: (img.format || '').toUpperCase() },
    { label: '上传时间', value: formatTime(img.createdAt) },
    { label: '备注', value: img.remark || '' },
  ]
  return items.filter(i => i.value)
})

const exifItems = computed(() => {
  const img = currentImage.value
  if (!img) return []
  const camera = [img.cameraMake, img.cameraModel].filter(Boolean).join(' ')
  const items: Array<{ label: string; value: string }> = [
    { label: '拍摄时间', value: img.dateTaken ? formatTime(img.dateTaken) : '' },
    { label: '相机', value: camera },
    { label: 'GPS', value: formatGps(img.gpsLatitude, img.gpsLongitude) },
    { label: '海拔', value: img.gpsAltitude != null ? `${img.gpsAltitude.toFixed(1)} m` : '' },
  ]
  return items.filter(i => i.value)
})

const fieldItems = computed(() => {
  const img = currentImage.value
  if (!img) return []
  const items: Array<{ label: string; value: string }> = [
    { label: '地块编号', value: img.plotCode || '' },
    { label: '作物类型', value: img.cropType || '' },
    { label: '土壤类型', value: img.soilType || '' },
    { label: '生育期', value: img.growthStage || '' },
    { label: '灌溉状态', value: img.irrigationStatus || '' },
    { label: '采样深度', value: img.samplingDepth || '' },
    { label: '拍摄条件', value: img.captureCondition || '' },
    { label: '操作人', value: img.operator || '' },
    { label: '设备编号', value: img.deviceId || '' },
  ]
  return items.filter(i => i.value)
})

// ==================== 工具函数 ====================
function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text) as string
}

const renderedStream = computed(() => renderMarkdown(streamText.value))

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').substring(0, 19)
}

function formatGps(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return ''
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

function onImgError(e: Event) {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
}

// ==================== 生命周期 ====================
onMounted(() => {
  loadFolders()
  loadImages()
})

onBeforeUnmount(() => {
  if (analyzing.value) {
    abortController?.abort()
    abortController = null
  }
})
</script>

<template>
  <div class="image-page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <h2>📷 图片采集管理</h2>
        <span class="toolbar-sub">上传图片 · AI 智能分析墒情与病虫害</span>
      </div>
      <div class="toolbar-right">
        <el-button type="primary" size="small" @click="openFolderDialog">＋ 新建目录</el-button>
      </div>
    </div>

    <!-- 目录筛选栏 -->
    <div class="folder-bar">
      <button :class="['folder-chip', { active: activeFolderId === null }]" @click="switchFolder(null)">
        🗂 全部图片
      </button>
      <button
        v-for="f in folders"
        :key="f.id"
        :class="['folder-chip', { active: activeFolderId === f.id }]"
        @click="switchFolder(f.id)"
      >
        📁 {{ f.name }}
        <span class="folder-del" title="删除目录" @click.stop="confirmDeleteFolder(f)">✕</span>
      </button>
    </div>

    <!-- 上传卡片 -->
    <div class="card upload-card">
      <div class="upload-layout">
        <div
          :class="['dropzone', { dragOver, uploading }]"
          @click="!uploading && fileInput?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <template v-if="!uploading">
            <div class="dz-icon">🖼️</div>
            <div class="dz-main">拖拽图片到此处，或点击选择文件</div>
            <div class="dz-sub">支持多选 · JPG / PNG / WEBP · 自动提取 EXIF 拍摄信息</div>
          </template>
          <template v-else>
            <div class="dz-icon spinning">⏳</div>
            <div class="dz-main">正在上传 {{ uploadDone }} / {{ uploadTotal }} 张…</div>
            <div class="dz-sub">请稍候，上传完成后自动刷新列表</div>
          </template>
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFileChange" />
        </div>

        <div class="upload-options">
          <div class="opt-row">
            <div class="opt-field">
              <span class="opt-label">归档目录</span>
              <el-select
                v-model="uploadForm.folderId"
                size="small"
                clearable
                placeholder="默认（未分类）"
                style="width: 100%"
              >
                <el-option v-for="f in folders" :key="f.id" :label="f.name" :value="f.id" />
              </el-select>
            </div>
            <div class="opt-field">
              <span class="opt-label">备注</span>
              <el-input v-model="uploadForm.remark" size="small" placeholder="如：3号区巡检照片" maxlength="200" />
            </div>
          </div>

          <el-collapse v-model="advancedOpen" class="advanced-collapse">
            <el-collapse-item title="田块领域上下文（可选，随图传给 AI 提升分析准确度）" name="ctx">
              <div class="advanced-grid">
                <div class="adv-field">
                  <span class="adv-label">地块编号</span>
                  <el-input v-model="uploadForm.plotCode" size="small" placeholder="如 A-01" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">作物类型</span>
                  <el-input v-model="uploadForm.cropType" size="small" placeholder="如 苹果" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">土壤类型</span>
                  <el-input v-model="uploadForm.soilType" size="small" placeholder="如 壤土" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">生育期</span>
                  <el-input v-model="uploadForm.growthStage" size="small" placeholder="如 膨果期" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">灌溉状态</span>
                  <el-input v-model="uploadForm.irrigationStatus" size="small" placeholder="如 灌溉后2天" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">采样深度</span>
                  <el-input v-model="uploadForm.samplingDepth" size="small" placeholder="如 20cm" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">拍摄条件</span>
                  <el-input v-model="uploadForm.captureCondition" size="small" placeholder="如 晴天上午" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">操作人</span>
                  <el-input v-model="uploadForm.operator" size="small" placeholder="如 张三" />
                </div>
                <div class="adv-field">
                  <span class="adv-label">设备编号</span>
                  <el-input v-model="uploadForm.deviceId" size="small" placeholder="如 CAM-001" />
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>
    </div>

    <!-- 图片库 -->
    <div class="card gallery-card">
      <div class="card-header">
        <h3>
          🖼️ 图片库
          <span class="count-pill" v-if="total > 0">{{ total }}</span>
        </h3>
        <div class="gallery-tools">
          <template v-if="selectedIds.length > 0">
            <span class="sel-count">已选 <b>{{ selectedIds.length }}</b> 张</span>
            <el-button size="small" type="primary" plain :loading="batchBusy" @click="openMoveDialog">
              📁 批量归档
            </el-button>
            <el-button size="small" type="danger" plain :loading="batchBusy" @click="confirmBatchDelete">
              🗑 批量删除
            </el-button>
            <el-button size="small" link @click="clearSelection">取消选择</el-button>
          </template>
          <template v-else>
            <el-button v-if="records.length > 0" size="small" plain @click="toggleSelectAll">全选本页</el-button>
            <span class="hint-text">点击图片卡片进入 AI 智能分析 · 左上角勾选可批量管理</span>
          </template>
        </div>
      </div>

      <div v-loading="galleryLoading" class="gallery-wrap">
        <div class="gallery-grid">
          <div
            v-for="img in records"
            :key="img.id"
            :class="['img-card', { selected: isSelected(img.id) }]"
            @click="openDrawer(img)"
          >
            <div class="img-thumb">
              <img :src="imageFileUrl(img.id)" :alt="img.originalName" loading="lazy" @error="onImgError" />
              <span
                :class="['pick-box', { on: isSelected(img.id) }]"
                title="选择该图片"
                @click.stop="toggleSelect(img.id)"
              >
                {{ isSelected(img.id) ? '✓' : '' }}
              </span>
              <span :class="['state-badge', img.analyzed ? 'ok' : 'pending']">
                {{ img.analyzed ? '✅ 已分析' : '未分析' }}
              </span>
              <div class="thumb-ops">
                <span class="thumb-op" title="归档到目录" @click.stop="openMoveSingle(img)">📁</span>
                <span class="thumb-op danger" title="删除图片" @click.stop="confirmDeleteImage(img)">🗑</span>
              </div>
            </div>
            <div class="img-info">
              <div class="img-name" :title="img.originalName">{{ img.originalName }}</div>
              <div class="img-meta">
                {{ formatSize(img.size) }}
                <template v-if="img.width && img.height"> · {{ img.width }}×{{ img.height }}</template>
              </div>
              <div class="img-time">
                {{ formatTime(img.createdAt) }}
                <template v-if="img.folderId != null">
                  · {{ folders.find(f => f.id === img.folderId)?.name || '已归档' }}
                </template>
              </div>
            </div>
          </div>
        </div>
        <div v-if="records.length === 0 && !galleryLoading" class="empty-state">
          📭 暂无图片，拖拽文件到上方上传区开始使用
        </div>
      </div>

      <div v-if="total > size" class="pagination-row">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="size"
          :current-page="page + 1"
          @current-change="onPageChange"
        />
      </div>
    </div>

    <!-- AI 分析抽屉 -->
    <el-drawer v-model="drawerVisible" size="640px" :close-on-click-modal="false" @closed="onDrawerClosed">
      <template #header>
        <div class="drawer-title">🔍 AI 图片分析</div>
      </template>

      <div v-if="currentImage" class="drawer-body">
        <!-- 图片预览 -->
        <div class="preview-box">
          <img :src="imageFileUrl(currentImage.id)" :alt="currentImage.originalName" />
        </div>

        <!-- 归档 / 删除 -->
        <div class="img-ops">
          <span class="ops-label">归档到</span>
          <el-select
            :model-value="currentImage.folderId"
            size="small"
            clearable
            placeholder="未分类（不归档）"
            style="width: 180px"
            @change="onDrawerFolderChange"
          >
            <el-option v-for="f in folders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
          <span class="ops-tip">切换目录即时生效 · 删除图片会一并清除其分析结论</span>
          <el-button class="ops-del" type="danger" plain size="small" @click="confirmDeleteImage(currentImage)">
            🗑 删除图片
          </el-button>
        </div>

        <!-- 元数据 -->
        <el-descriptions title="文件信息" :column="2" border size="small" class="meta-desc">
          <el-descriptions-item v-for="item in fileMetaItems" :key="item.label" :label="item.label">
            {{ item.value }}
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="exifItems.length" title="拍摄信息（EXIF）" :column="2" border size="small" class="meta-desc">
          <el-descriptions-item v-for="item in exifItems" :key="item.label" :label="item.label">
            {{ item.value }}
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-if="fieldItems.length" title="田块领域上下文" :column="2" border size="small" class="meta-desc">
          <el-descriptions-item v-for="item in fieldItems" :key="item.label" :label="item.label">
            {{ item.value }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 分析操作 -->
        <div class="analyze-section">
          <div class="section-header">
            <h4>🤖 AI 智能分析</h4>
            <div class="section-actions">
              <template v-if="!analyzing">
                <el-button type="primary" size="small" @click="startAnalysis">
                  {{ streamDone ? '重新分析' : '开始分析' }}
                </el-button>
              </template>
              <template v-else>
                <span class="analyzing-hint">分析中，结论实时返回…</span>
                <el-button type="danger" size="small" plain @click="stopAnalysis">停止</el-button>
              </template>
            </div>
          </div>
          <el-input
            v-model="analysisPrompt"
            type="textarea"
            :rows="2"
            resize="none"
            :disabled="analyzing"
            placeholder="自定义分析提示词（留空使用默认：分析墒情、湿度、灌溉需求与病虫害风险并给出建议）"
          />

          <div v-if="analyzing || streamDone || streamError" ref="streamBox" class="stream-box">
            <div v-if="streamError" class="stream-error">❌ {{ streamError }}</div>
            <template v-else>
              <div class="md-content" v-html="renderedStream"></div>
              <span v-if="analyzing" class="stream-cursor"></span>
              <div v-if="streamDone && !analyzing" class="stream-done">✔ 分析完成，结论已自动保存到分析历史</div>
            </template>
          </div>
        </div>

        <!-- 分析历史 -->
        <div class="history-section">
          <div class="section-header">
            <h4>📜 分析历史（{{ analyses.length }}）</h4>
            <el-button link type="primary" size="small" @click="loadAnalyses(currentImage.id)">刷新</el-button>
          </div>
          <div v-loading="analysesLoading" class="history-list">
            <div v-for="a in analyses" :key="a.id" class="history-item">
              <div class="history-row" @click="toggleHistory(a.id)">
                <span class="history-time">{{ formatTime(a.createdAt) }}</span>
                <el-tag size="small" :type="a.status === 'DONE' ? 'success' : 'info'">
                  {{ a.status === 'DONE' ? '完成' : (a.status || '—') }}
                </el-tag>
                <span class="history-expand">{{ expandedAnalysisId === a.id ? '收起 ▲' : '展开 ▼' }}</span>
              </div>
              <div v-if="expandedAnalysisId === a.id" class="history-detail">
                <div v-if="a.prompt" class="history-prompt">提示词：{{ a.prompt }}</div>
                <div class="md-content" v-html="renderMarkdown(a.conclusion || '（无结论）')"></div>
              </div>
            </div>
            <div v-if="analyses.length === 0 && !analysesLoading" class="empty-small">
              暂无分析记录，点击「开始分析」生成第一份结论
            </div>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 归档对话框（单张 / 批量共用） -->
    <el-dialog v-model="moveDialogVisible" title="图片归档" width="460px" :close-on-click-modal="false">
      <div class="folder-form">
        <div class="move-summary">
          将对 <b>{{ moveCount }}</b> 张图片{{ moveSingle ? '' : '（已选中）' }}执行归档
        </div>
        <div class="form-row">
          <span class="form-label">目标目录</span>
          <el-select
            v-model="moveTargetFolderId"
            clearable
            placeholder="未分类（移出目录）"
            style="width: 100%"
          >
            <el-option v-for="f in folders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
        </div>
        <div class="move-tip">
          不选目录即移出到「未分类」，仅调整归属关系，不会删除图片文件与分析结论。
        </div>
      </div>
      <template #footer>
        <el-button @click="moveDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchBusy" @click="confirmMove">确认归档</el-button>
      </template>
    </el-dialog>

    <!-- 新建目录对话框 -->
    <el-dialog v-model="folderDialogVisible" title="新建图片目录" width="440px" :close-on-click-modal="false">
      <div class="folder-form">
        <div class="form-row">
          <span class="form-label">目录名称</span>
          <el-input v-model="newFolderName" placeholder="如：1号果园 · 病虫害巡检" maxlength="32" @keyup.enter="saveNewFolder" />
        </div>
        <div class="form-row">
          <span class="form-label">父目录</span>
          <el-select v-model="newFolderParentId" clearable placeholder="根目录（默认）" style="width: 100%">
            <el-option v-for="f in folders" :key="f.id" :label="f.name" :value="f.id" />
          </el-select>
        </div>
      </div>
      <template #footer>
        <el-button @click="folderDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="folderSaving" @click="saveNewFolder">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.image-page {
  min-height: calc(100vh - 180px);
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 12px;
}
.toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.toolbar-left h2 {
  font-size: 1.2rem;
  color: #2e7d32;
  font-weight: 600;
}
.toolbar-sub {
  font-size: 0.8rem;
  color: #90a4ae;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}

/* 目录筛选栏 */
.folder-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  overflow-x: auto;
  padding-bottom: 6px;
  flex-wrap: wrap;
}
.folder-bar::-webkit-scrollbar {
  height: 4px;
}
.folder-bar::-webkit-scrollbar-thumb {
  background: #c8e6c9;
  border-radius: 2px;
}
.folder-chip {
  background: #fff;
  border: 1.5px solid #e0e0e0;
  border-radius: 20px;
  padding: 6px 16px;
  font-size: 0.85rem;
  color: #546e7a;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.folder-chip:hover {
  border-color: #a5d6a7;
  color: #2e7d32;
}
.folder-chip.active {
  background: linear-gradient(135deg, #e8f5e9, #f1f8e9);
  border-color: #43a047;
  color: #2e7d32;
  font-weight: 600;
}
.folder-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 0.65rem;
  color: #b0bec5;
  transition: all 0.15s;
}
.folder-del:hover {
  background: #ffebee;
  color: #c62828;
}

/* 卡片通用 */
.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
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
}
.card-header h3 {
  font-size: 1.05rem;
  color: #2e7d32;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.count-pill {
  background: #e8f5e9;
  color: #2e7d32;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 1px 10px;
  border-radius: 10px;
}
.hint-text {
  font-size: 0.78rem;
  color: #90a4ae;
}

/* 图片库工具栏（批量操作） */
.gallery-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.sel-count {
  font-size: 0.78rem;
  color: #607d8b;
}
.sel-count b {
  color: #2e7d32;
  font-size: 0.88rem;
}

/* 上传卡片 */
.upload-layout {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 20px;
}
.dropzone {
  border: 2px dashed #c8e6c9;
  border-radius: 12px;
  background: #fafdf9;
  padding: 28px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 170px;
}
.dropzone:hover {
  border-color: #81c784;
  background: #f1f8e9;
}
.dropzone.dragover {
  border-color: #43a047;
  background: #e8f5e9;
  transform: scale(1.01);
}
.dropzone.uploading {
  cursor: not-allowed;
  border-color: #a5d6a7;
}
.dz-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}
.dz-icon.spinning {
  animation: pulse 1.2s ease-in-out infinite;
}
.dz-main {
  font-size: 0.92rem;
  font-weight: 600;
  color: #37474f;
}
.dz-sub {
  font-size: 0.75rem;
  color: #90a4ae;
  margin-top: 6px;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.upload-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.opt-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 12px;
}
.opt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.opt-label {
  font-size: 0.8rem;
  color: #607d8b;
  font-weight: 600;
}

.advanced-collapse {
  border: none;
}
.advanced-collapse :deep(.el-collapse-item__header) {
  font-size: 0.8rem;
  color: #607d8b;
  background: transparent;
  border-bottom: none;
  height: 36px;
}
.advanced-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}
.advanced-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 4px;
}
.advanced-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.adv-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.adv-label {
  font-size: 0.75rem;
  color: #90a4ae;
}

/* 图片网格 */
.gallery-wrap {
  min-height: 160px;
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
}
.img-card {
  background: #fff;
  border: 1.5px solid #eceff1;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
}
.img-card:hover {
  border-color: #a5d6a7;
  box-shadow: 0 4px 14px rgba(76, 175, 80, 0.18);
  transform: translateY(-2px);
}
.img-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  background: #f5f7f5;
  overflow: hidden;
}
.img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.state-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  backdrop-filter: blur(4px);
}
.state-badge.ok {
  background: rgba(232, 245, 233, 0.92);
  color: #2e7d32;
}
.state-badge.pending {
  background: rgba(255, 253, 231, 0.92);
  color: #9e9d24;
}
.img-info {
  padding: 10px 12px;
}
.img-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #37474f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.img-meta {
  font-size: 0.72rem;
  color: #90a4ae;
  margin-top: 3px;
}
.img-time {
  font-size: 0.7rem;
  color: #b0bec5;
  margin-top: 1px;
}

/* 选择框 */
.pick-box {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.28);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.15s;
  z-index: 2;
}
.img-card:hover .pick-box {
  opacity: 1;
}
.pick-box.on {
  opacity: 1;
  background: #43a047;
  border-color: #fff;
}
.img-card.selected {
  border-color: #43a047;
  box-shadow: 0 4px 14px rgba(76, 175, 80, 0.28);
}

/* 缩略图悬浮操作 */
.thumb-ops {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 2;
}
.img-card:hover .thumb-ops {
  opacity: 1;
}
.thumb-op {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.94);
  font-size: 0.82rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: all 0.15s;
}
.thumb-op:hover {
  background: #e8f5e9;
  transform: scale(1.08);
}
.thumb-op.danger:hover {
  background: #ffebee;
}

.pagination-row {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

/* 抽屉 */
.drawer-title {
  font-size: 1rem;
  font-weight: 600;
  color: #2e7d32;
}
.drawer-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.preview-box {
  background: #f5f7f5;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 300px;
}
.preview-box img {
  max-width: 100%;
  max-height: 280px;
  object-fit: contain;
  border-radius: 6px;
}

/* 抽屉内归档 / 删除 */
.img-ops {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: #fafdf9;
  border: 1px solid #e8f5e9;
  border-radius: 10px;
  padding: 10px 14px;
}
.ops-label {
  font-size: 0.82rem;
  color: #607d8b;
  font-weight: 600;
}
.ops-tip {
  font-size: 0.72rem;
  color: #b0bec5;
  flex: 1;
  min-width: 120px;
}
.ops-del {
  margin-left: auto;
}
.meta-desc {
  margin-top: 0;
}

/* 分析区 */
.analyze-section {
  background: #fafdf9;
  border: 1px solid #e8f5e9;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-header h4 {
  font-size: 0.9rem;
  color: #2e7d32;
  font-weight: 600;
}
.section-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.analyzing-hint {
  font-size: 0.75rem;
  color: #9e9d24;
}

.stream-box {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px 14px;
  max-height: 300px;
  overflow-y: auto;
  font-size: 0.85rem;
  line-height: 1.7;
  color: #37474f;
}
.stream-error {
  color: #c62828;
}
.stream-done {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #c8e6c9;
  color: #2e7d32;
  font-size: 0.78rem;
  font-weight: 600;
}
.stream-cursor {
  display: inline-block;
  width: 8px;
  height: 15px;
  background: #43a047;
  margin-left: 3px;
  vertical-align: text-bottom;
  animation: blink 0.9s infinite;
}
@keyframes blink {
  0%,
  60% {
    opacity: 1;
  }
  61%,
  100% {
    opacity: 0;
  }
}

/* markdown 内容渲染 */
.md-content :deep(p) {
  margin: 6px 0;
}
.md-content :deep(ul),
.md-content :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}
.md-content :deep(li) {
  margin: 2px 0;
}
.md-content :deep(h1),
.md-content :deep(h2),
.md-content :deep(h3),
.md-content :deep(h4) {
  margin: 10px 0 6px;
  color: #2e7d32;
  font-size: 0.95rem;
}
.md-content :deep(strong) {
  color: #1b5e20;
}
.md-content :deep(code) {
  background: #f1f8e9;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.82em;
}
.md-content :deep(pre) {
  background: #f6f8f6;
  padding: 10px;
  border-radius: 8px;
  overflow-x: auto;
}
.md-content :deep(blockquote) {
  border-left: 3px solid #a5d6a7;
  padding-left: 10px;
  color: #607d8b;
  margin: 6px 0;
}
.md-content :deep(table) {
  border-collapse: collapse;
  margin: 6px 0;
}
.md-content :deep(th),
.md-content :deep(td) {
  border: 1px solid #e0e0e0;
  padding: 4px 8px;
  font-size: 0.8rem;
}

/* 历史记录 */
.history-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-list {
  min-height: 40px;
}
.history-item {
  border: 1px solid #eceff1;
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  background: #fff;
  transition: background 0.15s;
}
.history-row:hover {
  background: #f7faf7;
}
.history-time {
  font-size: 0.78rem;
  color: #546e7a;
  font-weight: 600;
}
.history-expand {
  margin-left: auto;
  font-size: 0.72rem;
  color: #90a4ae;
}
.history-detail {
  border-top: 1px dashed #eceff1;
  padding: 10px 12px;
  background: #fafdf9;
}
.history-prompt {
  font-size: 0.75rem;
  color: #90a4ae;
  margin-bottom: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 空状态 */
.empty-state {
  text-align: center;
  color: #b0bec5;
  font-size: 0.9rem;
  padding: 48px 0;
}
.empty-small {
  text-align: center;
  color: #b0bec5;
  font-size: 0.85rem;
  padding: 20px 0;
}

/* 新建目录表单 */
.folder-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-label {
  font-size: 0.85rem;
  color: #607d8b;
  font-weight: 600;
}
.move-summary {
  font-size: 0.85rem;
  color: #37474f;
}
.move-summary b {
  color: #2e7d32;
  font-size: 1rem;
}
.move-tip {
  font-size: 0.75rem;
  color: #90a4ae;
  line-height: 1.5;
}

/* 响应式 */
@media (max-width: 1000px) {
  .upload-layout {
    grid-template-columns: 1fr;
  }
  .advanced-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .opt-row {
    grid-template-columns: 1fr;
  }
}
</style>
