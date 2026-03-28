<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useSessionStore } from '../stores/sessions'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import type { FeedbackResponse, ImageAttachment } from '../types'
import { generateId, summarizeTitle, shortDirName, arrayToBase64 } from '../utils/helpers'
import Lightbox from './Lightbox.vue'

defineProps<{
  sessionColor: string
  historyOpen?: boolean
}>()

const emit = defineEmits<{
  toggleExpand: []
  hide: []
  dragStart: [e: MouseEvent]
  dragEnd: []
  cycleSession: []
  contentResize: []
}>()

const store = useSessionStore()
const inputText = ref('')
const images = ref<ImageAttachment[]>([])
const textareaRef = ref<HTMLTextAreaElement>()
const lightboxSrc = ref<string | null>(null)

const hasPending = computed(() => !!store.activeSession?.pendingRequest)
const isConnected = computed(() => store.activeSession?.connected ?? false)

const canSend = computed(() =>
  hasPending.value && isConnected.value && (inputText.value.trim() || images.value.length)
)
const pendingCount = computed(() => store.sessions.filter(s => s.pendingRequest).length)


function send(type: 'accept' | 'reject' | 'feedback') {
  const pending = store.activeSession?.pendingRequest
  if (!pending) return
  store.sendResponse({
    requestId: pending.id,
    type,
    text: inputText.value.trim(),
    images: images.value,
    timestamp: Date.now(),
  } satisfies FeedbackResponse)
  inputText.value = ''
  images.value = []
  autoResize()
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (canSend.value) send('feedback')
  }
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 48)}px`
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        images.value.push({
          id: generateId(),
          name: file.name || 'pasted-image.png',
          base64: (reader.result as string).split(',')[1]!,
          mimeType: file.type,
          previewUrl: reader.result as string,
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

async function pickImage() {
  const result = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  })
  if (!result) return
  const paths = Array.isArray(result) ? result : [result]
  const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
  for (const filePath of paths) {
    const data = await readFile(filePath)
    const base64 = arrayToBase64(data)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
    const mime = mimeMap[ext] ?? 'image/png'
    images.value.push({
      id: generateId(),
      name: shortDirName(filePath) ?? 'image',
      base64,
      mimeType: mime,
      previewUrl: `data:${mime};base64,${base64}`,
    })
  }
}

function removeImage(id: string) {
  images.value = images.value.filter(i => i.id !== id)
}

watch(() => images.value.length, async () => {
  await nextTick()
  emit('contentResize')
})

function sessionTitle(): string {
  const s = store.activeSession
  if (!s) return 'No session'
  if (s.label && s.label.length > 1) return summarizeTitle(s.label, 28)
  return shortDirName(s.projectDirectory) || 'Session'
}

function dotStyle(session: typeof store.visibleSessions[number]) {
  const isActive = store.activeSessionId === session.id
  const size = isActive ? '9px' : '5px'

  if (!session.connected) {
    return { width: size, height: size, background: '#555', opacity: '0.25' }
  }
  if (session.pendingRequest) {
    return {
      width: size, height: size,
      background: session.color,
      boxShadow: isActive ? `0 0 8px ${session.color}90` : 'none',
      opacity: isActive ? '1' : '0.65',
      animation: 'breathe 2s ease-in-out infinite',
    }
  }
  return {
    width: size, height: size,
    background: session.color,
    boxShadow: isActive ? `0 0 8px ${session.color}90` : 'none',
    opacity: isActive ? '1' : '0.45',
    animation: isActive ? 'pulse 1.5s ease-in-out infinite' : 'none',
  }
}
</script>

<template>
  <div class="flex items-start gap-2 w-full">
    <!-- Left < button: always visible -->
    <button
      class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center cursor-pointer transition-all hover:brightness-110 select-none mt-1"
      :style="{ background: isConnected ? sessionColor : '#555', boxShadow: isConnected ? `0 2px 8px ${sessionColor}50` : 'none' }"
      @mousedown.stop
      @click="emit('cycleSession')"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>

    <!-- Input box with theme-colored border -->
    <div
      class="flex-1 min-w-0 overflow-hidden flex flex-col h-full"
      :class="historyOpen ? 'rounded-b-xl' : 'rounded-xl'"
      :style="{
        background: '#1e1f22',
        boxShadow: `0 0 0 1px ${sessionColor}50, 0 0 10px ${sessionColor}25, 0 0 25px ${sessionColor}10`,
      }"
    >
      <!-- Images inside the box -->
      <div v-if="images.length" class="flex items-center gap-1.5 px-5 pt-2 pb-1">
        <div v-for="img in images" :key="img.id" class="relative group">
          <img :src="img.previewUrl" class="h-8 rounded border border-[#444] object-cover cursor-pointer hover:border-[#60a5fa] transition-colors" @click="lightboxSrc = img.previewUrl" />
          <button
            class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#f87171] text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            @click="removeImage(img.id)"
          >&times;</button>
        </div>
      </div>

      <!-- Textarea row with send button inside -->
      <div class="flex items-center px-4 py-2.5 gap-3">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          :disabled="!hasPending"
          :placeholder="hasPending ? (isConnected ? '反馈填在这里' : 'Disconnected...') : 'Waiting for AI...'"
          rows="1"
          class="flex-1 bg-transparent text-sm text-[#ccc] py-1 resize-none outline-none border-none placeholder-[#666] disabled:opacity-40 min-h-[24px] max-h-[42px] cursor-text"
          @input="autoResize"
          @keydown="handleKeyDown"
          @paste="handlePaste"
        />
        <button
          class="w-7 h-7 rounded-full shrink-0 grid place-items-center border-none cursor-pointer transition-all disabled:cursor-not-allowed"
          :disabled="!canSend"
          :style="canSend ? { background: sessionColor, color: 'white' } : { background: '#333', color: '#555' }"
          @click="send('feedback')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      <!-- Status bar inside the box -->
      <div
        class="flex items-center justify-between px-4 py-2 select-none cursor-default"
        style="border-top: 1px solid #2a2a2a;"
        @mousedown.left="emit('dragStart', $event)"
        @mouseup.left="emit('dragEnd')"
      >
        <div class="flex items-center gap-2 text-[11px] text-[#666] pointer-events-none">
          <div class="flex items-center gap-1.5 pointer-events-auto">
            <button
              v-for="session in store.visibleSessions"
              :key="session.id"
              class="rounded-full cursor-pointer shrink-0"
              :style="dotStyle(session)"
              :title="session.label || shortDirName(session.projectDirectory) || 'Session'"
              @mousedown.stop
              @click="store.activeSessionId = session.id"
            />
          </div>
          <span v-if="!isConnected" class="text-[#555]">Disconnected</span>
          <span v-else :style="hasPending ? { color: sessionColor } : {}">{{ sessionTitle() }}</span>
          <span v-if="hasPending && pendingCount > 1" class="text-[#e5c07b]">{{ pendingCount }} pending</span>
        </div>
        <div class="flex items-center gap-0.5 pointer-events-auto">
          <button class="w-6 h-6 rounded flex items-center justify-center text-[#555] hover:text-[#ccc] hover:bg-white/5 transition-colors cursor-pointer" title="Attach image" @mousedown.stop @click="pickImage()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </button>
          <button class="w-6 h-6 rounded flex items-center justify-center text-[#555] hover:text-[#ccc] hover:bg-white/5 transition-colors cursor-pointer" :title="historyOpen ? 'Hide history' : 'Show history'" @mousedown.stop @click="emit('toggleExpand')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="transition-transform duration-200" :style="{ transform: historyOpen ? 'rotate(180deg)' : '' }"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button class="w-6 h-6 rounded flex items-center justify-center text-[#555] hover:text-[#f87171] hover:bg-[#f87171]/10 transition-colors cursor-pointer" title="Hide" @mousedown.stop @click="emit('hide')">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <Lightbox :src="lightboxSrc" @close="lightboxSrc = null" />
</template>
