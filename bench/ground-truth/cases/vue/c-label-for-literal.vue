<template>
  <form>
    <label for="city">City</label>
    <input id="city" v-model="city" type="text">
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const city = ref('')
</script>
