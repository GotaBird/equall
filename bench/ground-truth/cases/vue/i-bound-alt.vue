<template>
  <figure>
    <img :src="src" :alt="alt">
  </figure>
</template>

<script setup lang="ts">
defineProps<{ src: string; alt: string }>()
</script>
