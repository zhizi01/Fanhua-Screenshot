<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 34 })
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="12" fill="#7860D2" />
    <path d="M20 8c4.7 0 5.3 5.9 2.2 9.8C27 15.5 32 18 30.5 22.5c-1.4 4.5-7.2 3.2-10.5-.2-1.3 5.2-5.2 8.9-8.4 5.5-3.2-3.4.6-8 5.2-9.6C12.4 15.3 15.3 8 20 8Z" fill="white" />
    <circle cx="20" cy="20" r="3" fill="#C5B6F4" />
  </svg>
</template>
