<script setup lang="ts">
import { useUsageStore } from '../stores/usage'
import { open as shellOpen } from '@tauri-apps/plugin-shell'

const usage = useUsageStore()

function formatTokens(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

function truncModel(name: string, len = 22): string {
  return name.length > len ? name.slice(0, len - 2) + '..' : name
}

function progressPercent(): number {
  const s = usage.snapshot
  if (!s || s.includedLimit === 0) return 0
  return Math.min((s.includedUsed / s.includedLimit) * 100, 100)
}

function openDashboard() {
  shellOpen('https://cursor.com/cn/dashboard/usage')
}
</script>

<template>
  <div class="overflow-hidden" style="background: #1a1b1e; border-bottom: 1px solid #2a2a2a;">
    <!-- Countdown + actions row -->
    <div class="flex items-center justify-between px-3 py-2">
      <div class="flex items-center gap-2 text-[11px]">
        <span class="text-[#888]">距离重置</span>
        <span class="font-mono text-[#ccc]">{{ usage.resetCountdown || '--' }}</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="text-[10px] px-1.5 py-0.5 rounded text-[#888] hover:text-[#ccc] hover:bg-white/5 transition-colors cursor-pointer"
          :disabled="usage.loading"
          @click="usage.fetchUsage(true)"
        >
          刷新
        </button>
        <button
          class="text-[10px] px-1.5 py-0.5 rounded text-[#888] hover:text-[#ccc] hover:bg-white/5 transition-colors cursor-pointer"
          @click="openDashboard()"
        >
          查看全部 ↗
        </button>
      </div>
    </div>

    <!-- Summary -->
    <div class="px-3 pb-2 space-y-1.5">
      <div class="flex items-center justify-between text-[11px]">
        <span class="text-[#888]">Included Requests</span>
        <span class="font-mono text-[#ccc]">
          {{ usage.snapshot?.includedUsed ?? 0 }} / {{ usage.snapshot?.includedLimit ?? 0 }}
        </span>
      </div>
      <!-- Progress bar -->
      <div class="h-[4px] rounded-full overflow-hidden" style="background: #333;">
        <div
          class="h-full rounded-full transition-all duration-500"
          :style="{
            width: `${progressPercent()}%`,
            background: usage.statusColor,
          }"
        />
      </div>
      <div class="flex items-center justify-between text-[11px]">
        <span class="text-[#888]">On-Demand Usage</span>
        <span class="font-mono text-[#ccc]">${{ (usage.snapshot?.onDemandSpent ?? 0).toFixed(2) }}</span>
      </div>
    </div>

    <!-- Recent events -->
    <div
      v-if="usage.snapshot?.events?.length"
      class="border-t border-[#2a2a2a] max-h-[140px] overflow-y-auto"
    >
      <div
        v-for="(ev, i) in usage.snapshot!.events.slice(0, 8)"
        :key="i"
        class="flex items-center gap-2 px-3 py-1 text-[10px] hover:bg-white/[0.02] transition-colors"
      >
        <span
          class="w-[6px] h-[6px] rounded-sm shrink-0"
          :style="{ background: ev.requests > 0 ? '#4a8cc7' : '#444' }"
        />
        <span class="text-[#666] font-mono shrink-0 w-[76px]">{{ formatTime(ev.timestamp) }}</span>
        <span class="text-[#aaa] truncate flex-1" :title="ev.model">{{ truncModel(ev.model) }}</span>
        <span class="text-[#888] font-mono shrink-0 w-[44px] text-right">{{ formatTokens(ev.totalTokens) }}</span>
        <span
          v-if="ev.requests > 0"
          class="text-[#4a8cc7] font-mono shrink-0 w-[20px] text-right"
        >{{ ev.requests }}r</span>
        <span v-else class="shrink-0 w-[20px]" />
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="usage.snapshot?.error"
      class="px-3 py-1.5 text-[10px] text-[#d16969] truncate"
      :title="usage.snapshot.error"
    >
      {{ usage.snapshot.error }}
    </div>
  </div>
</template>
