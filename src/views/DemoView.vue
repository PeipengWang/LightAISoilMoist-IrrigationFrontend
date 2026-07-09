<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Edit, Delete } from '@element-plus/icons-vue'

interface Device {
  id: number
  name: string
  location: string
  moisture: number
  status: 'online' | 'offline' | 'warning'
  createTime: string
}

const tableData = ref<Device[]>([
  { id: 1, name: '传感器-A01', location: '1号大棚', moisture: 75.5, status: 'online', createTime: '2026-06-15 08:30' },
  { id: 2, name: '传感器-A02', location: '1号大棚', moisture: 62.3, status: 'online', createTime: '2026-06-15 08:35' },
  { id: 3, name: '传感器-B01', location: '2号大棚', moisture: 45.8, status: 'warning', createTime: '2026-06-16 09:00' },
  { id: 4, name: '传感器-B02', location: '2号大棚', moisture: 80.1, status: 'online', createTime: '2026-06-16 09:10' },
  { id: 5, name: '传感器-C01', location: '3号大棚', moisture: 0, status: 'offline', createTime: '2026-06-17 10:00' },
])

const searchForm = reactive({
  name: '',
  status: '',
})

const dialogVisible = ref(false)
const dialogTitle = ref('新增设备')
const formRef = ref()
const form = reactive<Device>({
  id: 0,
  name: '',
  location: '',
  moisture: 0,
  status: 'online',
  createTime: '',
})
let nextId = 6

const filteredData = ref<Device[]>([])

function handleSearch() {
  filteredData.value = tableData.value.filter(item => {
    const matchName = !searchForm.name || item.name.includes(searchForm.name)
    const matchStatus = !searchForm.status || item.status === searchForm.status
    return matchName && matchStatus
  })
}

function handleReset() {
  searchForm.name = ''
  searchForm.status = ''
  filteredData.value = []
}

function handleAdd() {
  dialogTitle.value = '新增设备'
  Object.assign(form, {
    id: 0,
    name: '',
    location: '',
    moisture: 0,
    status: 'online' as const,
    createTime: '',
  })
  dialogVisible.value = true
}

function handleEdit(row: Device) {
  dialogTitle.value = '编辑设备'
  Object.assign(form, { ...row })
  dialogVisible.value = true
}

function handleDelete(row: Device) {
  ElMessageBox.confirm(`确定要删除「${row.name}」吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    tableData.value = tableData.value.filter(item => item.id !== row.id)
    ElMessage.success('删除成功')
  }).catch(() => {})
}

function handleSubmit() {
  formRef.value?.validate((valid: boolean) => {
    if (!valid) return

    if (form.id === 0) {
      // 新增
      form.id = nextId++
      form.createTime = new Date().toLocaleString('zh-CN', { hour12: false })
      tableData.value.unshift({ ...form })
      ElMessage.success('新增成功')
    } else {
      // 更新
      const idx = tableData.value.findIndex(item => item.id === form.id)
      if (idx > -1) {
        tableData.value[idx] = { ...form }
        ElMessage.success('更新成功')
      }
    }
    dialogVisible.value = false
  })
}

function getStatusType(status: string) {
  const map: Record<string, string> = {
    online: 'success',
    offline: 'info',
    warning: 'warning',
  }
  return map[status] || 'info'
}

function getStatusText(status: string) {
  const map: Record<string, string> = {
    online: '在线',
    offline: '离线',
    warning: '预警',
  }
  return map[status] || status
}

const formRules = {
  name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }],
  location: [{ required: true, message: '请输入安装位置', trigger: 'blur' }],
  moisture: [{ required: true, message: '请输入土壤湿度', trigger: 'blur' }],
}
</script>

<template>
  <div class="demo-page">
    <!-- 搜索区域 -->
    <el-card class="search-card">
      <el-form :model="searchForm" inline>
        <el-form-item label="设备名称">
          <el-input v-model="searchForm.name" placeholder="请输入" clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable style="width: 140px">
            <el-option label="在线" value="online" />
            <el-option label="离线" value="offline" />
            <el-option label="预警" value="warning" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 操作按钮 + 表格 -->
    <el-card style="margin-top: 16px">
      <div class="toolbar">
        <el-button type="primary" :icon="Plus" @click="handleAdd">新增设备</el-button>
      </div>

      <el-table
        :data="filteredData.length > 0 || searchForm.name || searchForm.status ? filteredData : tableData"
        stripe
        border
        style="width: 100%; margin-top: 12px"
      >
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="name" label="设备名称" min-width="140" />
        <el-table-column prop="location" label="安装位置" min-width="120" />
        <el-table-column prop="moisture" label="土壤湿度 (%)" width="130" align="center">
          <template #default="{ row }">
            <el-progress
              :percentage="row.moisture"
              :color="row.moisture > 70 ? '#67c23a' : row.moisture > 40 ? '#e6a23c' : '#f56c6c'"
              :stroke-width="16"
            />
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="170" />
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link :icon="Edit" @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" link :icon="Delete" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item label="设备名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入设备名称" />
        </el-form-item>
        <el-form-item label="安装位置" prop="location">
          <el-input v-model="form.location" placeholder="请输入安装位置" />
        </el-form-item>
        <el-form-item label="土壤湿度" prop="moisture">
          <el-input-number v-model="form.moisture" :min="0" :max="100" :precision="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="在线" value="online" />
            <el-option label="离线" value="offline" />
            <el-option label="预警" value="warning" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.search-card {
  margin-bottom: 0;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>