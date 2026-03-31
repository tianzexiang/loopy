import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface UsageEvent {
  timestamp: number
  model: string
  kind: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  chargedCents: number
}

export interface UsageSnapshot {
  includedUsed: number
  includedLimit: number
  onDemandSpent: number
  onDemandLimit: number
  startOfMonth: string
  events: UsageEvent[]
  error: string | null
}

export const useUsageStore = defineStore('usage', () => {
  const snapshot = ref<UsageSnapshot | null>(null)
  const loading = ref(false)
  const lastRefreshed = ref<Date | null>(null)
  const resetCountdown = ref('')

  let countdownTimer: ReturnType<typeof setInterval> | null = null

  const usageRatio = computed(() => {
    if (!snapshot.value || snapshot.value.includedLimit === 0) return 0
    return snapshot.value.includedUsed / snapshot.value.includedLimit
  })

  const statusColor = computed(() => {
    const r = usageRatio.value
    if (r >= 0.8) return '#d16969'
    if (r >= 0.5) return '#d7ba7d'
    return '#4ec9b0'
  })

  const resetTarget = computed(() => {
    if (!snapshot.value?.startOfMonth) return null
    const start = new Date(snapshot.value.startOfMonth)
    if (isNaN(start.getTime())) return null
    const next = new Date(start)
    next.setMonth(next.getMonth() + 1)
    return next
  })

  function updateCountdown() {
    const target = resetTarget.value
    if (!target) {
      resetCountdown.value = '--'
      return
    }
    const diff = target.getTime() - Date.now()
    if (diff <= 0) {
      resetCountdown.value = '已重置'
      return
    }
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    const secs = Math.floor((diff % 60000) / 1000)

    const hh = String(hours).padStart(2, '0')
    const mm = String(mins).padStart(2, '0')
    const ss = String(secs).padStart(2, '0')

    resetCountdown.value = days > 0 ? `${days}天 ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`
  }

  function startCountdown() {
    stopCountdown()
    updateCountdown()
    countdownTimer = setInterval(updateCountdown, 1000)
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  async function fetchUsage(force = false) {
    if (loading.value) return
    loading.value = true
    try {
      const cmd = force ? 'refresh_cursor_usage' : 'get_cursor_usage'
      const result = await invoke<UsageSnapshot>(cmd)
      snapshot.value = result
      lastRefreshed.value = new Date()
      startCountdown()
    } catch (e) {
      snapshot.value = {
        includedUsed: 0,
        includedLimit: 0,
        onDemandSpent: 0,
        onDemandLimit: 0,
        startOfMonth: '',
        events: [],
        error: String(e),
      }
    } finally {
      loading.value = false
    }
  }

  function init() {
    fetchUsage()
  }

  function cleanup() {
    stopCountdown()
  }

  return {
    snapshot,
    loading,
    lastRefreshed,
    resetCountdown,
    usageRatio,
    statusColor,
    resetTarget,
    fetchUsage,
    init,
    cleanup,
  }
})
