<template>
  <button type="button" :aria-label="label" @click="$emit('close')">
    <svg aria-hidden="true" width="16" height="16"><path d="M2 2l12 12" /></svg>
  </button>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>
