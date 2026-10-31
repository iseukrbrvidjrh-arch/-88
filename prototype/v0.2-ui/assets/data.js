/* SceneLingo V0.2 UI prototype — original mock learning data.
 * No real subtitles, no personal records, no network calls.
 */
window.SL_DATA = (() => {
  const dictionary = {
    a: { ipa: '/ə/', pos: 'art.', zh: '一个；某一' },
    answer: { ipa: '/ˈænsər/', pos: 'n.', zh: '回答；答案' },
    arms: { ipa: '/ɑrmz/', pos: 'n.', zh: '手臂（复数）' },
    arrived: { ipa: '/əˈraɪvd/', pos: 'v.', zh: '到达（arrive 的过去式）' },
    as: { ipa: '/æz/', pos: 'conj.', zh: '像；正如；当……时' },
    asked: { ipa: '/æskt/', pos: 'v.', zh: '问；要求（ask 的过去式）' },
    asks: { ipa: '/æsks/', pos: 'v.', zh: '问（ask 的第三人称单数）' },
    at: { ipa: '/æt/', pos: 'prep.', zh: '在；向' },
    bakery: { ipa: '/ˈbeɪkəri/', pos: 'n.', zh: '面包店' },
    be: { ipa: '/bi/', pos: 'v.', zh: '是；成为' },
    because: { ipa: '/bɪˈkɔz/', pos: 'conj.', zh: '因为' },
    before: { ipa: '/bɪˈfɔr/', pos: 'prep.', zh: '在……之前' },
    believed: { ipa: '/bɪˈlivd/', pos: 'v.', zh: '相信（believe 的过去式）' },
    bench: { ipa: '/bɛntʃ/', pos: 'n.', zh: '长椅' },
    big: { ipa: '/bɪɡ/', pos: 'adj.', zh: '大的；重大的' },
    bike: { ipa: '/baɪk/', pos: 'n.', zh: '自行车' },
    box: { ipa: '/bɑks/', pos: 'n.', zh: '箱子' },
    break: { ipa: '/breɪk/', pos: 'v.', zh: '拆解；打破' },
    breath: { ipa: '/brɛθ/', pos: 'n.', zh: '呼吸；一口气' },
    by: { ipa: '/baɪ/', pos: 'prep.', zh: '在……旁边；通过' },
    came: { ipa: '/keɪm/', pos: 'v.', zh: '来（come 的过去式）' },
    carried: { ipa: '/ˈkærid/', pos: 'v.', zh: '搬运（carry 的过去式）' },
    catch: { ipa: '/kætʃ/', pos: 'v.', zh: '抓住；赶上' },
    cinnamon: { ipa: '/ˈsɪnəmən/', pos: 'n.', zh: '肉桂' },
    city: { ipa: '/ˈsɪti/', pos: 'n.', zh: '城市' },
    coffee: { ipa: '/ˈkɔfi/', pos: 'n.', zh: '咖啡' },
    come: { ipa: '/kʌm/', pos: 'v.', zh: '来；亮起' },
    complained: { ipa: '/kəmˈpleɪnd/', pos: 'v.', zh: '抱怨（complain 的过去式）' },
    corner: { ipa: '/ˈkɔrnər/', pos: 'n.', zh: '街角；角落' },
    cup: { ipa: '/kʌp/', pos: 'n.', zh: '杯子' },
    decide: { ipa: '/dɪˈsaɪd/', pos: 'v.', zh: '决定' },
    different: { ipa: '/ˈdɪfərənt/', pos: 'adj.', zh: '不同的' },
    "didn't": { ipa: '/ˈdɪdənt/', pos: 'aux.', zh: '没有（did not 的缩写）' },
    door: { ipa: '/dɔr/', pos: 'n.', zh: '门' },
    down: { ipa: '/daʊn/', pos: 'adv.', zh: '向下；放慢' },
    early: { ipa: '/ˈɜrli/', pos: 'adv.', zh: '早；提前' },
    even: { ipa: '/ˈivən/', pos: 'adv.', zh: '甚至；即使' },
    extra: { ipa: '/ˈɛkstrə/', pos: 'adj.', zh: '额外的；多出来的' },
    feel: { ipa: '/fil/', pos: 'v.', zh: '感觉；觉得' },
    feeling: { ipa: '/ˈfilɪŋ/', pos: 'v.', zh: '感觉（feel 的现在分词）' },
    felt: { ipa: '/fɛlt/', pos: 'v.', zh: '感觉（feel 的过去式）' },
    few: { ipa: '/fju/', pos: 'adj.', zh: '几个；一些' },
    fill: { ipa: '/fɪl/', pos: 'v.', zh: '填满；充满' },
    first: { ipa: '/fɜrst/', pos: 'adj.', zh: '第一的；最初的' },
    fixed: { ipa: '/fɪkst/', pos: 'v.', zh: '修理（fix 的过去式）' },
    flights: { ipa: '/flaɪts/', pos: 'n.', zh: '一段楼梯（flight 的复数）' },
    for: { ipa: '/fɔr/', pos: 'prep.', zh: '为了；持续（一段时间）' },
    form: { ipa: '/fɔrm/', pos: 'n.', zh: '表格；形式' },
    forward: { ipa: '/ˈfɔrwərd/', pos: 'adv.', zh: '向前' },
    garden: { ipa: '/ˈɡɑrdən/', pos: 'n.', zh: '花园' },
    glass: { ipa: '/ɡlæs/', pos: 'n.', zh: '玻璃；玻璃杯' },
    had: { ipa: '/hæd/', pos: 'v.', zh: '有（have 的过去式）' },
    handed: { ipa: '/ˈhændɪd/', pos: 'v.', zh: '递给（hand 的过去式）' },
    handle: { ipa: '/ˈhændəl/', pos: 'v.', zh: '处理；应对' },
    head: { ipa: '/hɛd/', pos: 'v.', zh: '前往；朝向' },
    her: { ipa: '/hɜr/', pos: 'pron.', zh: '她；她的' },
    here: { ipa: '/hɪr/', pos: 'adv.', zh: '这里' },
    home: { ipa: '/hoʊm/', pos: 'n.', zh: '家；回家' },
    hour: { ipa: '/aʊər/', pos: 'n.', zh: '小时；时刻' },
    how: { ipa: '/haʊ/', pos: 'adv.', zh: '怎样；如何' },
    i: { ipa: '/aɪ/', pos: 'pron.', zh: '我' },
    if: { ipa: '/ɪf/', pos: 'conj.', zh: '如果；是否' },
    in: { ipa: '/ɪn/', pos: 'prep.', zh: '在……里；在……期间' },
    into: { ipa: '/ˈɪntu/', pos: 'prep.', zh: '进入；变成' },
    is: { ipa: '/ɪz/', pos: 'v.', zh: '是（be 的第三人称单数）' },
    it: { ipa: '/ɪt/', pos: 'pron.', zh: '它' },
    last: { ipa: '/læst/', pos: 'adj.', zh: '最后的；上一个的' },
    leaned: { ipa: '/lind/', pos: 'v.', zh: '倾身（lean 的过去式）' },
    left: { ipa: '/lɛft/', pos: 'v.', zh: '离开（leave 的过去式）' },
    lighter: { ipa: '/ˈlaɪtər/', pos: 'adj.', zh: '更轻的；更轻松的' },
    lights: { ipa: '/laɪts/', pos: 'n.', zh: '灯光（复数）' },
    like: { ipa: '/laɪk/', pos: 'v.', zh: '喜欢；像' },
    lock: { ipa: '/lɑk/', pos: 'v.', zh: '锁上' },
    looked: { ipa: '/lʊkt/', pos: 'v.', zh: '看（look 的过去式）' },
    looks: { ipa: '/lʊks/', pos: 'v.', zh: '看起来（look 的第三人称单数）' },
    make: { ipa: '/meɪk/', pos: 'v.', zh: '制作；冲（咖啡）' },
    manager: { ipa: '/ˈmænɪdʒər/', pos: 'n.', zh: '经理' },
    maya: { ipa: '/ˈmaɪə/', pos: 'n.', zh: '玛雅（人名）' },
    me: { ipa: '/mi/', pos: 'pron.', zh: '我（宾格）' },
    minutes: { ipa: '/ˈmɪnɪts/', pos: 'n.', zh: '分钟（复数）' },
    morning: { ipa: '/ˈmɔrnɪŋ/', pos: 'n.', zh: '早晨' },
    mornings: { ipa: '/ˈmɔrnɪŋz/', pos: 'n.', zh: '早晨（复数）' },
    my: { ipa: '/maɪ/', pos: 'pron.', zh: '我的' },
    next: { ipa: '/nɛkst/', pos: 'adj.', zh: '下一个；接下来的' },
    nobody: { ipa: '/ˈnoʊbədi/', pos: 'pron.', zh: '没有人' },
    nod: { ipa: '/nɑd/', pos: 'v.', zh: '点头' },
    of: { ipa: '/əv/', pos: 'prep.', zh: '……的' },
    offered: { ipa: '/ˈɔfərd/', pos: 'v.', zh: '提供；主动提出（offer 的过去式）' },
    old: { ipa: '/oʊld/', pos: 'adj.', zh: '旧的；年老的' },
    on: { ipa: '/ɑn/', pos: 'prep.', zh: '在……上；关于' },
    opening: { ipa: '/ˈoʊpənɪŋ/', pos: 'v.', zh: '打开；开始营业（open 的现在分词）' },
    our: { ipa: '/aʊər/', pos: 'pron.', zh: '我们的' },
    place: { ipa: '/pleɪs/', pos: 'n.', zh: '地方' },
    planted: { ipa: '/ˈplæntɪd/', pos: 'v.', zh: '种植（plant 的过去式）' },
    point: { ipa: '/pɔɪnt/', pos: 'v.', zh: '指向；指出' },
    pressure: { ipa: '/ˈprɛʃər/', pos: 'n.', zh: '压力' },
    problems: { ipa: '/ˈprɑbləmz/', pos: 'n.', zh: '问题（复数）' },
    quiet: { ipa: '/ˈkwaɪət/', pos: 'adj.', zh: '安静的' },
    real: { ipa: '/ril/', pos: 'adj.', zh: '真正的；真实的' },
    receptionist: { ipa: '/rɪˈsɛpʃənɪst/', pos: 'n.', zh: '前台接待员' },
    resume: { ipa: '/ˈrɛzəmeɪ/', pos: 'n.', zh: '简历' },
    river: { ipa: '/ˈrɪvər/', pos: 'n.', zh: '河流' },
    rolls: { ipa: '/roʊlz/', pos: 'n.', zh: '面包卷；卷状食物' },
    rooftop: { ipa: '/ˈruftɑp/', pos: 'n.', zh: '屋顶；天台' },
    rushed: { ipa: '/rʌʃt/', pos: 'adj.', zh: '匆忙的；仓促的' },
    said: { ipa: '/sɛd/', pos: 'v.', zh: '说（say 的过去式）' },
    sat: { ipa: '/sæt/', pos: 'v.', zh: '坐（sit 的过去式）' },
    satisfied: { ipa: '/ˈsætɪsfaɪd/', pos: 'adj.', zh: '满意的' },
    says: { ipa: '/sɛz/', pos: 'v.', zh: '说（say 的第三人称单数）' },
    seemed: { ipa: '/simd/', pos: 'v.', zh: '似乎（seem 的过去式）' },
    she: { ipa: '/ʃi/', pos: 'pron.', zh: '她' },
    sheet: { ipa: '/ʃit/', pos: 'n.', zh: '一片；一张' },
    six: { ipa: '/sɪks/', pos: 'num.', zh: '六' },
    smaller: { ipa: '/ˈsmɔlər/', pos: 'adj.', zh: '更小的' },
    smile: { ipa: '/smaɪl/', pos: 'n.', zh: '微笑' },
    soil: { ipa: '/sɔɪl/', pos: 'n.', zh: '土壤' },
    some: { ipa: '/sʌm/', pos: 'det.', zh: '一些；某些' },
    sore: { ipa: '/sɔr/', pos: 'adj.', zh: '酸痛的' },
    spring: { ipa: '/sprɪŋ/', pos: 'n.', zh: '春天；泉' },
    stairs: { ipa: '/stɛrz/', pos: 'n.', zh: '楼梯' },
    stay: { ipa: '/steɪ/', pos: 'v.', zh: '停留；待着' },
    steps: { ipa: '/stɛps/', pos: 'n.', zh: '步骤；脚步' },
    still: { ipa: '/stɪl/', pos: 'adv.', zh: '仍然；还' },
    stop: { ipa: '/stɑp/', pos: 'v.', zh: '停下；停止' },
    studio: { ipa: '/ˈstudioʊ/', pos: 'n.', zh: '工作室；演播室' },
    sunset: { ipa: '/ˈsʌnsɛt/', pos: 'n.', zh: '日落' },
    take: { ipa: '/teɪk/', pos: 'v.', zh: '拿；花费（时间）' },
    than: { ipa: '/ðæn/', pos: 'conj.', zh: '比' },
    that: { ipa: '/ðæt/', pos: 'det.', zh: '那个；那' },
    the: { ipa: '/ðə/', pos: 'art.', zh: '这；那（定冠词）' },
    then: { ipa: '/ðɛn/', pos: 'adv.', zh: '然后；那时' },
    this: { ipa: '/ðɪs/', pos: 'det.', zh: '这个；这' },
    though: { ipa: '/ðoʊ/', pos: 'conj.', zh: '虽然；尽管' },
    time: { ipa: '/taɪm/', pos: 'n.', zh: '时间；次数' },
    to: { ipa: '/tu/', pos: 'prep.', zh: '到；向；用于不定式' },
    together: { ipa: '/təˈɡɛðər/', pos: 'adv.', zh: '一起' },
    told: { ipa: '/toʊld/', pos: 'v.', zh: '告诉（tell 的过去式）' },
    tomatoes: { ipa: '/təˈmeɪtoʊz/', pos: 'n.', zh: '西红柿（复数）' },
    tour: { ipa: '/tʊr/', pos: 'n.', zh: '参观；游览' },
    up: { ipa: '/ʌp/', pos: 'adv.', zh: '向上；起来' },
    usual: { ipa: '/ˈjuʒuəl/', pos: 'n.', zh: '常点的那份；通常的' },
    wait: { ipa: '/weɪt/', pos: 'v.', zh: '等待' },
    waiting: { ipa: '/ˈweɪtɪŋ/', pos: 'v.', zh: '等待（wait 的现在分词）' },
    walked: { ipa: '/wɔkt/', pos: 'v.', zh: '走（walk 的过去式）' },
    want: { ipa: '/wɑnt/', pos: 'v.', zh: '想要' },
    was: { ipa: '/wʌz/', pos: 'v.', zh: '是（be 的过去式）' },
    watched: { ipa: '/wɑtʃt/', pos: 'v.', zh: '观看（watch 的过去式）' },
    we: { ipa: '/wi/', pos: 'pron.', zh: '我们' },
    weeks: { ipa: '/wiks/', pos: 'n.', zh: '周（复数）' },
    when: { ipa: '/wɛn/', pos: 'conj.', zh: '当……时' },
    while: { ipa: '/waɪl/', pos: 'conj.', zh: '当……的时候；而' },
    will: { ipa: '/wɪl/', pos: 'aux.', zh: '将会' },
    with: { ipa: '/wɪð/', pos: 'prep.', zh: '带着；和……一起' },
    woman: { ipa: '/ˈwʊmən/', pos: 'n.', zh: '女人' },
    work: { ipa: '/wɜrk/', pos: 'n.', zh: '工作' },
    worth: { ipa: '/wɜrθ/', pos: 'adj.', zh: '值得的' },
    your: { ipa: '/jʊr/', pos: 'pron.', zh: '你的' },
    streets: { ipa: '/strits/', pos: 'n.', zh: '街道（复数）' },
    usually: { ipa: '/ˈjuʒuəli/', pos: 'adv.', zh: '通常；一般' },
    and: { ipa: '/ænd/', pos: 'conj.', zh: '和；然后' },
    are: { ipa: '/ɑr/', pos: 'v.', zh: '是（be 的复数形式）' },
    slowing: { ipa: '/ˈsloʊɪŋ/', pos: 'v.', zh: '放慢（slow 的现在分词）' },
    were: { ipa: '/wɜr/', pos: 'v.', zh: '是（be 的过去式复数）' }
  };

  const episodes = [
    {
      id: 'morning-light',
      format: 'SRT',
      title: 'Morning Light',
      zh: '晨光之前',
      tag: '日常对话',
      level: '入门',
      duration: '01:18',
      progress: 0.42,
      tone: 'amber',
      note: '第 2 幕 · 河岸',
      scenes: [
        {
          heading: 'INT. KITCHEN — 6:40 A.M.',
          zh: '内景 · 厨房 — 早上 6:40',
          cues: [
            { id: 'ml-1', time: '00:04', text: 'The city is still quiet when I make my first cup of coffee.', zh: '城市还安静的时候，我冲了今天的第一杯咖啡。' },
            { id: 'ml-2', time: '00:09', text: 'I like this hour, before the streets fill up.', zh: '我喜欢这个时刻，街道还没有被人群填满。' },
            { id: 'ml-3', time: '00:14', text: 'My bike is waiting by the door, as usual.', zh: '我的自行车像往常一样在门边等着。' }
          ]
        },
        {
          heading: 'EXT. RIVERSIDE — 7:05 A.M.',
          zh: '外景 · 河边 — 早上 7:05',
          cues: [
            { id: 'ml-4', time: '00:20', text: 'The river looks like a sheet of glass this morning.', zh: '今天早上，河面看起来像一整片玻璃。' },
            { id: 'ml-5', time: '00:26', text: 'I usually stop here to catch my breath.', zh: '我通常会在这里停下来喘口气。' },
            { id: 'ml-6', time: '00:31', text: 'A woman is opening the bakery on the corner.', zh: '一位女士正在街角打开面包店的门。' }
          ]
        },
        {
          heading: 'INT. BAKERY — 7:20 A.M.',
          zh: '内景 · 面包店 — 早上 7:20',
          cues: [
            { id: 'ml-7', time: '00:37', text: 'She asks me if I want the usual.', zh: '她问我是不是还是老样子。' },
            { id: 'ml-8', time: '00:42', text: 'I nod and point at the cinnamon rolls.', zh: '我点点头，指了指肉桂卷。' },
            { id: 'ml-9', time: '00:48', text: '“Take your time,” she says with a smile.', zh: '“慢慢来，”她笑着说。' },
            { id: 'ml-10', time: '00:54', text: 'I decide to stay for a few extra minutes.', zh: '我决定多待几分钟。' },
            { id: 'ml-11', time: '01:00', text: 'Some mornings are worth slowing down for.', zh: '有些早晨，值得为它放慢脚步。' },
            { id: 'ml-12', time: '01:06', text: 'Then I lock my bike and head to work.', zh: '然后我锁好自行车，去上班。' }
          ]
        }
      ]
    },
    {
      id: 'the-interview',
      format: 'VTT',
      title: 'The Interview',
      zh: '面试日',
      tag: '职场场景',
      level: '进阶',
      duration: '00:56',
      progress: 0.18,
      tone: 'green',
      note: '第 1 幕 · 大堂',
      scenes: [
        {
          heading: 'INT. OFFICE LOBBY — 9:55 A.M.',
          zh: '内景 · 办公大堂 — 上午 9:55',
          cues: [
            { id: 'ti-1', time: '00:03', text: "I arrived early because I didn't want to feel rushed.", zh: '我到得很早，因为我不想显得匆忙。' },
            { id: 'ti-2', time: '00:09', text: 'The receptionist handed me a form and asked me to wait.', zh: '前台递给我一张表格，让我稍等。' }
          ]
        },
        {
          heading: 'INT. MEETING ROOM — 10:10 A.M.',
          zh: '内景 · 会议室 — 上午 10:10',
          cues: [
            { id: 'ti-3', time: '00:16', text: 'The manager looked at my resume and leaned forward.', zh: '经理看了看我的简历，身体向前倾。' },
            { id: 'ti-4', time: '00:22', text: 'She asked how I handle pressure at work.', zh: '她问我如何应对工作中的压力。' },
            { id: 'ti-5', time: '00:28', text: 'I told her I break big problems into smaller steps.', zh: '我告诉她，我会把大问题拆成小步骤。' },
            { id: 'ti-6', time: '00:34', text: 'She seemed satisfied with that answer.', zh: '她似乎对这个回答很满意。' },
            { id: 'ti-7', time: '00:40', text: 'Before I left, she offered me a tour of the studio.', zh: '离开前，她提出带我参观工作室。' },
            { id: 'ti-8', time: '00:46', text: 'I walked home feeling lighter than I had in weeks.', zh: '走回家的路上，我比过去几周都轻松。' }
          ]
        }
      ]
    },
    {
      id: 'rooftop-club',
      format: 'SRT',
      title: 'Rooftop Club',
      zh: '屋顶花园',
      tag: '生活故事',
      level: '入门',
      duration: '00:52',
      progress: 0,
      tone: 'blue',
      note: '第 1 幕 · 周六下午',
      scenes: [
        {
          heading: 'EXT. ROOFTOP — SATURDAY, 4:30 P.M.',
          zh: '外景 · 天台 — 周六下午 4:30',
          cues: [
            { id: 'rc-1', time: '00:03', text: 'We carried the last box of soil up six flights of stairs.', zh: '我们把最后一箱土搬上了六层楼。' },
            { id: 'rc-2', time: '00:10', text: 'Nobody complained, even though our arms were sore.', zh: '没有人抱怨，尽管手臂都酸了。' },
            { id: 'rc-3', time: '00:17', text: 'Maya planted tomatoes while I fixed the old bench.', zh: '玛雅种西红柿，我修那张旧长椅。' }
          ]
        },
        {
          heading: 'EXT. ROOFTOP — 6:00 P.M.',
          zh: '外景 · 天台 — 傍晚 6:00',
          cues: [
            { id: 'rc-4', time: '00:24', text: 'By sunset, the rooftop looked like a different place.', zh: '到日落时，屋顶看起来像换了个地方。' },
            { id: 'rc-5', time: '00:30', text: 'We sat together and watched the lights come on.', zh: '我们坐在一起，看灯光一盏盏亮起。' },
            { id: 'rc-6', time: '00:36', text: '“Next spring,” Maya said, “this will be a real garden.”', zh: '“明年春天，”玛雅说，“这里会是一座真正的花园。”' },
            { id: 'rc-7', time: '00:43', text: 'I believed her.', zh: '我相信她。' },
            { id: 'rc-8', time: '00:46', text: 'For the first time, the city felt like home.', zh: '我第一次觉得，这座城市像家。' }
          ]
        }
      ]
    }
  ];

  const seedWords = [
    { word: 'commute', status: 'mastered', source: 'Morning Light', added: '10月22日' },
    { word: 'quiet', status: 'mastered', source: 'Morning Light', added: '10月22日' },
    { word: 'bakery', status: 'learning', source: 'Morning Light', added: '10月24日' },
    { word: 'usual', status: 'mastered', source: 'Morning Light', added: '10月24日' },
    { word: 'cinnamon', status: 'learning', source: 'Morning Light', added: '10月25日' },
    { word: 'worth', status: 'mastered', source: 'Morning Light', added: '10月25日' },
    { word: 'receptionist', status: 'learning', source: 'The Interview', added: '10月27日' },
    { word: 'resume', status: 'learning', source: 'The Interview', added: '10月27日' },
    { word: 'pressure', status: 'learning', source: 'The Interview', added: '10月28日' },
    { word: 'satisfied', status: 'learning', source: 'The Interview', added: '10月28日' },
    { word: 'studio', status: 'learning', source: 'The Interview', added: '10月28日' },
    { word: 'soil', status: 'learning', source: 'Rooftop Club', added: '10月29日' },
    { word: 'complain', status: 'learning', source: 'Rooftop Club', added: '10月29日' },
    { word: 'bench', status: 'learning', source: 'Rooftop Club', added: '10月29日' },
    { word: 'sunset', status: 'mastered', source: 'Rooftop Club', added: '10月30日' },
    { word: 'garden', status: 'mastered', source: 'Rooftop Club', added: '10月30日' }
  ];

  // "commute" and "complain" are review-target words without a cue occurrence;
  // give them dictionary entries so every library card resolves.
  dictionary.commute = { ipa: '/kəˈmjuːt/', pos: 'v.', zh: '通勤；上下班往返', example: 'I commute to work by bike every morning.' };
  dictionary.complain = { ipa: '/kəmˈpleɪn/', pos: 'v.', zh: '抱怨；投诉', example: 'He never complains about the long hours.' };

  // Vocabulary used by the original reading-mode sample.
  Object.assign(dictionary, {
    again: { ipa: '/əˈɡɛn/', pos: 'adv.', zh: '再一次；又' },
    anything: { ipa: '/ˈɛniθɪŋ/', pos: 'pron.', zh: '任何事物' },
    art: { ipa: '/ɑrt/', pos: 'n.', zh: '艺术；技艺' },
    attention: { ipa: '/əˈtɛnʃən/', pos: 'n.', zh: '注意力；留意' },
    begin: { ipa: '/bɪˈɡɪn/', pos: 'v.', zh: '开始' },
    block: { ipa: '/blɑk/', pos: 'n.', zh: '街区；一段路' },
    can: { ipa: '/kæn/', pos: 'aux.', zh: '能够；可以' },
    change: { ipa: '/tʃeɪndʒ/', pos: 'v.', zh: '改变；变化' },
    day: { ipa: '/deɪ/', pos: 'n.', zh: '一天；白天' },
    delivery: { ipa: '/dɪˈlɪvəri/', pos: 'n.', zh: '配送；递送' },
    detail: { ipa: '/ˈditeɪl/', pos: 'n.', zh: '细节' },
    do: { ipa: '/du/', pos: 'v.', zh: '做；进行' },
    easy: { ipa: '/ˈizi/', pos: 'adj.', zh: '容易的；轻松的' },
    every: { ipa: '/ˈɛvri/', pos: 'det.', zh: '每一个' },
    forget: { ipa: '/fərˈɡɛt/', pos: 'v.', zh: '忘记' },
    habit: { ipa: '/ˈhæbɪt/', pos: 'n.', zh: '习惯' },
    has: { ipa: '/hæz/', pos: 'v.', zh: '有（have 的第三人称单数）' },
    have: { ipa: '/hæv/', pos: 'v.', zh: '有' },
    headphones: { ipa: '/ˈhɛdfoʊnz/', pos: 'n.', zh: '耳机（复数）' },
    hear: { ipa: '/hɪr/', pos: 'v.', zh: '听见' },
    heard: { ipa: '/hɜrd/', pos: 'v.', zh: '听见（hear 的过去式）' },
    important: { ipa: '/ɪmˈpɔrtənt/', pos: 'adj.', zh: '重要的' },
    leave: { ipa: '/liv/', pos: 'v.', zh: '留下；离开' },
    light: { ipa: '/laɪt/', pos: 'n.', zh: '光；光线' },
    listen: { ipa: '/ˈlɪsən/', pos: 'v.', zh: '听；倾听' },
    may: { ipa: '/meɪ/', pos: 'aux.', zh: '可能；可以' },
    miss: { ipa: '/mɪs/', pos: 'v.', zh: '错过；想念' },
    most: { ipa: '/moʊst/', pos: 'det.', zh: '大多数' },
    never: { ipa: '/ˈnɛvər/', pos: 'adv.', zh: '从不；从未' },
    none: { ipa: '/nʌn/', pos: 'pron.', zh: '没有一个；毫无' },
    not: { ipa: '/nɑt/', pos: 'adv.', zh: '不；没有' },
    notice: { ipa: '/ˈnoʊtɪs/', pos: 'v.', zh: '注意到；察觉' },
    now: { ipa: '/naʊ/', pos: 'adv.', zh: '现在；此刻' },
    one: { ipa: '/wʌn/', pos: 'num.', zh: '一；一个' },
    page: { ipa: '/peɪdʒ/', pos: 'n.', zh: '页；书页' },
    people: { ipa: '/ˈpipəl/', pos: 'n.', zh: '人们' },
    phone: { ipa: '/foʊn/', pos: 'n.', zh: '手机；电话' },
    practice: { ipa: '/ˈpræktɪs/', pos: 'n.', zh: '练习；习惯做法' },
    reach: { ipa: '/ritʃ/', pos: 'v.', zh: '伸手去拿；到达' },
    rewards: { ipa: '/rɪˈwɔrdz/', pos: 'v.', zh: '奖励；回报' },
    room: { ipa: '/rum/', pos: 'n.', zh: '房间' },
    rule: { ipa: '/rul/', pos: 'n.', zh: '规则；规定' },
    screen: { ipa: '/skrin/', pos: 'n.', zh: '屏幕' },
    see: { ipa: '/si/', pos: 'v.', zh: '看见；明白' },
    shape: { ipa: '/ʃeɪp/', pos: 'n.', zh: '形状；状态' },
    slowly: { ipa: '/ˈsloʊli/', pos: 'adv.', zh: '缓慢地' },
    small: { ipa: '/smɔl/', pos: 'adj.', zh: '小的；细微的' },
    something: { ipa: '/ˈsʌmθɪŋ/', pos: 'pron.', zh: '某事；某物' },
    street: { ipa: '/strit/', pos: 'n.', zh: '街道' },
    table: { ipa: '/ˈteɪbəl/', pos: 'n.', zh: '桌子' },
    talent: { ipa: '/ˈtælənt/', pos: 'n.', zh: '天赋；才能' },
    ten: { ipa: '/tɛn/', pos: 'num.', zh: '十' },
    them: { ipa: '/ðɛm/', pos: 'pron.', zh: '他们；它们（宾格）' },
    theory: { ipa: '/ˈθiəri/', pos: 'n.', zh: '理论；看法' },
    tomorrow: { ipa: '/təˈmɑroʊ/', pos: 'adv.', zh: '明天' },
    try: { ipa: '/traɪ/', pos: 'v.', zh: '尝试；试着' },
    turning: { ipa: '/ˈtɜrnɪŋ/', pos: 'v.', zh: '转弯（turn 的现在分词）' },
    us: { ipa: '/ʌs/', pos: 'pron.', zh: '我们（宾格）' },
    used: { ipa: '/juzd/', pos: 'v.', zh: '过去常常（used to）' },
    wake: { ipa: '/weɪk/', pos: 'v.', zh: '醒来；唤醒' },
    walk: { ipa: '/wɔk/', pos: 'v.', zh: '走路；散步' },
    who: { ipa: '/hu/', pos: 'pron.', zh: '谁；……的人' },
    why: { ipa: '/waɪ/', pos: 'adv.', zh: '为什么' },
    without: { ipa: '/wɪˈðaʊt/', pos: 'prep.', zh: '没有；不带' },
    yet: { ipa: '/jɛt/', pos: 'adv.', zh: '还；尚未' },
    you: { ipa: '/ju/', pos: 'pron.', zh: '你；你们' }
  });

  dictionary.read = {
    ipa: '/rid/', pos: 'v.', zh: '读；阅读',
    pronunciations: [
      { label: '现在式', ipa: '/rid/', pos: 'v.', zh: '读；阅读' },
      { label: '过去式', ipa: '/rɛd/', pos: 'v.', zh: '读了；阅读过' }
    ]
  };
  dictionary.record = {
    ipa: '/rɪˈkɔrd/', pos: 'v.', zh: '记录；录制',
    pronunciations: [
      { label: '动词', ipa: '/rɪˈkɔrd/', pos: 'v.', zh: '记录；录制' },
      { label: '名词', ipa: '/ˈrɛkərd/', pos: 'n.', zh: '记录；唱片' }
    ]
  };

  const materials = [
    {
      id: 'morning-light', kind: 'subtitle', format: 'SRT', title: 'Morning Light', zh: '晨光之前',
      category: 'subtitle', typeLabel: '影视字幕', level: '入门', topic: '日常对话', progress: 42,
      meta: '12 句 · 01:18', updated: '今天 10:05', tone: 'amber', available: true, episodeId: 'morning-light'
    },
    {
      id: 'the-interview', kind: 'subtitle', format: 'VTT', title: 'The Interview', zh: '面试日',
      category: 'subtitle', typeLabel: '影视字幕', level: '进阶', topic: '职场场景', progress: 18,
      meta: '8 句 · 00:56', updated: '10月28日', tone: 'green', available: true, episodeId: 'the-interview'
    },
    {
      id: 'rooftop-club', kind: 'subtitle', format: 'SRT', title: 'Rooftop Club', zh: '屋顶花园',
      category: 'subtitle', typeLabel: '影视字幕', level: '入门', topic: '生活故事', progress: 0,
      meta: '8 句 · 00:52', updated: '尚未开始', tone: 'blue', available: true, episodeId: 'rooftop-club'
    },
    {
      id: 'a-small-theory', kind: 'article', format: 'TXT', title: 'A Small Theory of Mornings', zh: '关于早晨的一点观察',
      category: 'article', typeLabel: '英文文章', level: '入门', topic: '生活随笔', progress: 0,
      meta: '2 章 · 约 260 词', updated: '界面预览', tone: 'gold', available: false, preview: true
    },
    {
      id: 'slow-reading', kind: 'article', format: 'MD', title: 'Notes on Slow Reading', zh: '慢读笔记',
      category: 'article', typeLabel: '英文文章', level: '进阶', topic: '学习方法', progress: 0,
      meta: '3 章 · 约 640 词', updated: '待开发', tone: 'sage', available: false
    },
    {
      id: 'quiet-hours', kind: 'ebook', format: 'EPUB', title: 'The Quiet Hours', zh: '安静的时刻',
      category: 'ebook', typeLabel: '英文电子书', level: '进阶', topic: '短篇故事', progress: 0,
      meta: '12 章 · 英文原版', updated: '待开发', tone: 'rose', available: false
    },
    {
      id: 'riverside-notes', kind: 'pdf', format: 'PDF', title: 'Riverside Field Notes', zh: '河边观察笔记',
      category: 'pdf', typeLabel: '可提取 PDF', level: '入门', topic: '自然观察', progress: 0,
      meta: '24 页 · 图文', updated: '待开发', tone: 'slate', available: false
    }
  ];

  const articles = [
    {
      id: 'a-small-theory',
      title: 'A Small Theory of Mornings',
      zh: '关于早晨的一点观察',
      format: 'TXT',
      notice: '后端文本解析尚未接入，以下为原创内容的阅读模式界面预览。',
      chapters: [
        {
          id: 'theory-1',
          title: 'A Small Theory of Mornings',
          zh: '关于早晨的一点观察',
          paragraphs: [
            {
              id: 'theory-1-p1',
              text: 'Most mornings begin before we notice them. The room is quiet, the street is still, and the day has not asked anything of us yet.',
              zh: '大多数早晨在我们察觉之前就已经开始。房间很安静，街道还没有醒，这一天也尚未向我们索取什么。'
            },
            {
              id: 'theory-1-p2',
              text: 'I used to wake up and reach for my phone. Now I leave it on the table, read one page, and make coffee. Ten minutes without a screen can change the shape of a morning.',
              zh: '我以前醒来就伸手去拿手机。现在我会把手机留在桌上，读一页书，再冲咖啡。十分钟不看屏幕，就能改变一个早晨的样子。'
            },
            {
              id: 'theory-1-p3',
              text: 'This is not a rule. It is a small practice. When I forget, I begin again the next day.',
              zh: '这不是一条规则，只是一种小小的练习。忘记的时候，第二天重新开始就好。'
            }
          ]
        },
        {
          id: 'theory-2',
          title: 'The Art of Noticing',
          zh: '留意的练习',
          paragraphs: [
            {
              id: 'theory-2-p1',
              text: 'A city rewards people who walk slowly. You see the bakery opening, the delivery bike turning the corner, and the first light on the river.',
              zh: '城市会奖励那些慢慢走路的人。你能看见面包店开门、送货车转过街角，以及河面上的第一缕光。'
            },
            {
              id: 'theory-2-p2',
              text: 'None of this is important, and that is why it is easy to miss. I do not record every detail. Attention is a habit, not a talent.',
              zh: '这些事都算不上重要，也正因如此很容易被错过。我不会记录每一个细节。留意是一种习惯，而不是天赋。'
            },
            {
              id: 'theory-2-p3',
              text: 'Try this tomorrow: leave your headphones at home and listen for one block. You may hear something you have never heard before.',
              zh: '明天可以试试：把耳机留在家里，走过一个街区，只听周围的声音。你也许会听见以前从未听见的东西。'
            }
          ]
        }
      ]
    }
  ];

  return {
    dictionary,
    episodes,
    seedWords,
    materials,
    articles,
    weekly: [
      { day: '周六', minutes: 38 }, { day: '周日', minutes: 52 }, { day: '周一', minutes: 26 },
      { day: '周二', minutes: 48 }, { day: '周三', minutes: 64 }, { day: '周四', minutes: 45 },
      { day: '今天', minutes: 14 }
    ],
    heatmap: [0,1,1,0,2,3,1, 0,2,3,2,1,0,1, 1,3,4,2,3,1,0, 2,4,3,4,2,1,1, 0,2,3,4,3,2,1],
    recentActivity: [
      { title: '复习了 8 个生词', meta: '今天 · 11:20', kind: 'review' },
      { title: '完成 Morning Light 第 2 幕', meta: '今天 · 10:05', kind: 'episode' },
      { title: '加入 2 个生词', meta: '昨天 · 21:12', kind: 'word' },
      { title: '完成 The Interview 第 1 幕', meta: '10月28日 · 20:40', kind: 'episode' }
    ]
  };
})();
