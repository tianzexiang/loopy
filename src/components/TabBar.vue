<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '../stores/sessions'
import { shortDirName } from '../utils/helpers'
import type { Session } from '../types'

const emit = defineEmits<{
  dragStart: [e: MouseEvent]
}>()

const store = useSessionStore()

const tabs = computed(() => store.visibleSessions)

const TAB_MAX = 180
const TAB_MIN = 40
const ACTIVE_BONUS = 60

const activeFlexGrow = computed(() => {
  const count = tabs.value.length
  if (count <= 1) return 1
  if (count <= 3) return 2
  return 3
})

function tabStyle(s: Session) {
  const isActive = store.activeSessionId === s.id
  return {
    flexGrow: isActive ? activeFlexGrow.value : 1,
    flexShrink: isActive ? 0 : 1,
    flexBasis: '0%',
    maxWidth: isActive ? `${TAB_MAX + ACTIVE_BONUS}px` : `${TAB_MAX}px`,
    minWidth: `${TAB_MIN}px`,
    background: isActive ? '#1e1f22' : 'transparent',
    color: isActive ? '#ddd' : (s.connected ? '#888' : '#555'),
    borderBottom: isActive ? `2px solid ${s.color}` : '2px solid transparent',
    opacity: s.connected ? 1 : 0.5,
  }
}

function tabLabel(s: Session): string {
  if (s.label && s.label.length > 1) return s.label
  return shortDirName(s.projectDirectory) || 'Session'
}
</script>

<template>
  <div
    class="flex items-center px-1.5 py-1 shrink-0 select-none cursor-default overflow-hidden"
    style="border-bottom: 1px solid #333; background: #2b2d31; min-height: 32px;"
    @mousedown.left="emit('dragStart', $event)"
  >
    <template v-if="tabs.length > 1">
      <button
        v-for="session in tabs"
        :key="session.id"
        class="group/tab flex items-center gap-1.5 px-2 py-1 rounded-t text-[11px] font-medium transition-all cursor-pointer overflow-hidden"
        :style="tabStyle(session)"
        @mousedown.stop
        @click="store.activeSessionId = session.id"
      >
        <div
          class="w-2 h-2 rounded-full shrink-0 relative"
          :style="{ background: session.connected ? session.color : '#555' }"
        >
          <div
            v-if="session.pendingRequest"
            class="absolute inset-0 rounded-full"
            :style="{ background: session.color, animation: 'breathe 2s ease-in-out infinite' }"
          />
        </div>
        <span class="truncate min-w-0 flex-1">{{ tabLabel(session) }}</span>
        <span
          v-if="!session.connected"
          class="text-[9px] text-[#666] shrink-0"
          title="Disconnected"
        >⊘</span>
        <span
          class="shrink-0 w-4 h-4 rounded flex items-center justify-center text-[#555] hover:text-[#f87171] hover:bg-[#f87171]/10 transition-all cursor-pointer"
          :class="store.activeSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'"
          @click.stop="store.removeSession(session.id)"
        >&times;</span>
      </button>
    </template>
    <span v-else />
  </div>
</template>
