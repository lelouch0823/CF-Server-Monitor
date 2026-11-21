<template>
  <div>
    <!-- 以 path 作为 key：/server/A 与 /server/B 之间导航时强制重建组件，
         避免详情页复用实例导致旧数据残留（query 变化不触发重建） -->
    <router-view :key="$route.path" />
  </div>
</template>

<script setup>
import { useTheme } from './composables/useTheme'

const { initTheme } = useTheme()

initTheme()
</script>