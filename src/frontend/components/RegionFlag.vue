<template>
  <img
    v-if="flagSrc && !loadFailed"
    class="flag-img"
    :src="flagSrc"
    :alt="altText"
    loading="lazy"
    @error="loadFailed = true"
  >
  <span
    v-else
    class="flag-fallback"
    role="img"
    :aria-label="altText"
  >🌐</span>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { getFlagRegionCode } from '../utils/api'
import { getPublicAssetUrl } from '../utils/config'

const props = defineProps({
  region: {
    type: String,
    default: ''
  },
  alt: {
    type: String,
    default: ''
  }
})

const loadFailed = ref(false)
const normalizedCode = computed(() => {
  const code = getFlagRegionCode(props.region)
  return code && code !== 'xx' ? code : ''
})
const flagSrc = computed(() => normalizedCode.value ? getPublicAssetUrl(`flags/${normalizedCode.value}.svg`) : '')
const altText = computed(() => String(props.alt || props.region || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN')

watch(() => props.region, () => {
  loadFailed.value = false
})
</script>
