<script setup lang="ts">
import { useUsageStore } from '../stores/usage'

const usage = useUsageStore()

function formatCompact(): string {
  const s = usage.snapshot
  if (!s) return '--/--'
  return `${s.includedUsed}/${s.includedLimit}`
}

function formatSpend(): string {
  const s = usage.snapshot
  if (!s) return '$--'
  return `$${s.onDemandSpent.toFixed(2)}`
}

function compactCountdown(): string {
  const c = usage.resetCountdown
  if (!c || c === '--') return ''
  return c
}
</script>

<template>
  <div
    class="flex items-center gap-1.5 text-[10px] text-[#888] select-none cursor-default shrink-0"
    title="Cursor Usage"
  >
    <span
      class="w-[5px] h-[5px] rounded-full shrink-0"
      :style="{ background: usage.statusColor }"
    />
    <span class="font-mono whitespace-nowrap" :style="{ color: usage.statusColor }">
      {{ formatCompact() }}
    </span>
    <span class="font-mono whitespace-nowrap">{{ formatSpend() }}</span>
    <span v-if="compactCountdown()" class="whitespace-nowrap text-[#666]">{{ compactCountdown() }}</span>
    <svg
      v-if="usage.loading"
      class="w-3 h-3 animate-spin text-[#666]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
    >
      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round" />
    </svg>
  </div>
</template>
