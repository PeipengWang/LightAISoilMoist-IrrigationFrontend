<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useDeviceStore } from '../stores/devices'
import { onMounted, onUnmounted } from 'vue'

const router = useRouter()
const route = useRoute()
const store = useDeviceStore()

const tabs = [
  { key: 'realtime', label: '实时数据监测', icon: '📡' },
  { key: 'history', label: '历史数据分析', icon: '📊' },
  { key: 'decision', label: '智能决策管理', icon: '🧠' },
]

function activeTab(): string {
  const name = route.name as string
  return name ? name.toLowerCase() : 'realtime'
}

function switchTab(key: string) {
  router.push(`/${key}`)
}

onMounted(() => {
  store.init()
})

onUnmounted(() => {
  store.destroy()
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>🍎 LightAI 苹果智慧果园管理系统</h1>
        <div class="subtitle">多要素环境监测 · 智能决策管控</div>
      </div>
      <div class="status">
        <span class="status-dot" :class="{ online: store.online, offline: !store.online }"></span>
        <span>{{ store.statusText }}</span>
      </div>
    </header>

    <nav class="tab-nav">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab() === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ tab.icon }} {{ tab.label }}
      </button>
    </nav>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
:root {
  --bg: #f0f4f0;
  --card-bg: #ffffff;
  --primary: #2e7d32;
  --primary-light: #e8f5e9;
  --accent: #1565c0;
  --danger: #c62828;
  --warning: #f57f17;
  --text: #263238;
  --text-secondary: #607d8b;
  --border: #e0e0e0;
  --shadow: 0 2px 8px rgba(0,0,0,0.08);
  --radius: 12px;
}

.app-shell {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

/* Header */
.app-header {
  background: linear-gradient(135deg, #1b5e20, #2e7d32, #388e3c);
  color: #fff;
  padding: 16px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
  position: sticky;
  top: 0;
  z-index: 100;
}

.app-header h1 {
  font-size: 1.4rem;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.subtitle {
  font-size: 0.85rem;
  opacity: 0.85;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.online {
  background: #69f0ae;
  box-shadow: 0 0 6px #69f0ae;
}

.status-dot.offline {
  background: #ff5252;
}

/* Tab Nav */
.tab-nav {
  background: var(--card-bg);
  border-bottom: 2px solid var(--border);
  display: flex;
  gap: 0;
  padding: 0 24px;
  position: sticky;
  top: 72px;
  z-index: 99;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.tab-btn {
  padding: 14px 28px;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--primary);
  background: var(--primary-light);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}

/* Main */
.app-main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 24px;
}

@media (max-width: 900px) {
  .app-header {
    padding: 12px 16px;
  }

  .app-header h1 {
    font-size: 1.1rem;
  }

  .app-main {
    padding: 12px;
  }

  .tab-btn {
    padding: 12px 16px;
    font-size: 0.85rem;
  }
}
</style>