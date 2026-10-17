/**
 * Japanese kana/romaji to klattsch phoneme conversion.
 *
 * import { kanaToPhonemes, romajiToPhonemes } from 'klattsch/kana';
 * kanaToPhonemes('こんにちは')  // [{code:'K'},{code:'O'},{code:'N'},{code:'N'},{code:'I'},{code:'CH'},{code:'I'},{code:'HH'},{code:'A'}]
 * romajiToPhonemes('konnichiha') // same
 */

const KANA_MAP = {
  'あ': ['A'], 'い': ['I'], 'う': ['U'], 'え': ['E'], 'お': ['O'],
  'か': ['K','A'], 'き': ['K','I'], 'く': ['K','U'], 'け': ['K','E'], 'こ': ['K','O'],
  'さ': ['S','A'], 'し': ['SH','I'], 'す': ['S','U'], 'せ': ['S','E'], 'そ': ['S','O'],
  'た': ['T','A'], 'ち': ['CH','I'], 'つ': ['T','S','U'], 'て': ['T','E'], 'と': ['T','O'],
  'な': ['N','A'], 'に': ['N','I'], 'ぬ': ['N','U'], 'ね': ['N','E'], 'の': ['N','O'],
  'は': ['HH','A'], 'ひ': ['HH','I'], 'ふ': ['F','U'], 'へ': ['HH','E'], 'ほ': ['HH','O'],
  'ま': ['M','A'], 'み': ['M','I'], 'む': ['M','U'], 'め': ['M','E'], 'も': ['M','O'],
  'や': ['Y','A'], 'ゆ': ['Y','U'], 'よ': ['Y','O'],
  'ら': ['DX','A'], 'り': ['DX','I'], 'る': ['DX','U'], 'れ': ['DX','E'], 'ろ': ['DX','O'],
  'わ': ['W','A'], 'を': ['O'], 'ん': ['N'],

  // dakuten
  'が': ['G','A'], 'ぎ': ['G','I'], 'ぐ': ['G','U'], 'げ': ['G','E'], 'ご': ['G','O'],
  'ざ': ['Z','A'], 'じ': ['JH','I'], 'ず': ['Z','U'], 'ぜ': ['Z','E'], 'ぞ': ['Z','O'],
  'だ': ['D','A'], 'ぢ': ['JH','I'], 'づ': ['Z','U'], 'で': ['D','E'], 'ど': ['D','O'],
  'ば': ['B','A'], 'び': ['B','I'], 'ぶ': ['B','U'], 'べ': ['B','E'], 'ぼ': ['B','O'],

  // handakuten
  'ぱ': ['P','A'], 'ぴ': ['P','I'], 'ぷ': ['P','U'], 'ぺ': ['P','E'], 'ぽ': ['P','O'],

  // yoon (combo kana)
  'きゃ': ['K','Y','A'], 'きゅ': ['K','Y','U'], 'きょ': ['K','Y','O'],
  'しゃ': ['SH','A'], 'しゅ': ['SH','U'], 'しょ': ['SH','O'],
  'ちゃ': ['CH','A'], 'ちゅ': ['CH','U'], 'ちょ': ['CH','O'],
  'にゃ': ['N','Y','A'], 'にゅ': ['N','Y','U'], 'にょ': ['N','Y','O'],
  'ひゃ': ['HH','Y','A'], 'ひゅ': ['HH','Y','U'], 'ひょ': ['HH','Y','O'],
  'みゃ': ['M','Y','A'], 'みゅ': ['M','Y','U'], 'みょ': ['M','Y','O'],
  'りゃ': ['DX','Y','A'], 'りゅ': ['DX','Y','U'], 'りょ': ['DX','Y','O'],
  'ぎゃ': ['G','Y','A'], 'ぎゅ': ['G','Y','U'], 'ぎょ': ['G','Y','O'],
  'じゃ': ['JH','A'], 'じゅ': ['JH','U'], 'じょ': ['JH','O'],
  'びゃ': ['B','Y','A'], 'びゅ': ['B','Y','U'], 'びょ': ['B','Y','O'],
  'ぴゃ': ['P','Y','A'], 'ぴゅ': ['P','Y','U'], 'ぴょ': ['P','Y','O'],

  // small tsu (geminate) handled separately
  'っ': ['_GEMINATE'],

  // long vowel
  'ー': ['_LONG'],
};

// katakana: shift codepoint range to hiragana
function kataToHira(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x30A1 && cp <= 0x30F6) return String.fromCodePoint(cp - 0x60);
  if (cp === 0x30FC) return 'ー';
  return ch;
}

export function kanaToPhonemes(text) {
  const hira = [...text].map(kataToHira).join('');
  const result = [];
  let i = 0;

  while (i < hira.length) {
    // try 2-char yoon first
    if (i + 1 < hira.length) {
      const pair = hira[i] + hira[i + 1];
      if (KANA_MAP[pair]) {
        result.push(...KANA_MAP[pair].map(code => ({ code, stressed: false })));
        i += 2;
        continue;
      }
    }

    const ch = hira[i];
    if (KANA_MAP[ch]) {
      const codes = KANA_MAP[ch];
      if (codes[0] === '_GEMINATE') {
        // double the next consonant (add a pause)
        result.push({ code: '_', stressed: false });
      } else if (codes[0] === '_LONG') {
        // extend the previous vowel
        if (result.length) {
          const prev = result[result.length - 1];
          result.push({ code: prev.code, stressed: false });
        }
      } else {
        result.push(...codes.map(code => ({ code, stressed: false })));
      }
    }
    // skip unknown characters (spaces, punctuation)
    i++;
  }

  return result.length ? result : null;
}

// Romaji to phoneme mapping
const ROMAJI_MAP = {
  'a': ['A'], 'i': ['I'], 'u': ['U'], 'e': ['E'], 'o': ['O'],
  'ka': ['K','A'], 'ki': ['K','I'], 'ku': ['K','U'], 'ke': ['K','E'], 'ko': ['K','O'],
  'sa': ['S','A'], 'shi': ['SH','I'], 'si': ['SH','I'], 'su': ['S','U'], 'se': ['S','E'], 'so': ['S','O'],
  'ta': ['T','A'], 'chi': ['CH','I'], 'ti': ['CH','I'], 'tsu': ['T','S','U'], 'tu': ['T','S','U'], 'te': ['T','E'], 'to': ['T','O'],
  'na': ['N','A'], 'ni': ['N','I'], 'nu': ['N','U'], 'ne': ['N','E'], 'no': ['N','O'],
  'ha': ['HH','A'], 'hi': ['HH','I'], 'fu': ['F','U'], 'hu': ['F','U'], 'he': ['HH','E'], 'ho': ['HH','O'],
  'ma': ['M','A'], 'mi': ['M','I'], 'mu': ['M','U'], 'me': ['M','E'], 'mo': ['M','O'],
  'ya': ['Y','A'], 'yu': ['Y','U'], 'yo': ['Y','O'],
  'ra': ['DX','A'], 'ri': ['DX','I'], 'ru': ['DX','U'], 're': ['DX','E'], 'ro': ['DX','O'],
  'wa': ['W','A'], 'wo': ['O'], 'nn': ['N'], "n'": ['N'],
  'ga': ['G','A'], 'gi': ['G','I'], 'gu': ['G','U'], 'ge': ['G','E'], 'go': ['G','O'],
  'za': ['Z','A'], 'ji': ['JH','I'], 'zi': ['JH','I'], 'zu': ['Z','U'], 'ze': ['Z','E'], 'zo': ['Z','O'],
  'da': ['D','A'], 'di': ['JH','I'], 'du': ['Z','U'], 'de': ['D','E'], 'do': ['D','O'],
  'ba': ['B','A'], 'bi': ['B','I'], 'bu': ['B','U'], 'be': ['B','E'], 'bo': ['B','O'],
  'pa': ['P','A'], 'pi': ['P','I'], 'pu': ['P','U'], 'pe': ['P','E'], 'po': ['P','O'],
  'kya': ['K','Y','A'], 'kyu': ['K','Y','U'], 'kyo': ['K','Y','O'],
  'sha': ['SH','A'], 'shu': ['SH','U'], 'sho': ['SH','O'],
  'cha': ['CH','A'], 'chu': ['CH','U'], 'cho': ['CH','O'],
  'nya': ['N','Y','A'], 'nyu': ['N','Y','U'], 'nyo': ['N','Y','O'],
  'hya': ['HH','Y','A'], 'hyu': ['HH','Y','U'], 'hyo': ['HH','Y','O'],
  'mya': ['M','Y','A'], 'myu': ['M','Y','U'], 'myo': ['M','Y','O'],
  'rya': ['DX','Y','A'], 'ryu': ['DX','Y','U'], 'ryo': ['DX','Y','O'],
  'gya': ['G','Y','A'], 'gyu': ['G','Y','U'], 'gyo': ['G','Y','O'],
  'ja': ['JH','A'], 'ju': ['JH','U'], 'jo': ['JH','O'],
  'bya': ['B','Y','A'], 'byu': ['B','Y','U'], 'byo': ['B','Y','O'],
  'pya': ['P','Y','A'], 'pyu': ['P','Y','U'], 'pyo': ['P','Y','O'],
};

// Sort by length descending for greedy matching
const ROMAJI_KEYS = Object.keys(ROMAJI_MAP).sort((a, b) => b.length - a.length);

export function romajiToPhonemes(text) {
  const lower = text.toLowerCase().replace(/\s+/g, '');
  const result = [];
  let i = 0;

  while (i < lower.length) {
    // nn = syllabic N + next syllable starting with n
    if (lower[i] === 'n' && lower[i + 1] === 'n') {
      result.push({ code: 'N', stressed: false });
      i++;
      continue;
    }

    // geminate: doubled consonant (not nn)
    if (i + 1 < lower.length && lower[i] === lower[i + 1] && !/[aeioun]/.test(lower[i])) {
      result.push({ code: '_', stressed: false });
      i++;
      continue;
    }

    // n before consonant or end (not followed by a vowel or y)
    if (lower[i] === 'n' && i + 1 < lower.length && !/[aeiouny]/.test(lower[i + 1])) {
      result.push({ code: 'N', stressed: false });
      i++;
      continue;
    }
    if (lower[i] === 'n' && i + 1 === lower.length) {
      result.push({ code: 'N', stressed: false });
      i++;
      continue;
    }

    let matched = false;
    for (const key of ROMAJI_KEYS) {
      if (lower.startsWith(key, i)) {
        result.push(...ROMAJI_MAP[key].map(code => ({ code, stressed: false })));
        i += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }

  return result.length ? result : null;
}

export function isKana(text) {
  return /[぀-ゟ゠-ヿ]/.test(text);
}

export function japaneseToPhonemes(text) {
  if (isKana(text)) return kanaToPhonemes(text);
  if (/^[a-z']+$/i.test(text.replace(/\s/g, ''))) return romajiToPhonemes(text);
  return kanaToPhonemes(text);
}
