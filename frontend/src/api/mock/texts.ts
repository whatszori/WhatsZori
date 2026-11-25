// Short exchanges the mock history is stitched from, so a scroll back reads like a real chat.
// Each line is "<role>: <text>". Roles: m = you, a/b/c = the other people (in a 1:1 all of
// them are the contact). Media lines: "[photo] caption", "[video]", "[voice]", "[doc name.ext]".
export type Snippet = readonly string[];

export type Topic =
  | 'friend'
  | 'work'
  | 'mum'
  | 'ru-friend'
  | 'ja-work'
  | 'team'
  | 'hike'
  | 'football'
  | 'climb'
  | 'books'
  | 'house'
  | 'photo'
  | 'announce'
  | 'ru-family'
  | 'ru-oldfriends'
  | 'ru-course';

const FRIEND: Snippet[] = [
  [
    'a: Are you up for lunch tomorrow?',
    'm: Yes! Usual place?',
    "a: Let's try the new ramen spot by the station",
    'm: Deal. 12:30?',
    'a: 👍',
  ],
  [
    'm: Did you get home ok?',
    'a: Yep, the last train was packed but fine',
    'a: Thanks for tonight, that was fun',
    'm: Same, we should do it more often',
  ],
  [
    'a: Okay I need your honest opinion',
    'a: [photo]',
    'a: Too much for a living room?',
    'm: Honestly? I love it',
    'm: Maybe not above the sofa though',
    'a: Haha fair',
  ],
  ['m: Happy Monday 🙃', "a: Don't", "a: I've had three meetings already and it's 10am"],
  [
    'a: Can you send me that soup recipe from Saturday?',
    'm: The lentil one?',
    'a: Yes!!',
    "m: https://example.com/recipes/red-lentil-soup it's basically this but with more ginger",
    'a: Thank you, making it tonight',
  ],
  [
    'a: Running 10 min late, sorry!',
    "m: No worries, I'm grabbing a table",
    "a: Get me a flat white if they're still doing them",
  ],
  [
    'm: Are you watching the new season?',
    'a: Two episodes in. No spoilers!!',
    'm: My lips are sealed',
    'm: But episode 4. Just wait.',
  ],
  ['a: [voice]', 'm: Haha ok, call you after work', 'a: 👌'],
  [
    'a: Do you still have my umbrella by any chance?',
    "m: Oh no. Yes. It's been in my hallway for two weeks",
    "a: Haha keep it till Friday, I'll grab it then",
  ],
  [
    'm: Look who I ran into',
    'm: [photo]',
    'a: NO WAY',
    'a: Say hi from me!',
    'm: She says hi back and that you owe her a coffee',
  ],
  [
    "a: What are you doing for New Year's?",
    'm: No plans yet. You?',
    'a: Thinking of renting a cabin with a few people',
    'a: You in?',
    'm: Very much in',
    "a: I'll make a group",
  ],
  [
    'a: Did you book the dentist in the end?',
    'm: Thursday at 8:15',
    'a: Brave',
    'm: It was that or three weeks from now',
  ],
  [
    'm: Is the market on this Saturday?',
    'a: I think so, until 2',
    'm: Want to go together? I need bread and flowers',
    'a: Yes, pick me up at 11',
  ],
  [
    "a: Help, what's the name of that café with the blue door?",
    'm: The one near the bridge? Corner House',
    "a: That's it, thank you!!",
  ],
  [
    'a: Sorry I missed your call',
    'a: Was at the cinema',
    "m: No worries, it wasn't urgent",
    'm: Just wanted to ask if you need anything from the city',
  ],
  [
    'm: [photo] Made the bread from your recipe',
    'a: Look at that crust!',
    'a: Proud of you',
    "m: It's a bit flat but it tastes great",
  ],
  [
    "a: Good luck today, you'll be great",
    'm: Thank you 🙏 slightly terrified',
    "a: You prepared so much, it'll be fine",
    'm: Will report back',
  ],
  [
    'm: How did it go?',
    'a: They offered me the job!!',
    'm: AAAH congratulations!!',
    'm: Drinks on me this week',
    'a: Holding you to that',
  ],
  [
    'a: Is it just me or is it freezing today',
    "m: It's not just you, I'm wearing two jumpers inside",
    'a: Winter is officially here',
  ],
  [
    'm: Can I borrow your drill this weekend?',
    "a: Sure, it's in the box by the door",
    'a: The battery takes forever to charge, plug it in on Friday',
    'm: Noted, thanks!',
  ],
  ['a: [video]', 'a: The dog discovered snow', "m: 😂😂 I've watched this five times"],
  ['m: Pizza tonight?', 'a: Always', 'a: Margherita and the spicy one?', 'm: Ordering now'],
  [
    "a: How's your mum doing?",
    "m: Much better, she's been home since Tuesday",
    'a: So glad to hear that ❤️',
    'm: Thanks for asking, really',
  ],
  [
    'm: What was the book you recommended?',
    'a: The one about the lighthouse keeper?',
    'm: Yes!',
    "a: The Quiet Light. You'll love it",
  ],
  [
    'a: Just landed!',
    'm: Welcome back! How was it?',
    'a: Amazing, but I need a holiday from my holiday',
    'a: Photos coming soon',
  ],
  [
    'a: [photo]',
    'a: [photo]',
    'a: [photo] Last one, I promise',
    'm: These are gorgeous',
    'm: Where was the second one taken?',
    'a: Tiny village up in the hills, I forgot the name already',
  ],
  [
    'm: Can you remind me what time the thing on Sunday is?',
    'a: Brunch at 11, then the exhibition at 2',
    'm: Perfect, thanks',
  ],
  [
    'a: Quick q, do you still have the charger I lent you?',
    'm: Yes, sorry, bringing it tomorrow',
    'a: No rush',
  ],
  ['m: Good morning ☀️', 'a: Morning! Coffee in 15?', "m: Make it 20 and you've got a deal"],
  [
    'a: Are you coming to the quiz on Thursday?',
    'm: Wouldn’t miss it',
    'a: Good, we need someone who knows geography',
    'm: I know where Portugal is. That’s about it',
  ],
];

const WORK: Snippet[] = [
  ['a: Got a minute for a quick call?', 'm: In 10?', 'a: Perfect'],
  [
    'a: Can you review my PR before Friday?',
    'm: Sure, send me the link',
    'a: https://example.com/review/482',
    'm: Looking now',
    'm: Left two small comments, otherwise good to go',
  ],
  [
    'm: Are you in the office tomorrow?',
    'a: Only in the morning, dentist at 2',
    "m: Ok, let's sync at 10 then",
  ],
  [
    'a: [doc Q3-report.pdf]',
    'a: Numbers for the meeting, page 4 is the interesting one',
    'm: Thanks, will read it on the train',
  ],
  [
    'a: The build is failing on main again',
    'm: Ugh, the date test?',
    'a: Yep, it only fails after 11pm 😅',
    "m: I'll pin the timezone in the test",
  ],
  ['m: Running 5 min late to standup, start without me', 'a: No problem'],
  ['a: Do you have the latest mockups?', 'm: [doc wireframes-v4.fig]', 'a: Lifesaver, thanks'],
  ['a: Lunch?', 'm: 12:30 downstairs?', 'a: 👍'],
  [
    'm: Thanks for jumping in on the call today',
    'a: Of course! I think it went well',
    'm: Yeah, they seemed happy with the timeline',
  ],
  ["a: I'm off on Friday btw, Grace is covering", 'm: Noted, enjoy the long weekend!'],
  ['a: Can we push our 1:1 to Thursday?', 'm: Sure, same time?', 'a: Same time works'],
  [
    'm: Did the client reply about the invoice?',
    "a: Not yet, I'll chase them tomorrow",
    'a: [doc invoice_0412.pdf]',
    'a: This is the one we sent',
  ],
  [
    'a: Small win: the page loads in under a second now',
    'm: 🔥 nice work',
    'a: Turns out we were loading every avatar twice',
  ],
  [
    'm: Is the release still on for Tuesday?',
    'a: As far as I know, yes',
    'a: Unless QA finds something tomorrow',
  ],
  ['a: Heads up, the fire alarm test is at 11', "m: Thanks, I'll take my call outside"],
  [
    'a: Are you joining the team dinner on the 12th?',
    'm: Yes! Put me down',
    'a: Great. Any dietary stuff?',
    "m: Nope, I'm easy",
  ],
];

const MUM: Snippet[] = [
  ['a: Ты поел?', 'm: Да, мам 🙂', 'a: Тепло одевайся, завтра похолодание'],
  ['a: Позвони, когда будет минутка', 'm: Вечером наберу, хорошо?', 'a: Хорошо, целую'],
  [
    'a: [photo] Испекла пирог по бабушкиному рецепту',
    'm: Выглядит потрясающе 😍',
    'a: Приезжай, оставлю кусочек',
  ],
  [
    'm: Как у папы давление?',
    'a: Получше, врач выписал новые таблетки',
    'm: Хорошо, держите в курсе',
  ],
  [
    'a: Купи, пожалуйста, хлеб по дороге',
    'm: Ок, ещё что-нибудь?',
    'a: Молоко и яйца, если не трудно',
  ],
  ['a: [voice]', 'm: Мам, я на работе, перезвоню в обед'],
  ['a: Ты видел, что Оля выложила?', 'm: Да, классные фото с моря', 'a: Хорошо отдохнули'],
  ['a: С днём рождения, сынок! ❤️ Будь здоров и счастлив', 'm: Спасибо, мам! Вечером заеду'],
];

const RU_FRIEND: Snippet[] = [
  [
    'a: Привет! Как дела?',
    'm: Привет! Нормально, работы много. Ты как?',
    'a: Тоже, ну хоть пятница скоро',
    'm: Держимся 😅',
  ],
  ['a: Буду через полчаса', 'm: Ок, я уже на месте', 'a: Займи столик у окна'],
  ['m: Скинь адрес, пожалуйста', 'a: Садовая 14, второй подъезд, домофон 23', 'm: Спасибо!'],
  [
    'a: Ты в субботу как, свободен?',
    'm: Вроде да, а что?',
    'a: Хотим на шашлыки выбраться, если погода будет',
    'm: Я за!',
  ],
  ['a: Звонил тебе, не дозвонился', 'm: Был на встрече, сейчас наберу'],
  [
    'a: [photo]',
    'a: Смотри, что нашёл в шкафу',
    'm: Ахаха, это же выпускной!',
    'a: Ты тут вообще не изменился',
  ],
  ['m: Ты книгу прочитал, которую я дал?', 'a: Почти, осталось глав пять', 'a: Затянуло, честно'],
  ['a: С днём рождения! 🎉 Здоровья, счастья и чтобы всё получалось', 'm: Спасибо огромное! 🙏'],
  ['a: [voice]', 'm: Понял, давай завтра обсудим', 'a: 👍'],
  ['m: Как съездил?', 'a: Отлично, но устал как собака', 'a: Фото потом скину', 'm: Жду!'],
  ['a: Не забудь про воскресенье', 'm: Помню-помню, в 12?', 'a: В 12 у фонтана'],
  [
    'm: Посоветуй мастера по ремонту ноутбуков',
    'a: Есть один, скину контакт',
    'a: Скажи, что от меня',
  ],
  ['a: Всё в силе на завтра?', 'm: Да, конечно', 'a: Отлично, договорились'],
  [
    'a: Пойдём в кино в пятницу?',
    'm: На что?',
    'a: На новый фильм про космос, все хвалят',
    'm: Давай, бери билеты, я переведу',
  ],
  [
    'm: Ты дома?',
    'a: Буду через час',
    'm: Хотел занести твою дрель',
    'a: Оставь соседке, она передаст',
  ],
];

const JA_WORK: Snippet[] = [
  ['a: お疲れさまです', 'm: お疲れさまです！', 'a: 明日の会議は10時からです', 'm: 了解しました'],
  ['a: 資料を共有しました', 'a: [doc 提案書_v2.pdf]', 'm: ありがとうございます！確認してみます'],
  [
    'm: Thanks for the meeting today!',
    'a: こちらこそありがとうございました',
    "a: Let's talk again next week",
  ],
  ['a: 少し遅れます、すみません', 'm: 大丈夫です、ゆっくりどうぞ'],
  ['a: 来週東京に来られますか？', 'm: Yes, from Tuesday', 'a: いいですね、ご飯行きましょう'],
];

const TEAM: Snippet[] = [
  [
    'a: Morning all, standup in 5',
    'b: Joining in a sec',
    'c: Can someone share the board?',
    'a: Link is in the invite',
  ],
  [
    'a: Who has the latest export of the survey results?',
    'm: I do, sharing now',
    'm: [doc survey-results.xlsx]',
    'b: Thanks!',
  ],
  [
    'a: Reminder: retro is at 3 today',
    'b: Can we move it to 3:30? I have a clash',
    'a: Fine by me',
    'c: 👍',
  ],
  [
    'b: Staging is down',
    'c: Looking into it',
    'c: Back up, someone filled the disk with logs',
    'a: Classic',
  ],
  [
    'a: Does anyone have the wifi password for the meeting room?',
    "b: It's on the whiteboard next to the door",
    'a: Found it, thanks',
  ],
  [
    'c: [photo] The new office plants have arrived',
    'a: Finally some green',
    "b: Who's watering them though",
    'c: Not me, I kill cactuses',
  ],
  [
    'a: Can we keep the copy shorter on the empty state?',
    'b: Agreed, two lines max',
    "m: I'll update the doc",
    'a: 🙏',
  ],
  [
    'b: Coffee run, anyone?',
    'a: Oat flat white please!',
    'c: Same',
    'm: Black coffee for me, thanks!',
  ],
  [
    'a: Draft agenda for Thursday',
    'a: [doc agenda-thursday.pdf]',
    'c: Can we add 10 min for the hiring update?',
    'a: Added',
  ],
  [
    'c: Did you see the latest build? The sidebar feels much snappier',
    'b: Yes! Huge difference on my old laptop',
    'a: Nice work everyone',
  ],
  ['a: Who is bringing the projector?', "b: I'll grab it from the 3rd floor", 'a: Thanks!'],
  [
    "b: I'm out sick today, sorry everyone",
    'a: Feel better!',
    "c: Rest up, we've got it",
    'm: Get well soon',
  ],
  [
    "a: Cake in the kitchen, it's my birthday 🎂",
    'b: Happy birthday!!',
    'c: 🎉🎉',
    'm: Happy birthday! Save me a slice',
  ],
  [
    'c: Pushed a fix for the crash on startup',
    'a: Legend',
    'b: Can confirm, works on my machine now',
  ],
  ['a: Small reminder to fill in your hours by Friday', 'b: Done', 'c: Doing it now'],
  [
    'b: Can someone review the copy for the onboarding emails?',
    'm: I can take a look after lunch',
    'b: Thanks!',
  ],
  ['a: Client call moved to 4pm', 'c: Is it still the same link?', 'a: Same link'],
  ['b: [photo] Whiteboard from today, before someone wipes it', 'a: Thank you, I was about to ask'],
];

const HIKE: Snippet[] = [
  [
    'a: Forecast for Saturday looks good, 12° and sunny',
    'b: Finally!',
    'c: Which route?',
    'a: The ridge loop, about 14 km',
    "m: I'm in",
    'b: Me too',
  ],
  [
    "b: Who's driving?",
    'a: I can take 3 people',
    "c: I'll drive too",
    'm: Can I jump in with you?',
    'a: Of course',
  ],
  ['a: [photo] Made it to the top!', 'c: That view 😍', "b: Next time I'm coming for sure"],
  [
    'c: Meeting point 8:00 at the station?',
    'a: 8:15, the first train is at 8:05',
    'c: Right, 8:15',
    'm: See you there',
  ],
  ['b: Does anyone have spare poles? Mine broke', 'a: I have an extra pair', 'b: Lifesaver'],
  ['a: [photo]', 'a: [photo] The hut was open, they had soup', 'c: Best soup of my life honestly'],
  ['c: Rain on Saturday, move to Sunday?', 'a: Sunday works', 'b: Sunday 👍', 'm: Works for me'],
];

const FOOTBALL: Snippet[] = [
  ['a: Game on Sunday, 10am, same pitch', 'b: In', 'c: In, but might be 10 min late', 'm: In'],
  [
    'c: We need one more for Sunday, can anyone bring a friend?',
    'a: My cousin might come',
    'c: Perfect',
  ],
  ['a: Great game today 💪', 'b: My legs disagree', 'c: Same time next week?', 'm: 👍'],
  ['b: Pub after?', 'a: Obviously', "c: I'll get the first round"],
  ['a: [video] That goal though', 'b: Pure luck', 'c: Pure skill you mean'],
  ['b: Who has the bibs?', 'c: Me, washed and everything', 'a: A hero'],
];

const CLIMB: Snippet[] = [
  ['a: Bouldering tonight at 7?', 'b: My fingers still hurt from Tuesday 😅', "a: So that's a yes"],
  ['b: [video] Finally sent the blue one', 'a: Yesss! That heel hook', 'm: Clean!'],
  ['a: They reset the whole back wall', 'b: Oh no, my project', 'a: New projects 💪'],
];

const BOOKS: Snippet[] = [
  [
    "a: Next pick: let's vote by Sunday",
    "b: I'd love something short after the last one 😅",
    'c: Seconded',
  ],
  [
    'a: Finished it last night. That ending!!',
    "b: Don't! I'm on chapter 12",
    'c: No spoilers please',
  ],
  ["c: Meeting at mine on Thursday? I'll make soup", 'a: Yes please', "b: I'll bring wine"],
  ['b: [photo] Current reading spot', 'a: Jealous of that window', 'c: Is that the new edition?'],
  ['a: Who still has my copy of the last one?', 'c: Me, sorry! Bringing it Thursday'],
];

const HOUSE: Snippet[] = [
  ['a: Did anyone take the parcel from the hallway?', "b: Yes, it's in the kitchen", 'a: Thanks!'],
  [
    'b: The heating guy is coming Wednesday between 9 and 1',
    'c: I can be home in the morning',
    'b: Amazing, thank you',
  ],
  ['c: We are out of dish soap again', 'a: On my list', "m: I'll grab some on the way home"],
  ["a: Recycling goes out tonight, don't forget", 'b: Done ✅'],
  [
    "b: Who left the window open? It's freezing in here",
    'c: Sorry, that was me, I was airing the kitchen',
  ],
  ['a: Does anyone have a ladder I could borrow?', 'c: Yes, come by after 6', 'a: Thank you!'],
  [
    'b: Lost: grey cat, very fluffy, answers to Biscuit',
    'a: Oh no! Will keep an eye out',
    'b: Found him, he was in the basement 🙈',
    'c: Phew',
  ],
  ['a: Reminder: the water will be off on Thursday from 10 to 2'],
];

const PHOTO: Snippet[] = [
  [
    'a: [photo] Golden hour from the bridge',
    'b: Gorgeous colours',
    'c: What lens?',
    'a: The 35mm, wide open',
  ],
  ['b: Photo walk on Sunday morning?', "a: If it's foggy, absolutely", 'c: Fog = best light'],
  ['c: [photo]', 'c: [photo] Two from the market', 'a: Love the second one'],
];

const ANNOUNCE: Snippet[] = [
  ['a: The office is closed on Monday for the public holiday'],
  ['a: Reminder: please fill in your hours by Friday'],
  ['b: Welcome to our three new joiners this week! Say hi in the kitchen 👋'],
  ['a: The kitchen gets a deep clean on Friday, please take your things out of the fridge'],
  ['a: Fire alarm test tomorrow at 11, no need to leave the building'],
  ['b: [doc holiday-schedule-2026.pdf]', 'b: Holiday schedule for next year'],
  ['a: Parking lot B is closed next week for repairs'],
  ['b: Lunch & learn on Thursday: accessibility basics, room 3, pizza provided 🍕'],
];

const RU_FAMILY: Snippet[] = [
  ['a: Всем доброе утро ☀️', 'b: Доброе!', 'c: Доброе утро 🙂'],
  ['a: [photo] Наш снеговик', 'b: Какой красавец!', 'c: Соня лепила?', 'a: Да, с дедушкой'],
  [
    'b: Кто в субботу сможет помочь на даче?',
    'c: Я до обеда могу',
    'm: Я приеду к 11',
    'b: Спасибо, дети ❤️',
  ],
  ['a: Напоминаю: у бабушки юбилей 14-го', 'c: Помним!', 'm: Да, записал в календарь'],
  ['c: [video] Соня первый раз на коньках', 'a: Умница какая!', 'b: 👏👏👏'],
  ['b: Не забудьте поздравить дядю Мишу, у него сегодня день рождения', 'm: Уже позвонил 🙂'],
  ['a: [voice]', 'c: Мам, мы в пробке, будем через полчаса'],
];

const RU_OLDFRIENDS: Snippet[] = [
  [
    'a: Ну что, встречаемся в этом году?',
    'b: Давно пора',
    'c: Я за, только не в декабре',
    'a: Тогда конец ноября?',
  ],
  [
    'b: [photo] Нашёл старую фотку с выпускного',
    'a: Ахаха, какие мы молодые',
    'c: Кто это слева в шляпе?',
    'b: Это ты 😂',
  ],
  ['c: Поздравляю с новой работой! 🎉', 'a: Спасибо, ребята!'],
];

const RU_COURSE: Snippet[] = [
  [
    'a: Домашка на четверг: упражнения 3 и 4',
    'b: Спасибо!',
    'c: А аудио где взять?',
    'a: Скинула в чат на прошлой неделе',
  ],
  ['b: Опоздаю минут на 10, начинайте без меня'],
  [
    'c: Кто-нибудь понял тему с прошедшим временем?',
    'b: Частично 😅',
    'a: Разберём в четверг ещё раз',
  ],
  ['a: [doc vocabulario-tema-5.pdf]', 'a: Слова к следующему занятию'],
];

export const SNIPPETS: Record<Topic, Snippet[]> = {
  friend: FRIEND,
  work: WORK,
  mum: MUM,
  'ru-friend': RU_FRIEND,
  'ja-work': JA_WORK,
  team: TEAM,
  hike: HIKE,
  football: FOOTBALL,
  climb: CLIMB,
  books: BOOKS,
  house: HOUSE,
  photo: PHOTO,
  announce: ANNOUNCE,
  'ru-family': RU_FAMILY,
  'ru-oldfriends': RU_OLDFRIENDS,
  'ru-course': RU_COURSE,
};

// topics where swapping who says what still reads naturally
export const SWAPPABLE: ReadonlySet<Topic> = new Set(['friend', 'work', 'ru-friend']);

export const LONG_TEXT =
  "Quick summary from today's sync so nobody has to rewatch the recording: we're keeping the release on the 14th, onboarding gets one more round of copy edits, and settings ships without the plugin marketplace for now. I'll own the migration script, Alex takes the release notes, and Sophie will double-check dark theme contrast on the old office laptops. If anything here is wrong, reply before Wednesday so we can still adjust.";

export const MULTILINE =
  "For Friday I'll grab:\n- the card (everyone sign it!)\n- candles\n- the cake from the bakery on Elm St\n- wrapping paper";

export const LINK_TEXT =
  'Found the place for Friday 👇 https://example.com/places/greek-taverna-linden — they have a heated terrace';

export const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '🔥'];

export const FILES = [
  { fileName: 'Q3-report.pdf', size: 2_480_000, mime: 'application/pdf' },
  { fileName: 'invoice_0412.pdf', size: 184_000, mime: 'application/pdf' },
  { fileName: 'wireframes-v4.fig', size: 18_700_000, mime: 'application/octet-stream' },
  { fileName: 'survey-results.xlsx', size: 96_000, mime: 'application/vnd.ms-excel' },
  { fileName: 'agenda-thursday.pdf', size: 72_000, mime: 'application/pdf' },
  { fileName: 'holiday-schedule-2026.pdf', size: 134_000, mime: 'application/pdf' },
  { fileName: '提案書_v2.pdf', size: 1_120_000, mime: 'application/pdf' },
  { fileName: 'vocabulario-tema-5.pdf', size: 310_000, mime: 'application/pdf' },
];

// live messages for ?demo=1, picked by the chat's language and kind
export const INCOMING = {
  en: {
    direct: [
      'Are you around later?',
      'Just saw this, will reply properly in a bit',
      'Can you call me when you are free?',
      'Haha yes, exactly',
      "I'm outside",
      'Did you get my email?',
      'Funny, I was just thinking about that',
      'Ok sounds good 👍',
    ],
    group: [
      'Did the build pass?',
      'Sending the photos now',
      'Running a few minutes late',
      'Can someone share the link again?',
      '+1',
      'Works for me',
      'Who else is coming?',
    ],
  },
  ru: {
    direct: ['Ты дома?', 'Перезвоню через 5 минут', 'Ок, договорились', 'Ахаха 😂', 'Уже выхожу'],
    group: ['Всем привет!', 'Кто будет в субботу?', 'Скинула фотки', 'Ок 👍', 'Я тоже приду'],
  },
  ja: { direct: ['今から出ます', '了解です！', 'ありがとうございます'], group: ['了解です！'] },
};

// sent with a typo, fixed a few seconds later
export const TYPO_FIXES: Record<'en' | 'ru' | 'ja', [string, string][]> = {
  en: [
    ["I'll be ther at 7", "I'll be there at 7"],
    ['Can we meet on Thrusday?', 'Can we meet on Thursday?'],
    ['Thanks, see you tomorow', 'Thanks, see you tomorrow'],
    ['Leaving in 10 minuets', 'Leaving in 10 minutes'],
  ],
  ru: [
    ['Буду в 7, не опаздвай', 'Буду в 7, не опаздывай'],
    ['Спасиюо!', 'Спасибо!'],
  ],
  ja: [['明日は9時にあいましょう', '明日は9時に会いましょう']],
};

// sent and then deleted a moment later; WhatsZori keeps the text
export const REGRETS: Record<'en' | 'ru' | 'ja', [string, string][]> = {
  en: [
    ["Honestly that meeting could've been an email", 'Sorry, wrong chat 🙈'],
    ["Don't tell anyone yet but I'm handing in my notice", 'Ignore that, wrong chat'],
    ['Is he always this late or is it just today?', 'Never mind 😅'],
  ],
  ru: [
    ['Честно, он меня уже достал', 'Ой, не тот чат'],
    ['Только никому не говори, но я увольняюсь', 'Не туда отправил 🙈'],
  ],
  ja: [['実は来月転職します', 'すみません、間違えました']],
};
