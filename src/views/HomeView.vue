<script setup lang="ts">
import { Plus, DataAnalysis, Setting, Document } from '@element-plus/icons-vue'
</script>

<template>
  <div class="home">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>欢迎使用 LightAI 苹果智慧果园管理系统</span>
        </div>
      </template>
      <el-row :gutter="20">
        <el-col :span="8">
          <el-statistic title="设备总数" :value="128" prefix="个" />
        </el-col>
        <el-col :span="8">
          <el-statistic title="在线设备" :value="115" prefix="个">
            <template #suffix>
              <el-tag type="success" size="small">89.8%</el-tag>
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8">
          <el-statistic title="今日用水量" :value="2560" prefix="L">
            <template #suffix>
              <el-tag type="primary" size="small">正常</el-tag>
            </template>
          </el-statistic>
        </el-col>
      </el-row>
    </el-card>

    <el-card style="margin-top: 20px">
      <template #header>
        <div class="card-header">
          <span>快速操作</span>
        </div>
      </template>
      <el-space wrap>
        <el-button type="primary" :icon="Plus">添加设备</el-button>
        <el-button type="success" :icon="DataAnalysis">数据概览</el-button>
        <el-button type="warning" :icon="Setting">系统设置</el-button>
        <el-button type="info" :icon="Document">查看日志</el-button>
      </el-space>
    </el-card>
  </div>
</template>

<style scoped>
.card-header {
  font-size: 16px;
  font-weight: 600;
}
</style>