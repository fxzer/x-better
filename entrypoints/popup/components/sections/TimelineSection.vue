<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui'
import {
  KeyTweetButton,
  KeyNavigationButtonsLabels,
  KeySidebarElements,
  KeyHighlightNonFollowers,
  KeyArticleToc,
  KeyScheduledPanorama,
  KeyJumpToComments,
  KeyComposerMediaGrid,
  KeyMediaCarouselSwipe,
  KeySearchFilterBar,
  KeySearchDefaultLatest,
} from '../../../../storage-keys'
import {
  parseSidebarElements,
  serializeSidebarElements,
  type SidebarElementKey,
} from '../../../../shared/settings'
import { getStorage, setStorage } from '../../../../content-scripts/utilities/storage'
import { useNavIcons } from '../../composables/useNavIcons'
import TimelineWidthSlider from '../controls/TimelineWidthSlider.vue'
import ControlsWrapper from '../ui/ControlsWrapper.vue'
import SectionLabel from '../ui/SectionLabel.vue'
import Separator from '../ui/Separator.vue'
import IconButton from '../ui/IconButton.vue'
import ToggleGroupControl from '../ui/ToggleGroupControl.vue'

const { navItems } = useNavIcons()

const displayControls = [
  {
    label: '发帖按钮',
    key: KeyTweetButton,
    options: [
      { value: 'on', label: '显示' },
      { value: 'off', label: '隐藏' },
    ],
  },
  {
    label: '直达评论',
    key: KeyJumpToComments,
    options: [
      { value: 'on', label: '显示' },
      { value: 'off', label: '隐藏' },
    ],
  },
  {
    label: '未互关标记',
    key: KeyHighlightNonFollowers,
    options: [
      { value: 'on', label: '显示' },
      { value: 'off', label: '隐藏' },
    ],
  },
  {
    label: '文章目录',
    key: KeyArticleToc,
    options: [
      { value: 'on', label: '显示' },
      { value: 'off', label: '隐藏' },
    ],
  },
  {
    label: '排期全景',
    key: KeyScheduledPanorama,
    options: [
      { value: 'on', label: '显示' },
      { value: 'off', label: '隐藏' },
    ],
  },
  {
    label: '发帖多图拖拽排序',
    key: KeyComposerMediaGrid,
    options: [
      { value: 'on', label: '开启' },
      { value: 'off', label: '关闭' },
    ],
  },
  {
    label: '多图横滑浏览',
    key: KeyMediaCarouselSwipe,
    options: [
      { value: 'on', label: '开启' },
      { value: 'off', label: '关闭' },
    ],
  },
  {
    label: '搜索结果筛选条',
    key: KeySearchFilterBar,
    options: [
      { value: 'on', label: '开启' },
      { value: 'off', label: '关闭' },
    ],
  },
  {
    label: '搜索默认「最新」',
    key: KeySearchDefaultLatest,
    options: [
      { value: 'on', label: '开启' },
      { value: 'off', label: '关闭' },
    ],
  },
]

const sidebarElementOptions: { key: SidebarElementKey; label: string }[] = [
  { key: 'live', label: 'X直播' },
  { key: 'trends', label: 'X新鲜事' },
  { key: 'whoToFollow', label: '推荐关注' },
]

const sidebarElements = ref<Record<SidebarElementKey, boolean>>({
  live: false,
  trends: false,
  whoToFollow: false,
})

onMounted(async () => {
  const stored = await getStorage(KeySidebarElements)
  sidebarElements.value = parseSidebarElements(stored)
})

const toggleSidebarElement = async (key: SidebarElementKey, checked: boolean) => {
  sidebarElements.value[key] = checked
  const serialized = serializeSidebarElements(sidebarElements.value)
  await setStorage({ [KeySidebarElements]: serialized })
}
</script>

<template>
 <section class="flex flex-col gap-3">
  <ControlsWrapper id="user-control-timeline">
   <TimelineWidthSlider />
   <Separator />

   <div class="flex flex-col gap-2.5 w-full">
    <div
     v-for="item in displayControls"
     :key="item.key"
     class="flex items-center justify-between w-full"
    >
     <span class="text-[12px] font-semibold text-color-text">{{ item.label }}</span>
     <ToggleGroupControl :storage-key="item.key" :options="item.options" />
    </div>

    <!-- 侧边栏元素：X直播 / X新鲜事 / 推荐关注 -->
    <div class="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
      <div class="min-w-0">
        <p class="text-[12px] font-semibold text-color-text whitespace-nowrap">侧边栏元素</p>
        <p class="text-[10px] text-secondary-text mt-0.5 whitespace-nowrap">勾选要展示的模块</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <label
          v-for="opt in sidebarElementOptions"
          :key="opt.key"
          class="flex items-center gap-1 cursor-pointer select-none"
        >
          <CheckboxRoot
            :model-value="sidebarElements[opt.key]"
            @update:model-value="(v) => toggleSidebarElement(opt.key, !!v)"
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors cursor-pointer outline-none"
            :class="sidebarElements[opt.key] ? 'bg-accent border-accent' : 'bg-white border-secondary-text/40'"
          >
            <CheckboxIndicator class="flex items-center justify-center text-white">
              <svg viewBox="0 0 12 12" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 6.5 4.5 9 10 3.5" />
              </svg>
            </CheckboxIndicator>
          </CheckboxRoot>
          <span class="text-xs whitespace-nowrap" :class="sidebarElements[opt.key] ? 'text-color-text' : 'text-secondary-text'">
            {{ opt.label }}
          </span>
        </label>
      </div>
    </div>
   </div>
  </ControlsWrapper>

  <ControlsWrapper id="user-control-navigation" class="!rounded-xl">
   <SectionLabel>导航栏按钮</SectionLabel>

   <div v-if="navItems.length > 0" class="grid grid-cols-5 gap-y-2 gap-x-4 mx-auto flex-wrap">
    <IconButton
     v-for="item in navItems"
     :key="item.storageKey"
     :storage-key="item.storageKey"
     :label="item.label"
     :icon-html="item.innerHTML"
     :view-box="item.viewBox"
    />
   </div>
   <div v-else class="py-3 text-center text-xs text-secondary-text">
    打开任意 𝕏 网页即可自动同步导航
   </div>

   <Separator />
   <div class="flex items-center justify-between w-full">
    <span class="text-[12px] font-semibold text-color-text whitespace-nowrap">显示导航文本</span>
    <ToggleGroupControl
     :storage-key="KeyNavigationButtonsLabels"
     :options="[
      { value: 'never', label: '从不' },
      { value: 'hover', label: '悬停' },
      { value: 'always', label: '始终' },
     ]"
    />
   </div>
  </ControlsWrapper>

  <p class="text-xs text-center font-medium leading-5 text-secondary-text">
   更多 𝕏 显示设置
   <a href="https://twitter.com/i/display" target="_blank" rel="noreferrer" class="text-accent hover:underline">
    查看
   </a>。
  </p>
 </section>
</template>
