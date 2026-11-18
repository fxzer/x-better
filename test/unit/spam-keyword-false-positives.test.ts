import { describe, it, expect } from 'vitest'
import { evaluateSpam, normalizeKeyword } from '../../shared/spam-rules'
import { defaultSpamKeywords } from '../../storage-keys'

const testKeywords = [
  ...defaultSpamKeywords,
  'h动漫',
  '日本AV',
  '国产av',
  '成人dv',
  'SM全明星',
  '性交',
  '乱交',
  '口交',
  '乳交',
  '兽性',
]

describe('Spam Filter - False Positive Protections', () => {
  it('does not corrupt keywords containing English letters (e.g. h动漫, 日本AV, 成人dv, 国产av)', () => {
    expect(normalizeKeyword('h动漫')).toBe('h动漫')
    expect(normalizeKeyword('日本AV')).toBe('日本av')
    expect(normalizeKeyword('国产av')).toBe('国产av')
    expect(normalizeKeyword('成人dv')).toBe('成人dv')
    expect(normalizeKeyword('SM全明星')).toBe('sm全明星')
    expect(normalizeKeyword('sao货')).toBe('sao货')
  })

  it('does not falsely trigger on normal text containing everyday words like 动漫, 日本, 成人, 国产', () => {
    // 正常讨论动漫、成人成熟度、国产设计
    const normalText = '这部国产动漫在日本也很火，能让成人保持深度思考'
    const res = evaluateSpam({
      text: normalText,
      authorName: 'NormalUser',
      authorHandle: 'normal_user',
      keywords: testKeywords,
    })
    expect(res.hits.some((h) => h.id === 'marketing_keyword')).toBe(false)
    expect(res.score).toBe(0)
  })

  it('does not falsely trigger "性交" on cross-word boundary phrases like "选择性交叉"', () => {
    const textWithSelectiveCross = '添加更细的刮擦式钢笔线，以及阴影区域内的选择性交叉刻线。'
    const res = evaluateSpam({
      text: textWithSelectiveCross,
      authorName: 'ArtistUser',
      authorHandle: 'artist_user',
      keywords: testKeywords,
    })
    expect(res.hits.some((h) => h.id === 'marketing_keyword')).toBe(false)
    expect(res.score).toBe(0)
  })

  it('does not falsely trigger "口交" on "港口交通"', () => {
    const res = evaluateSpam({
      text: '海运港口交通十分繁忙，进出口顺畅',
      authorName: 'TradeUser',
      authorHandle: 'trade_user',
      keywords: testKeywords,
    })
    expect(res.hits.some((h) => h.id === 'marketing_keyword')).toBe(false)
  })

  it('does not falsely trigger on the actual user prompt that caused the disappearance', () => {
    const promptText = `使用上传的单张照片作为唯一主题来源。将它转化为一张大胆的复古插图角色海报，融合富有表现力的社论漫画风格、地下漫画墨水绘图，以及在陈旧奶油色纸张上的磨损丝网印刷效果。创作一个全新绘制的卡通角色，拥有清晰重新设计的面部比例，然后围绕该角色构建海报。只输出一张完成的转化海报。

保留主要主题、可辨识的发型、胡须、肤色家族、年龄和性别呈现、独特配饰、服装类别、标志性颜色、姿势、手势，以及与现有物体的互动。保持源头的头部角度和整体视角。通过这些选定线索保留身份，而不是精确的面部测量。允许对眼睛、眉毛、鼻子、脸颊、下巴和嘴巴进行大幅卡通化重新设计。让成人保持视觉上的成熟感，同时赋予他们富有表现力、俏皮的比例。

绘制一个略微放大的头部，拥有宽阔的上半脸部、突出的脸颊形状，以及紧凑锥形下半脸部。让眼睛显著放大，呈细长的杏仁形状，带有宽阔温暖象牙白的眼白、深色虹膜，以及果断的黑色上眼睑。将瞳孔清晰定位向源头注视方向，适当强调偏离中心的侧向或向上瞥视。保持眨眼或眯眼与原表情一致。避免统一的睁大眼睛凝视。使用强有力的表现力眉毛、简化的鼻子（由几笔墨迹和一个角度温暖阴影定义），以及用自信曲线绘制的独特嘴巴。保留闭合嘴巴、咧嘴笑、分开的嘴唇或其他表情，而不强加相同的笑容给每个人。当牙齿可见时，将其暗示为简单的象牙形状。根据人物调整睫毛、唇部强调、胡须标记、雀斑和面部细节，而不是套用通用脸型。

在轮廓、头发、眼睛、服装和重要物体周围使用强有力、有机变化的黑色墨水线条。添加更细的刮擦式钢笔线、短方向性刻线，以及阴影区域内的选择性交叉刻线。头发应由大片流动的发锁和深色块组成，使用活泼的曲线墨水笔触和少许温暖高光。保留实际发型和颜色家族。用紧凑的深色形状和短粗糙笔触描绘面部毛发。通过宽阔的颜色区域、清晰的褶皱，以及稀疏充满活力的笔触描述服装。用几个平面阴影形状构建体积，而不是摄影渐变。

使用紧凑的不透明印刷墨水调色板：陈旧象牙色、近黑色炭灰、温暖赭石或桃色肤色、棕色，以及几个特定角色的强调色，如尘土粉、番茄红、芥末黄、柔和薄荷绿或汽油蓝绿色。保留可辨识的源头颜色，同时将它们转化为冲击力的复古墨水色。默认使用强烈的汽油蓝绿色背景；当它更好地支持源头情绪和服装时，使用深炭灰色。保持人物与背景清晰分离。皮肤应呈现为温暖的图形颜色，带有克制的脸颊晕染和墨水细节，而不是柔和的气刷肖像阴影。

在人物和背景上应用令人信服的磨损印刷纹理：可见的纸张纹理、细粒感、散布的缺墨斑点、略微不均匀的墨水覆盖、刮擦颜色区域、干刷边缘，以及轻微褪色的斑块。在磨损之下保持清晰可读的绘图。添加一个狭窄不规则的陈旧奶油色纸张边框，带有磨损角落和磨损墨水边缘。作品应类似于印在吸水纸上的旧插图海报，具有哑光平面颜色和触感瑕疵，而不是光泽的数字渲染。

让主要角色在前景中占据主导地位。保留源头的可见身体范围和基本手势，将构图调整为垂直海报，而不发明看不见的手、腿或道具。在上部背景上放置一个超大的奶油色标题，部分位于角色的头发或轮廓后面。将标题绘制为粗糙的大写手绘刷式字体，带有不均匀宽度、不规则间距、强烈的对角线、参差干刷末端，以及可见的缺墨。让文字跨越海报的大部分宽度，同时保持面部无遮挡。保留足够的字母结构，使短语保持可读性。

可选标题：[TITLE]。可选小手写笔记：[NOTE]。精确复制提供的文本。如果 TITLE 为空或省略，则生成一个简短的二至四词英语短语，表达源图像的情绪或活动。如果 NOTE 省略，则添加一个简短的上下文相关手写笔记，或在空间有限时省略它。绝不显示占位符。不要自动复制其他图像的口号、引入脏话，或发明关于主题的个人声明。

将原始场景简化为几个大胆的插图环境形状。只包括少量相关的外围细节，如与源头相关的物体、一张贴纸笔记，或两三个快速手绘强调标记。让这些次要于角色和标题。除非源头支持或明确要求，否则不要自动添加咖啡、植物、猫、珠宝、星星、家具或新的手势。

优先考虑表现力的卡通面部构建、自信的黑色墨水绘图、大胆的有限颜色形状、超大刷式字体，以及真实的磨损印刷效果。避免带有纹理滤镜的现实面部几何、精致的粉彩娃娃风格、标准的抛光动漫、小型ちび身体、光滑矢量轮廓、水彩晕染、光泽气刷、摄影背景、3D 渲染、过度装饰、额外主题、畸形手、签名、平台水印，以及界面元素。只输出完成的插图海报，没有原始照片或比较布局。`

    const res = evaluateSpam({
      text: promptText,
      authorName: '苏乐',
      authorHandle: 'ai_suxiaole',
      keywords: testKeywords,
    })
    expect(res.hits.some((h) => h.id === 'marketing_keyword')).toBe(false)
    expect(res.score).toBe(0)
  })

  it('still detects genuine explicit spam using these keywords', () => {
    const genuinePorn = evaluateSpam({
      text: '真实私密性交自拍合集，高清无码',
      authorName: 'SpamBot',
      authorHandle: 'spambot999',
      keywords: testKeywords,
    })
    expect(genuinePorn.hits.some((h) => h.id === 'marketing_keyword')).toBe(true)
  })
})
