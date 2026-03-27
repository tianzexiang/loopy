<script setup lang="ts">
defineProps<{ src: string | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="src"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-pointer"
      @click="emit('close')"
    >
      <img :src="src" class="max-w-[92vw] max-h-[88vh] object-contain rounded-xl" @click.stop />
    </div>
  </Teleport>
</template>
