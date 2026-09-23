<template>
  <component :is="tag" class="heading">
    <slot />
  </component>
</template>

<script setup lang="ts">
defineProps<{ tag: string }>()
</script>
