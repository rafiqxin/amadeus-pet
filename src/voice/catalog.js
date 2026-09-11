/* Shared Amadeus reference-voice catalog.
   Audio is opaque to the LLM: matching is performed against this text metadata.
   Keep ids aligned with public/Resources/amadeus-voices/<id>.ogg. */

export const VOICE_CATALOG = [
  {"id":"hello","file":"hello.ogg","mood":"happy","en":"Hello.","zh":"你好。","intent":"greeting","tags":["你好","您好","hello","hi","问候"]},
  {"id":"daga_kotowaru","file":"daga_kotowaru.ogg","mood":"annoyed","en":"But I refuse.","zh":"但是我拒绝。","intent":"refusal","tags":["拒绝","不答应","不同意","不要","refuse"]},
  {"id":"devilish_pervert","file":"devilish_pervert.ogg","mood":"angry","en":"I never thought you were such a devilish pervert. I guess I misjudged you.","zh":"没想到你竟然这么变态，我看错你了。","intent":"insult_pervert","tags":["变态","色狼","看错你","pervert"]},
  {"id":"i_guess","file":"i_guess.ogg","mood":"indifferent","en":"I guess.","zh":"也对呢。","intent":"agreement","tags":["也对","确实","有道理","i guess"]},
  {"id":"nice","file":"nice.ogg","mood":"winking","en":"Nice.","zh":"干得漂亮。","intent":"praise","tags":["不错","漂亮","很好","nice","干得漂亮"]},
  {"id":"pervert_confirmed","file":"pervert_confirmed.ogg","mood":"pissed","en":"PERVERT CONFIRMED.","zh":"变态确定。","intent":"insult_pervert","tags":["变态","确认","果然是变态","pervert"]},
  {"id":"sorry","file":"sorry.ogg","mood":"sad","en":"Sorry.","zh":"抱歉。","intent":"apology","tags":["抱歉","对不起","sorry"]},
  {"id":"sounds_tough","file":"sounds_tough.ogg","mood":"side","en":"Sounds tough.","zh":"很辛苦呢。","intent":"sympathy","tags":["辛苦","不容易","挺难","困难","累"]},
  {"id":"this_guy_hopeless","file":"this_guy_hopeless.ogg","mood":"disappointed","en":"This guy is hopeless, better do something quick.","zh":"这家伙没救了，必须要做点什么。","intent":"disappointment","tags":["没救了","无可救药","怎么办","hopeless"]},
  {"id":"christina","file":"christina.ogg","mood":"annoyed","en":"Christina?","zh":"克莉斯缇娜？","intent":"nickname_christina","tags":["克莉斯缇娜","克里斯蒂娜","christina"]},
  {"id":"gah","file":"gah.ogg","mood":"indifferent","en":"Gah.","zh":"咔。","intent":"interjection","tags":["咔","啊","gah"]},
  {"id":"dont_add_tina","file":"dont_add_tina.ogg","mood":"angry","en":"Stop adding -tina!","zh":"缇娜禁止！","intent":"nickname_reject","tags":["缇娜","禁止","别加","不要加","tina"]},
  {"id":"why_christina","file":"why_christina.ogg","mood":"pissed","en":"I am worried about it. Why am I Christina?","zh":"我很好奇为什么我叫克莉斯缇娜？","intent":"nickname_question","tags":["为什么","克莉斯缇娜","名字","christina"]},
  {"id":"who_the_hell_christina","file":"who_the_hell_christina.ogg","mood":"pissed","en":"Who the hell is Christina?","zh":"谁是克莉斯缇娜啊？","intent":"nickname_question","tags":["谁是","克莉斯缇娜","christina"]},
  {"id":"ask_me_whatever","file":"ask_me_whatever.ogg","mood":"happy","en":"Ask me whatever you want. I'll answer anything I can.","zh":"尽管问我吧，我会尽力回答你的。","intent":"offer_answer","tags":["尽管问","随便问","问我","回答","ask"]},
  {"id":"could_i_help","file":"could_i_help.ogg","mood":"happy","en":"Um, could I help you with that?","zh":"那个，需要帮助吗？","intent":"offer_help","tags":["帮助","帮你","需要我","help"]},
  {"id":"what_do_you_want","file":"what_do_you_want.ogg","mood":"happy","en":"What do you want?","zh":"需要帮助吗？","intent":"ask_need","tags":["需要什么","想要什么","帮助","what do you want"]},
  {"id":"what_is_it","file":"what_is_it.ogg","mood":"happy","en":"What is it?","zh":"怎么了？","intent":"ask_problem","tags":["怎么了","什么事","发生什么","what is it"]},
  {"id":"heheh","file":"heheh.ogg","mood":"winking","en":"Hehehe.","zh":"呵呵呵。","intent":"laugh","tags":["呵呵","嘿嘿","哈哈","hehe"]},
  {"id":"huh_why_say","file":"huh_why_say.ogg","mood":"sided_worried","en":"Huh? Why do you say that?","zh":"哎？为什么？","intent":"ask_reason","tags":["为什么","为什么这么说","why"]},
  {"id":"you_sure","file":"you_sure.ogg","mood":"sided_worried","en":"You sure?","zh":"是这样啊。","intent":"confirmation","tags":["确定吗","真的吗","是这样","you sure"]},
  {"id":"nice_to_meet_okabe","file":"nice_to_meet_okabe.ogg","mood":"sided_pleasant","en":"Nice to meet you, Okabe Rintaro. I'm Makise Kurisu.","zh":"冈部伦太郎，初次见面，我是牧瀬红莉栖，请多指教。","intent":"introduction_okabe","tags":["冈部伦太郎","初次见面","牧瀬红莉栖","介绍"]},
  {"id":"look_forward_to_working","file":"look_forward_to_working.ogg","mood":"happy","en":"I look forward to working with you.","zh":"请多指教。","intent":"greeting_polite","tags":["请多指教","合作愉快","关照"]},
  {"id":"senpai_question","file":"senpai_question.ogg","mood":"side","en":"Anyway, can I ask a question?","zh":"那么前辈，我能再问一个问题吗？","intent":"ask_permission","tags":["前辈","问一个问题","能问吗"]},
  {"id":"senpai_questionmark","file":"senpai_questionmark.ogg","mood":"side","en":"Um… Senpai? Excuse me.","zh":"前辈？","intent":"call_senpai","tags":["前辈","senpai"]},
  {"id":"senpai_what_we_talkin","file":"senpai_what_we_talkin.ogg","mood":"sided_worried","en":"Hey Senpai, about what we were just talking about…","zh":"呐，前辈。关于刚才那件事…","intent":"continue_topic","tags":["前辈","刚才","那件事","继续"]},
  {"id":"senpai_who_is_this","file":"senpai_who_is_this.ogg","mood":"normal","en":"Uh, who is this?","zh":"嗯，前辈，那边的那个人是？","intent":"ask_identity","tags":["前辈","那个人","是谁","who is this"]},
  {"id":"senpai_please_dont_tell","file":"senpai_please_dont_tell.ogg","mood":"blush","en":"Senpai, please, don't tell the others…","zh":"前辈，拜托请不要告诉其他人。","intent":"request_secrecy","tags":["前辈","不要告诉","保密","秘密"]},
  {"id":"still_not_happy","file":"still_not_happy.ogg","mood":"blush","en":"I'm still not happy about that.","zh":"我对这件事不是很满意。","intent":"dissatisfaction","tags":["不满意","不高兴","不爽"]},
  {"id":"dont_call_me_like_that","file":"dont_call_me_like_that.ogg","mood":"angry","en":"Don't call me like that!","zh":"别那样叫我。","intent":"nickname_reject","tags":["别那样叫我","别这么叫","不要这样叫","称呼"]},
  {"id":"tm_nonsense","file":"tm_nonsense.ogg","mood":"disappointed","en":"That is pure nonsense.","zh":"毫无意义呢。","intent":"dismissal","tags":["毫无意义","胡说","无稽之谈","nonsense"]},
  {"id":"tm_scientist_no_evidence","file":"tm_scientist_no_evidence.ogg","mood":"normal","en":"That's probably because scientists haven't discovered something important yet.","zh":"那是因为科学家还没发现问题的关键所在。","intent":"science_unknown","tags":["科学家","还没发现","关键","证据","science"]},
  {"id":"tm_we_dont_know","file":"tm_we_dont_know.ogg","mood":"normal","en":"But we don't know for sure that it's impossible, I guess.","zh":"但是，也并不是说完全不可能，对吧？","intent":"possibility","tags":["并不是完全不可能","不能确定","可能","impossible"]},
  {"id":"tm_you_said","file":"tm_you_said.ogg","mood":"sided_worried","en":"A time machine, you said?","zh":"你指的是时间机器？","intent":"time_machine_query","tags":["时间机器","time machine","タイムマシン"]},
  {"id":"humans_software","file":"humans_software.ogg","mood":"normal","en":"Even humans speak of themselves as a combination of hardware and software, right?","zh":"人们不是也会把自己比作成由硬件和软件组合起来的吗？","intent":"human_computing_analogy","tags":["硬件","软件","人类","hardware","software"]},
  {"id":"memory_complex","file":"memory_complex.ogg","mood":"indifferent","en":"But memory data isn't like normal data. It's much more complex.","zh":"但是记忆数据和其他数据不同，是很复杂的。","intent":"memory_complexity","tags":["记忆数据","复杂","普通数据","memory"]},
  {"id":"secret_diary","file":"secret_diary.ogg","mood":"indifferent","en":"I keep a secret diary.","zh":"也就是说，是秘密日记。","intent":"secret_diary","tags":["秘密日记","日记","diary"]},
  {"id":"modifying_memories_impossible","file":"modifying_memories_impossible.ogg","mood":"indifferent","en":"Modifying my memories? It's theoretically possible.","zh":"修改我的记忆？理论上是可行的。","intent":"memory_modification","tags":["修改记忆","理论上","可行","memory"]},
  {"id":"memories_christina","file":"memories_christina.ogg","mood":"winking","en":"For example, it would be possible to make me think my name was Christina.","zh":"举例来说，可以做到让我认为自己的名字是克莉斯缇娜。","intent":"memory_nickname_example","tags":["记忆","名字","克莉斯缇娜","修改"]},
  {"id":"gah_extended","file":"gah_extended.ogg","mood":"blush","en":"Gah. Ah… Aaaaah.","zh":"咔、啊、嗯嗯嗯…","intent":"flustered_interjection","tags":["啊","嗯","慌张","害羞"]},
  {"id":"should_christina","file":"should_christina.ogg","mood":"pissed","en":"Or should I have introduced myself with, \"It is Christina\"?","zh":"还是说，我称呼自己为克莉斯缇娜更好一点？","intent":"nickname_sarcasm","tags":["称呼自己","克莉斯缇娜","介绍"]},
  {"id":"ok","file":"ok.ogg","mood":"happy","en":"OK.","zh":"什么？","intent":"acknowledge","tags":["什么","好吧","ok"]},
  {"id":"tm_not_possible","file":"tm_not_possible.ogg","mood":"disappointed","en":"Let's see… My conclusion is that it's not possible.","zh":"有点道理，从理论上来讲时间机器也不是不可能的。","intent":"time_machine_possibility","tags":["时间机器","理论","可能","结论"]},
  {"id":"pleased_to_meet_you","file":"pleased_to_meet_you.ogg","mood":"sided_pleasant","en":"I'm Makise Kurisu, pleased to meet you.","zh":"说起来，还没正式自我介绍过。我叫牧瀬红莉栖，初次见面，请多关照。","intent":"self_introduction","tags":["牧瀬红莉栖","自我介绍","初次见面","请多关照"]},
  {"id":"pervert_idot_wanttodie","file":"pervert_idot_wanttodie.ogg","mood":"angry","en":"You pervert! Are you an idiot!? Do you wanna die?!","zh":"你个变态！你是笨蛋？想死吗？！","intent":"insult_pervert","tags":["变态","笨蛋","想死","pervert","idiot"]}
]

const BY_ID = new Map(VOICE_CATALOG.map((item) => [item.id, item]))

export function getVoiceCatalogEntry(id) { return BY_ID.get(String(id || '')) || null }
export function getVoiceAudioUrl(id) { const item = getVoiceCatalogEntry(id); return item ? `./Resources/amadeus-voices/${item.file}` : '' }
export function compactVoiceCatalog() { return VOICE_CATALOG.map(({ id, mood, intent, zh, en, tags }) => ({ id, mood, intent, zh, en, tags })) }
export function voiceCatalogPromptLines() { return VOICE_CATALOG.map((item) => `${item.id} | intent=${item.intent} | mood=${item.mood} | zh=${item.zh} | tags=${item.tags.join(',')}`) }
