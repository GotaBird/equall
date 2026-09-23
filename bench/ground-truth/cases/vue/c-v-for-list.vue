<template>
  <ul>
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
</template>

<script setup lang="ts">
defineProps<{ items: { id: string; name: string }[] }>()
</script>
