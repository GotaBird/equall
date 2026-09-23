<template>
  <form @submit.prevent="search">
    <input v-model="q" type="text" name="q">
    <button type="submit">Search</button>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const q = ref('')
function search() {}
</script>
