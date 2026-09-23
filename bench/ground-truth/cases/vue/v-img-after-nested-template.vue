<template>
  <div class="card">
    <template v-if="featured">
      <p class="badge">Featured</p>
    </template>
    <img src="/product.jpg">
  </div>
</template>

<script setup lang="ts">
defineProps<{ featured: boolean }>()
</script>
