<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { useSessionStore } from '../stores/sessions'
import type { ChatMessage, ImageAttachment } from '../types'
import Lightbox from './Lightbox.vue'

const store = useSessionStore()
const scrollEl = ref<HTMLDivElement>()
const lightboxSrc = ref<string | null>(null)
const copiedMsgId = ref<string | null>(null)
const copiedImgId = ref<string | null>(null)

function scrollToBottom(smooth = true) {
  scrollEl.value?.scrollTo({
    top: scrollEl.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  })
}

onMounted(async () => {
  await nextTick()
  scrollToBottom(false)
})

watch(
  () => store.activeSession?.messages.length,
  async () => {
    await nextTick()
    scrollToBottom()
  }
)

watch(
  () => store.activeSessionId,
  async () => {
    await nextTick()
    scrollToBottom(false)
  }
)

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function isAi(msg: ChatMessage) { return msg.role === 'ai' }

async function copyText(msg: ChatMessage) {
  try {
    await navigator.clipboard.writeText(msg.content)
    copiedMsgId.value = msg.id
    setTimeout(() => { copiedMsgId.value = null }, 1500)
  } catch { /* clipboard might not be available */ }
}

async function copyImage(img: ImageAttachment) {
  try {
    const byteStr = atob(img.base64)
    const arr = new Uint8Array(byteStr.length)
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
    const blob = new Blob([arr], { type: 'image/png' })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    copiedImgId.value = img.id
    setTimeout(() => { copiedImgId.value = null }, 1500)
  } catch { /* fallback: open in lightbox */ }
}


</script>

<template>
  <div ref="scrollEl" class="overflow-y-auto flex-1 min-h-0" style="background: #1e1f22;">
    <template v-if="store.activeSession?.messages.length">
      <div
        v-for="msg in store.activeSession.messages"
        :key="msg.id"
        class="group/msg px-4 py-3 relative"
        :style="{ borderBottom: '1px solid #2a2a2a' }"
      >
        <!-- Header row with role badge + time + copy button -->
        <div class="flex items-center gap-2 mb-1.5">
          <span
            class="text-[10px] px-2 py-0.5 rounded font-semibold"
            :style="{
              background: isAi(msg) ? 'rgba(96,165,250,0.15)' : msg.responseType === 'accept' ? 'rgba(74,222,128,0.15)' : msg.responseType === 'reject' ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.06)',
              color: isAi(msg) ? '#93c5fd' : msg.responseType === 'accept' ? '#4ade80' : msg.responseType === 'reject' ? '#f87171' : '#999',
            }"
          >
            {{ isAi(msg) ? 'AI' : msg.responseType === 'accept' ? 'Accepted' : msg.responseType === 'reject' ? 'Rejected' : 'You' }}
          </span>
          <span class="text-[10px] text-[#555] tabular-nums">{{ formatTime(msg.timestamp) }}</span>

          <!-- Copy text button -->
          <button
            v-if="msg.content"
            class="ml-auto w-6 h-6 rounded flex items-center justify-center transition-all cursor-pointer opacity-0 group-hover/msg:opacity-100"
            :class="copiedMsgId === msg.id ? 'text-[#4ade80] bg-[#4ade80]/10' : 'text-[#666] hover:text-[#ccc] hover:bg-white/5'"
            :title="copiedMsgId === msg.id ? 'Copied!' : 'Copy text'"
            @click="copyText(msg)"
          >
            <svg v-if="copiedMsgId === msg.id" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>

        <!-- Message text (selectable) -->
        <p class="text-[13px] text-[#bbb] leading-[1.65] whitespace-pre-wrap break-words select-text cursor-text">{{ msg.content }}</p>

        <!-- Images with copy button -->
        <div v-if="msg.images.length" class="flex flex-wrap gap-2 mt-2">
          <div v-for="img in msg.images" :key="img.id" class="relative group/img">
            <img
              :src="img.previewUrl"
              class="h-20 rounded-lg object-cover cursor-pointer border border-[#333] hover:border-[#60a5fa] transition-colors"
              @click="lightboxSrc = img.previewUrl"
            />
            <button
              class="absolute top-1 right-1 w-5 h-5 rounded bg-black/60 flex items-center justify-center transition-all cursor-pointer opacity-0 group-hover/img:opacity-100"
              :class="copiedImgId === img.id ? 'text-[#4ade80]' : 'text-white/70 hover:text-white hover:bg-black/80'"
              :title="copiedImgId === img.id ? 'Copied!' : 'Copy image'"
              @click.stop="copyImage(img)"
            >
              <svg v-if="copiedImgId === img.id" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="flex flex-col items-center justify-center h-full text-center px-6">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" stroke-linecap="round" class="mb-3">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      <p class="text-sm text-[#666] mb-1">Waiting for AI request...</p>
      <p class="text-xs text-[#444]">Messages will appear here when your IDE sends a request.</p>
    </div>
  </div>

  <Lightbox :src="lightboxSrc" @close="lightboxSrc = null" />
</template>
