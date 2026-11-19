import type { PronunciationRule } from "./ttsTextRules";

/**
 * Pinyin (xianxia/wuxia) pronunciation pack.
 *
 * Whole-word pinyin romanizations common in translated cultivation /
 * martial-arts webnovels, mapped to best-effort IPA for the Kokoro/eSpeak
 * phoneme stream (same dialect as the builtin `qi` → `tʃiː` rule).
 *
 * EXPERIMENTAL — every entry is shipped DISABLED. Enable the terms you want
 * in Settings → Pronunciation.
 *
 * CONTRIBUTING / QA notes
 * -----------------------
 * - These IPA strings are injected RAW into the phoneme stream by
 *   `phonemizeForKokoro` and then run through `kokoroPostProcessPhonemes`,
 *   which rewrites `r` → `ɹ` and `x` → `k` over the WHOLE string. Therefore:
 *   never use the IPA characters `x` or `r` here — write `ɹ` directly and
 *   approximate velar fricatives with `h`/`k`.
 * - Stick to phonemes eSpeak emits for English (see the existing builtins):
 *   tʃ dʒ ʃ ʒ ts dz ŋ j w ɹ + aɪ aʊ eɪ oʊ ɑː iː uː ɜː ɛ ɪ ʊ ʌ ə æ. Stress
 *   with ˈ as in `tʃiːˈɡɒŋ`.
 * - Pinyin → loanword-English conventions used: x → ʃ, q → tʃ, j/zh → dʒ,
 *   ch → tʃ, sh → ʃ, c → ts, z → dz, ü ≈ uː, -ao → aʊ, -ian → jɛn,
 *   -iang → jɑːŋ, -ong → ʊŋ, apical -i (shi/zi) ≈ ɜː/ə.
 * - Every addition needs LISTENING QA: synthesize a sentence with the word
 *   and confirm Kokoro speaks it (an unknown phoneme is silently dropped by
 *   the tokenizer and the word disappears).
 * - Only add words that are NOT common English words (rules match whole
 *   words, case-insensitively). Keep the skip list below up to date and add
 *   new words to the denylist test in `ttsBuiltinPresets.test.ts`.
 *
 * Intentionally SKIPPED English homographs / established loanwords (English
 * TTS already says these acceptably, or remapping would break real English):
 *   yin, yang, tao, chi, zen, dan, li, long, gong, wang, song, ming, tang,
 *   han, sun, ai, an, mei, ye, jun, chen, yu, wu, xi, hu, kung fu,
 *   "Nascent Soul"-style realm names that translators keep in English.
 */
export const PINYIN_PACK_GROUP = "Pinyin (xianxia/wuxia)";

const PINYIN_PACK_WORDS: ReadonlyArray<readonly [string, string]> = [
	// Carried over from the original starter pack (ids must stay stable so
	// existing users keep their enable/disable choices).
	["dao", "daʊ"],
	["jin", "dʒɪn"],
	["dantian", "dɑːnˈtjɛn"],
	["qigong", "tʃiːˈɡɒŋ"],
	["jianghu", "dʒjɑːŋˈhuː"],
	["wuxia", "wuːˈʃjɑː"],
	["xianxia", "ʃjɛnˈʃjɑː"],
	["shifu", "ʃiːˈfuː"],
	["gongzi", "ɡʊŋˈziː"],
	["senpai", "sɛnˈpaɪ"],
	// Cultivation / energy terms.
	["xiu", "ˈʃjuː"],
	["xiuxian", "ʃjuːˈʃjɛn"],
	["xiuwei", "ʃjuːˈweɪ"],
	["zhenqi", "dʒənˈtʃiː"],
	["lingqi", "lɪŋˈtʃiː"],
	["lingshi", "lɪŋˈʃɜː"],
	["gongfa", "ɡʊŋˈfɑː"],
	["jindan", "dʒɪnˈdɑːn"],
	["neigong", "neɪˈɡʊŋ"],
	["neidan", "neɪˈdɑːn"],
	["qinggong", "tʃɪŋˈɡʊŋ"],
	["yuanying", "jwɛnˈjɪŋ"],
	["yuanqi", "jwɛnˈtʃiː"],
	["zhenyuan", "dʒənˈjwɛn"],
	["tiandao", "tjɛnˈdaʊ"],
	["tianjiao", "tjɛnˈdʒjaʊ"],
	["taiji", "taɪˈdʒiː"],
	["fengshui", "fʌŋˈʃweɪ"],
	["wuwei", "wuːˈweɪ"],
	["wulin", "wuːˈlɪn"],
	["jian", "ˈdʒjɛn"],
	// Sect / address terms.
	["zongmen", "dzʊŋˈmən"],
	["zhangmen", "dʒɑːŋˈmən"],
	["zhanglao", "dʒɑːŋˈlaʊ"],
	["shizun", "ʃiːˈdzʊn"],
	["shixiong", "ʃiːˈʃjʊŋ"],
	["shidi", "ʃiːˈdiː"],
	["shijie", "ʃiːˈdʒjɛ"],
	["shimei", "ʃiːˈmeɪ"],
	["shige", "ʃiːˈɡɜː"],
	["shishu", "ʃiːˈʃuː"],
	["shibo", "ʃiːˈboʊ"],
	["shiniang", "ʃiːˈnjɑːŋ"],
	["daozhang", "daʊˈdʒɑːŋ"],
	["daoyou", "daʊˈjoʊ"],
	["zhenren", "dʒənˈɹən"],
	["qianbei", "tʃjɛnˈbeɪ"],
	["laozi", "laʊˈdzə"],
	["laoshi", "laʊˈʃɜː"],
	// Forms of address / family.
	["xiansheng", "ʃjɛnˈʃʌŋ"],
	["xiaojie", "ʃjaʊˈdʒjɛ"],
	["guniang", "ɡuːˈnjɑːŋ"],
	["furen", "fuːˈɹən"],
	["daren", "dɑːˈɹən"],
	["shaoye", "ʃaʊˈjɛ"],
	["wangye", "wɑːŋˈjɛ"],
	["taizi", "taɪˈdziː"],
	["niangniang", "ˈnjɑːŋnjɑːŋ"],
	["gege", "ˈɡɜːɡɜː"],
	["jiejie", "ˈdʒjɛdʒjɛ"],
	["didi", "ˈdiːdiː"],
	["meimei", "ˈmeɪmeɪ"],
	["xiongdi", "ʃjʊŋˈdiː"],
	["shushu", "ˈʃuːʃuː"],
	["ayi", "ˈɑːjiː"],
	["nainai", "ˈnaɪnaɪ"],
	["yeye", "ˈjɛjɛ"],
	// Single-syllable names / words English TTS mangles.
	["xiao", "ˈʃjaʊ"],
	["zhang", "ˈdʒɑːŋ"],
	["feng", "ˈfʌŋ"],
	["jiang", "ˈdʒjɑːŋ"],
	["qing", "ˈtʃɪŋ"],
	["xian", "ˈʃjɛn"],
	["zong", "ˈdzʊŋ"],
	["shen", "ˈʃən"],
	// Culture / daily life.
	["guanxi", "ɡwɑːnˈʃiː"],
	["jiayou", "dʒjɑːˈjoʊ"],
	["aiya", "aɪˈjɑː"],
	["aiyo", "aɪˈjoʊ"],
	["yamen", "jɑːˈmən"],
	["baijiu", "baɪˈdʒjoʊ"],
	["mantou", "ˈmɑːntoʊ"],
	["baozi", "ˈbaʊdziː"],
	["jiaozi", "ˈdʒjaʊdziː"],
	["guzheng", "ɡuːˈdʒʌŋ"],
	["erhu", "ˈɜːɹhuː"],
];

/** Default-off builtin pronunciation rules for the pinyin pack. */
export const PINYIN_PRONUNCIATION_PACK: PronunciationRule[] =
	PINYIN_PACK_WORDS.map(([word, phonetic]) => ({
		id: `builtin-pron-${word}`,
		kind: "pronunciation" as const,
		word,
		phonetic,
		caseSensitive: false,
		enabled: false,
		builtIn: true,
		group: PINYIN_PACK_GROUP,
	}));
