<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, nextTick } from 'vue'
import { useSessionStore } from './stores/sessions'
import { useUsageStore } from './stores/usage'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { getLogicalWindowState, getExpandDirection, animateWindowResize } from './composables/useWindowLayout'
import TabBar from './components/TabBar.vue'
import ChatHistory from './components/ChatHistory.vue'
import UsageDrawer from './components/UsageDrawer.vue'
import InputToolbar from './components/InputToolbar.vue'

const store = useSessionStore()
const usageStore = useUsageStore()
const expanded = ref(false)
const usageDrawerOpen = ref(false)
const animating = ref(false)
const collapsedEl = ref<HTMLDivElement>()

const sessionColor = computed(() => store.activeSession?.color ?? '#007acc')

const WIN_W = 620
const BASE_COLLAPSED_H = 100
const EXPANDED_H = 680

function measureCollapsedHeight(): number {
  const el = collapsedEl.value
  if (!el) return BASE_COLLAPSED_H
  return Math.max(el.offsetHeight + 12, BASE_COLLAPSED_H)
}

onMounted(async () => {
  store.setupEventListeners()
  usageStore.init()
  await nextTick()
  const h = measureCollapsedHeight()
  await getCurrentWindow().setSize(new LogicalSize(WIN_W, h))
})

onUnmounted(() => {
  usageStore.cleanup()
})

function toggleUsageDrawer() {
  usageDrawerOpen.value = !usageDrawerOpen.value
}

async function toggleExpand() {
  if (animating.value) return
  animating.value = true

  try {
    const { x, y, h } = await getLogicalWindowState()
    const direction = await getExpandDirection()

    if (!expanded.value) {
      expanded.value = true
      await nextTick()
      const targetY = direction === 'up' ? Math.max(y + h - EXPANDED_H, 0) : y
      await animateWindowResize(WIN_W, EXPANDED_H, x, targetY, 200)
    } else {
      const targetH = BASE_COLLAPSED_H
      const targetY = direction === 'up' ? Math.max(y + h - targetH, 0) : y + h - targetH
      await animateWindowResize(WIN_W, targetH, x, targetY, 180)
      expanded.value = false
      await nextTick()
      const actualH = measureCollapsedHeight()
      if (Math.abs(actualH - targetH) > 2) {
        await getCurrentWindow().setSize(new LogicalSize(WIN_W, actualH))
      }
    }
  } finally {
    animating.value = false
  }
}

async function fitCollapsedHeight() {
  await nextTick()
  const h = measureCollapsedHeight()
  await getCurrentWindow().setSize(new LogicalSize(WIN_W, h))
}

async function onCollapsedResize() {
  if (!expanded.value && !animating.value) {
    await fitCollapsedHeight()
  }
}

async function hideWindow() {
  await getCurrentWindow().minimize()
}

let dragTimeout: ReturnType<typeof setTimeout> | null = null

function onDragStart(e: MouseEvent) {
  e.preventDefault()
  dragTimeout = setTimeout(() => {
    getCurrentWindow().startDragging()
  }, 80)
}

function onDragEnd() {
  if (dragTimeout) {
    clearTimeout(dragTimeout)
    dragTimeout = null
  }
}

function onPanelDragStart(e: MouseEvent) {
  e.preventDefault()
  getCurrentWindow().startDragging()
}

function cycleSession() {
  const vis = store.visibleSessions
  if (vis.length <= 1) return
  const idx = vis.findIndex(s => s.id === store.activeSessionId)
  const i = idx < 0 ? 0 : idx
  const next = (i + 1) % vis.length
  store.activeSessionId = vis[next]!.id
}
</script>

<template>
  <div class="flex flex-col bg-transparent overflow-hidden h-full">
    <!-- History panel (only when expanded) -->
    <div v-if="expanded" class="flex-1 min-h-0 flex gap-2 pl-[50px] pr-1.5 pt-1.5">
      <div
        class="flex-1 min-w-0 flex flex-col rounded-t-xl overflow-hidden"
        :style="{
          background: '#1e1f22',
          boxShadow: `0 0 0 1px ${sessionColor}50, 0 0 10px ${sessionColor}25, 0 0 25px ${sessionColor}10`,
        }"
      >
        <TabBar :usage-open="usageDrawerOpen" @drag-start="onPanelDragStart" @toggle-usage="toggleUsageDrawer" />
        <UsageDrawer v-if="usageDrawerOpen" />
        <ChatHistory class="flex-1 min-h-0" />
      </div>
    </div>

    <!-- Spacer when collapsed (pushes input to bottom) -->
    <div v-if="!expanded" class="flex-1" />

    <!-- Input bar (always mounted — preserves text/images across expand/collapse) -->
    <div ref="collapsedEl" class="p-1.5" :class="{ 'pt-0': expanded }">
      <InputToolbar
        :session-color="sessionColor"
        :history-open="expanded"
        @toggle-expand="toggleExpand"
        @hide="hideWindow"
        @drag-start="onDragStart"
        @drag-end="onDragEnd"
        @cycle-session="cycleSession"
        @content-resize="onCollapsedResize"
      />
    </div>
  </div>
</template>
