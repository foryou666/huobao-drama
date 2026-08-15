/**
 * BGM 风格标签：一级（国内/海外）→ 二级 → 标签（含内置提示词）
 */
export const MUSIC_STYLE_CATALOG = [
  {
    id: 'domestic',
    label: '国内',
    groups: [
      {
        id: 'modern',
        label: '现代',
        chips: [
          { id: 'cn-xuan-yi', label: '悬疑', text: '紧张悬疑，低沉弦乐与轻打击，暗部推进，适合短剧追债对峙，纯器乐' },
          { id: 'cn-zhi-yu', label: '治愈', text: '温暖治愈，钢琴与柔和弦乐，明亮轻盈，适合和解与告别，纯器乐' },
          { id: 'cn-bei-qing', label: '悲情', text: '悲情压抑，大提琴与钢琴慢板，空灵感，适合分手雨夜，纯器乐' },
          { id: 'cn-nu-qing', label: '虐心', text: '虐心情歌氛围，细碎钢琴与弦乐抽泣感，适合误会爆发，纯器乐' },
          { id: 'cn-nuan-xin', label: '暖心', text: '暖心日常，木吉他与轻打击，阳光感，适合重逢拥抱，纯器乐' },
          { id: 'cn-qing-xi', label: '轻喜', text: '轻松喜剧，俏皮木管与跳跃节奏，适合误会闹剧，纯器乐' },
          { id: 'cn-du-shi', label: '都市', text: '都市夜景，电子氛围与轻节拍，霓虹感，适合职场与酒吧，纯器乐' },
          { id: 'cn-zhi-chang', label: '职场', text: '都市职场，干净钢琴与低调电子节拍，冷静克制，适合会议室对峙，纯器乐' },
          { id: 'cn-shang-zhan', label: '商战', text: '商战压迫感，低音合成器与冷弦乐，节奏稳健，适合谈判翻盘，纯器乐' },
          { id: 'cn-fu-chou', label: '复仇', text: '复仇暗涌，低弦与鼓点层层加码，冷峻，适合身份揭露，纯器乐' },
          { id: 'cn-hao-men', label: '豪门', text: '豪门宴会，优雅弦乐与钢琴，华丽克制，适合晚宴入场，纯器乐' },
          { id: 'cn-qing-chun', label: '青春', text: '青春校园，明亮吉他与轻快鼓点，清新感，适合操场奔跑，纯器乐' },
          { id: 'cn-lian-ai', label: '甜宠', text: '甜宠恋爱，轻快钢琴与拨弦，甜蜜雀跃，适合对视心动，纯器乐' },
          { id: 'cn-lang-man', label: '浪漫', text: '浪漫抒情，吉他与轻弦乐，温柔推进，适合夜景散步，纯器乐' },
          { id: 'cn-ri-chang', label: '日常', text: '生活日常，轻木吉他与柔和键盘，轻松自然，适合逛街做饭，纯器乐' },
          { id: 'cn-jia-ting', label: '亲情', text: '亲情温暖，钢琴与弦乐慢板，真诚朴素，适合回家团圆，纯器乐' },
          { id: 'cn-li-bie', label: '离别', text: '离别感伤，钢琴独奏与淡弦乐，留白多，适合机场送别，纯器乐' },
          { id: 'cn-jin-zhang', label: '紧张', text: '心跳加速的紧张配乐，急促打击与低音推进，适合倒计时追逃，纯器乐' },
          { id: 'cn-zhui-tao', label: '追逃', text: '追逐逃亡，节奏鼓点与电子脉冲，紧迫感强，适合巷战奔跑，纯器乐' },
          { id: 'cn-fan-zhuan', label: '反转', text: '剧情反转瞬间，弦乐骤起与低频冲击，适合真相揭晓，纯器乐' },
          { id: 'cn-ka-dian', label: '卡点', text: '短剧卡点转场，强鼓点与电子扫弦，节奏鲜明，适合爽点爆发，纯器乐' },
          { id: 'cn-shuang-wen', label: '爽文', text: '打脸爽文氛围，节奏上扬管弦与鼓点，热血高能，适合当众打脸，纯器乐' },
          { id: 'cn-re-xue', label: '热血', text: '热血激昂，管弦与鼓点推进，适合逆袭登场，纯器乐' },
          { id: 'cn-xuan-huan', label: '玄幻', text: '现代玄幻，电子与史诗弦乐混合，神秘力量感，适合觉醒场面，纯器乐' },
          { id: 'cn-ke-huan', label: '科幻', text: '都市科幻，冷电子合成器与脉冲节拍，未来感，适合实验室觉醒，纯器乐' },
          { id: 'cn-kong-bu', label: '惊悚', text: '惊悚不安，尖锐弦乐与不规则打击，压抑，适合深夜惊魂，纯器乐' },
          { id: 'cn-ling-yi', label: '灵异', text: '灵异诡谲，空洞氛围垫与细碎噪音感，阴冷，适合旧宅探秘，纯器乐' },
          { id: 'cn-min-yao', label: '民谣', text: '现代民谣气质，原声吉他与轻打击，叙事感，适合公路旅行，纯器乐' },
          { id: 'cn-dian-ying', label: '电影感', text: '华语电影感配乐，宽阔弦乐与钢琴，适合情绪高潮，纯器乐' },
          { id: 'cn-ye-lan', label: '夜阑', text: '深夜独处，慢速电子氛围与柔和贝斯，孤独感，适合失眠独白，纯器乐' },
        ],
      },
      {
        id: 'gufeng',
        label: '古风',
        chips: [
          { id: 'gf-jiang-hu', label: '江湖', text: '古风江湖，笛箫与鼓点，侠气纵横，适合快意恩仇，纯器乐' },
          { id: 'gf-xia-ke', label: '侠客', text: '侠客行，琵琶扫弦与鼓点，豪迈利落，适合仗剑天涯，纯器乐' },
          { id: 'gf-xian-xia', label: '仙侠', text: '仙侠空灵，古琴与笛，云雾缥缈，适合御剑飞行，纯器乐' },
          { id: 'gf-gong-dou', label: '宫斗', text: '宫斗暗涌，古筝与低弦，优雅却杀机四伏，适合朝堂对峙，纯器乐' },
          { id: 'gf-hou-gong', label: '后宫', text: '后宫权谋，细碎古筝与冷笛，华丽压抑，适合凤座争夺，纯器乐' },
          { id: 'gf-jiang-shan', label: '江山', text: '江山壮阔，大鼓与管弦古风，史诗格局，适合登基出征，纯器乐' },
          { id: 'gf-zhan-zheng', label: '古战', text: '古代战场，战鼓雷动与号角弦乐，金戈铁马，适合两军对垒，纯器乐' },
          { id: 'gf-bei-ge', label: '悲歌', text: '古风悲歌，箫声呜咽与古琴慢板，家国恨，适合城破离别，纯器乐' },
          { id: 'gf-xiang-si', label: '相思', text: '古风相思，软笛与古筝，缠绵婉转，适合月下思念，纯器乐' },
          { id: 'gf-qing-yuan', label: '情缘', text: '古风情缘，琵琶与弦乐柔板，温柔缱绻，适合红线定情，纯器乐' },
          { id: 'gf-li-bie', label: '长亭', text: '长亭送别，箫与古琴留白，淡淡离愁，适合十里长亭，纯器乐' },
          { id: 'gf-shan-shui', label: '山水', text: '山水写意，古琴慢弹与流水感，清幽，适合云游山水，纯器乐' },
          { id: 'gf-jiang-nan', label: '江南', text: '江南烟雨，笛子与古筝，温婉灵动，适合小桥流水，纯器乐' },
          { id: 'gf-sai-bei', label: '塞北', text: '塞北苍凉，马头琴感弦乐与鼓，辽阔悲壮，适合边关风雪，纯器乐' },
          { id: 'gf-miao-jiang', label: '苗疆', text: '苗疆神秘，异域打击与笛，诡谲妖冶，适合蛊术祭祀，纯器乐' },
          { id: 'gf-fo-men', label: '佛门', text: '佛门禅意，钟磬与低吟弦乐，空寂庄严，适合古寺觉悟，纯器乐' },
          { id: 'gf-yao-shu', label: '妖术', text: '妖术诡秘，不规则古风打击与暗笛，妖气，适合化形现世，纯器乐' },
          { id: 'gf-xiu-xian', label: '修仙', text: '修仙破境，古风电子与史诗鼓点，气势攀升，适合渡劫飞升，纯器乐' },
          { id: 'gf-chao-tang', label: '朝堂', text: '朝堂威仪，庄重鼓点与宫廷弦乐，肃穆，适合金殿议事，纯器乐' },
          { id: 'gf-hun-li', label: '大婚', text: '古风大婚，喜庆鼓乐与丝竹，红绸热烈，适合拜堂成亲，纯器乐' },
          { id: 'gf-ye-yan', label: '夜宴', text: '宫廷夜宴，丝竹齐鸣与轻快鼓点，华美，适合灯火宴席，纯器乐' },
          { id: 'gf-an-sha', label: '暗杀', text: '古风暗杀，极轻脚步感打击与冷笛，杀机，适合夜黑潜行，纯器乐' },
          { id: 'gf-duel', label: '对决', text: '古风对决，急促琵琶与鼓点交锋，刀光剑影，适合比武招亲，纯器乐' },
          { id: 'gf-yuan-hun', label: '冤魂', text: '古风冤魂，空洞箫声与阴冷氛围垫，凄厉，适合古庙冤案，纯器乐' },
        ],
      },
    ],
  },
  {
    id: 'overseas',
    label: '海外',
    groups: [
      {
        id: 'cinematic',
        label: '影视管弦',
        chips: [
          { id: 'os-cinematic', label: '电影感', text: 'cinematic orchestral underscore, wide strings and soft brass, emotional film score, instrumental BGM for drama' },
          { id: 'os-epic', label: '史诗', text: 'epic orchestral trailer music, powerful drums and choir pad, heroic rise, instrumental' },
          { id: 'os-adventure', label: '冒险', text: 'adventure film score, lively brass and percussion, sense of journey, instrumental' },
          { id: 'os-thriller', label: '惊悚', text: 'thriller underscore, tense strings and low pulses, suspenseful, instrumental' },
          { id: 'os-mystery', label: '悬疑', text: 'mystery detective score, pizzicato strings and soft piano, intrigue, instrumental' },
          { id: 'os-horror', label: '恐怖', text: 'horror ambient score, dissonant strings and eerie textures, chilling, instrumental' },
          { id: 'os-war', label: '战争', text: 'war drama score, solemn brass and military drums, heavy emotion, instrumental' },
          { id: 'os-space', label: '太空', text: 'space opera orchestral, vast pads and majestic brass, cosmic awe, instrumental' },
          { id: 'os-fantasy', label: '奇幻', text: 'fantasy adventure score, magical harp and strings, wonder, instrumental' },
          { id: 'os-romance-film', label: '爱情片', text: 'romantic film score, warm piano and strings, intimate emotion, instrumental' },
          { id: 'os-sad-score', label: '催泪', text: 'emotional sad orchestral, solo violin and piano, heartbreaking, instrumental' },
          { id: 'os-action', label: '动作', text: 'action blockbuster underscore, driving percussion and brass hits, high energy, instrumental' },
        ],
      },
      {
        id: 'pop',
        label: '流行',
        chips: [
          { id: 'os-pop', label: '流行', text: 'modern pop instrumental, catchy synth and soft drums, bright radio feel, instrumental BGM' },
          { id: 'os-kpop', label: 'K-Pop', text: 'K-pop style instrumental, punchy drums and bright synth hooks, stylish energy, instrumental' },
          { id: 'os-jpop', label: 'J-Pop', text: 'J-pop anime opening vibe, energetic drums and sparkling synth, uplifting, instrumental' },
          { id: 'os-indie', label: '独立流行', text: 'indie pop instrumental, dreamy guitars and soft beat, breezy, instrumental' },
          { id: 'os-rnb', label: 'R&B', text: 'smooth R&B instrumental, warm keys and soft groove, late-night mood, instrumental' },
          { id: 'os-soul', label: 'Soul', text: 'soulful instrumental, electric piano and gentle groove, emotional warmth, instrumental' },
          { id: 'os-disco', label: '迪斯科', text: 'disco funk instrumental, groovy bass and bright brass stabs, danceable, instrumental' },
          { id: 'os-retro', label: '复古流行', text: '80s retro pop instrumental, synthwave pads and gated drums, nostalgic neon, instrumental' },
        ],
      },
      {
        id: 'electronic',
        label: '电子',
        chips: [
          { id: 'os-edm', label: 'EDM', text: 'EDM festival instrumental, big drops and sidechain synths, high energy, instrumental' },
          { id: 'os-house', label: 'House', text: 'deep house instrumental, four-on-floor beat and warm bass, club night, instrumental' },
          { id: 'os-techno', label: 'Techno', text: 'dark techno instrumental, driving kick and industrial textures, hypnotic, instrumental' },
          { id: 'os-trance', label: 'Trance', text: 'uplifting trance instrumental, wide supersaws and emotional build, euphoric, instrumental' },
          { id: 'os-ambient', label: '氛围', text: 'ambient electronic pads, slow evolving textures, calm atmospheric BGM, instrumental' },
          { id: 'os-synthwave', label: '合成波', text: 'synthwave retro electronic, neon arps and analog bass, night drive, instrumental' },
          { id: 'os-cyberpunk', label: '赛博朋克', text: 'cyberpunk electronic, glitchy beats and dark synths, neon dystopia, instrumental' },
          { id: 'os-lofi', label: 'Lo-fi', text: 'lo-fi chill hop instrumental, dusty drums and soft keys, study vibes, instrumental' },
          { id: 'os-future-bass', label: 'Future Bass', text: 'future bass instrumental, supersaw chords and bouncy drums, colorful energy, instrumental' },
          { id: 'os-drum-bass', label: '鼓打贝斯', text: 'drum and bass instrumental, fast breakbeats and deep bass, intense, instrumental' },
        ],
      },
      {
        id: 'rock',
        label: '摇滚',
        chips: [
          { id: 'os-rock', label: '摇滚', text: 'classic rock instrumental, electric guitars and driving drums, powerful, instrumental' },
          { id: 'os-indie-rock', label: '独立摇滚', text: 'indie rock instrumental, jangly guitars and steady beat, youthful, instrumental' },
          { id: 'os-metal', label: '金属', text: 'metal instrumental, heavy guitars and double kick drums, aggressive energy, instrumental' },
          { id: 'os-punk', label: '朋克', text: 'punk rock instrumental, fast distorted guitars and raw drums, rebellious, instrumental' },
          { id: 'os-soft-rock', label: '软摇滚', text: 'soft rock ballad instrumental, clean guitars and warm drums, emotional, instrumental' },
          { id: 'os-post-rock', label: '后摇', text: 'post-rock instrumental, delayed guitars building to climax, cinematic emotion, instrumental' },
        ],
      },
      {
        id: 'hiphop',
        label: '嘻哈',
        chips: [
          { id: 'os-hiphop', label: '嘻哈', text: 'modern hip-hop instrumental, hard-hitting drums and bass, confident groove, instrumental' },
          { id: 'os-trap', label: 'Trap', text: 'trap beat instrumental, 808 bass and hi-hat rolls, dark swagger, instrumental' },
          { id: 'os-boom-bap', label: 'Boom Bap', text: 'boom bap hip-hop instrumental, dusty drums and sample-like keys, classic NYC feel, instrumental' },
          { id: 'os-drill', label: 'Drill', text: 'drill beat instrumental, sliding 808s and sharp hats, tense street energy, instrumental' },
        ],
      },
      {
        id: 'jazz-world',
        label: '爵士世界',
        chips: [
          { id: 'os-jazz', label: '爵士', text: 'smooth jazz instrumental, saxophone and soft swing drums, sophisticated lounge, instrumental' },
          { id: 'os-blues', label: '布鲁斯', text: 'blues guitar instrumental, soulful licks and slow groove, late bar mood, instrumental' },
          { id: 'os-bossa', label: '巴萨诺瓦', text: 'bossa nova instrumental, nylon guitar and soft percussion, sunny cafe, instrumental' },
          { id: 'os-latin', label: '拉丁', text: 'latin dance instrumental, lively percussion and brass, festive energy, instrumental' },
          { id: 'os-reggae', label: '雷鬼', text: 'reggae instrumental, offbeat guitar skank and warm bass, laid-back, instrumental' },
          { id: 'os-celtic', label: '凯尔特', text: 'celtic folk instrumental, tin whistle and fiddle, misty highlands, instrumental' },
          { id: 'os-middle-east', label: '中东', text: 'middle eastern cinematic instrumental, oud and frame drums, exotic tension, instrumental' },
          { id: 'os-india', label: '印度', text: 'indian fusion instrumental, sitar-like melody and tabla groove, mystical, instrumental' },
          { id: 'os-africa', label: '非洲', text: 'african percussion ensemble instrumental, polyrhythmic drums and warm tones, tribal energy, instrumental' },
        ],
      },
      {
        id: 'mood',
        label: '情绪氛围',
        chips: [
          { id: 'os-chill', label: '放松', text: 'relaxing chill instrumental, soft pads and gentle piano, calm spa mood, instrumental' },
          { id: 'os-melancholy', label: '忧郁', text: 'melancholy piano and soft strings, rainy window mood, instrumental' },
          { id: 'os-hope', label: '希望', text: 'hopeful uplifting instrumental, bright piano and rising strings, dawn feeling, instrumental' },
          { id: 'os-dark', label: '暗黑', text: 'dark atmospheric instrumental, low drones and sparse hits, ominous, instrumental' },
          { id: 'os-dreamy', label: '梦幻', text: 'dreamy ethereal instrumental, airy pads and soft arpeggios, floating, instrumental' },
          { id: 'os-tension', label: '压迫', text: 'tension building underscore, ticking percussion and low brass, countdown pressure, instrumental' },
          { id: 'os-victory', label: '胜利', text: 'triumphant victory fanfare, brass and timpani, celebratory climax, instrumental' },
          { id: 'os-comedy', label: '喜剧', text: 'quirky comedy underscore, playful pizzicato and woodwinds, lighthearted, instrumental' },
          { id: 'os-noir', label: '黑色电影', text: 'noir jazz crime underscore, smoky trumpet and walking bass, night city mystery, instrumental' },
          { id: 'os-documentary', label: '纪录感', text: 'documentary style underscore, subtle piano and soft strings, thoughtful neutral tone, instrumental' },
        ],
      },
    ],
  },
]

export function flattenMusicStyleChips(catalog = MUSIC_STYLE_CATALOG) {
  const list = []
  for (const region of catalog) {
    for (const group of region.groups || []) {
      for (const chip of group.chips || []) {
        list.push({
          ...chip,
          regionId: region.id,
          regionLabel: region.label,
          groupId: group.id,
          groupLabel: group.label,
        })
      }
    }
  }
  return list
}
