import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Popup TimelineSection 视图配置检查', () => {
  it('包含迁移后的新开关与侧边栏元素多选，且未引入私有排除功能', () => {
    const file = path.resolve(__dirname, '../../entrypoints/popup/components/sections/TimelineSection.vue')
    const content = fs.readFileSync(file, 'utf-8')

    // 保留并新增的核心开关
    expect(content).toContain('发帖按钮')
    expect(content).toContain('直达评论')
    expect(content).toContain('未互关标记')
    expect(content).toContain('文章目录')
    expect(content).toContain('排期全景')
    expect(content).toContain('发帖多图拖拽排序')
    expect(content).toContain('多图横滑浏览')
    expect(content).toContain('搜索结果筛选条')
    expect(content).toContain('搜索默认「最新」')
    expect(content).toContain('侧边栏元素')
    expect(content).toContain('KeySidebarElements')

    // 确保未引入未授权迁移的私有模块
    expect(content).not.toContain('KeyRewardsOverview')
    expect(content).not.toContain('KeyOwnPostAutoSync')
    expect(content).not.toContain('KeyOwnPostPickerEnabled')
    expect(content).not.toContain('KeyHomeFocusTab')
    expect(content).not.toContain('KeyQuickLists')
    expect(content).not.toContain('KeyTweetFilterEnabled')
    expect(content).not.toContain('KeySidebarColumn')
  })
})
