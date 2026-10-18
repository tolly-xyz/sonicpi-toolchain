# Word timing from dict/words.json (tools/worddict/build.py): how long a real voice holds each
# consonant of a word, relative to that consonant's usual length. A song keeps its own consonant
# lengths for its singing style and multiplies them by these factors.
#   word_factors("still", %w[S T IH L])  # => [1.0, 0.71, nil, 1.12]   (nil: a vowel, or not measured)
require "json"
WORDDICT = (JSON.parse(File.read("#{SP_ROOT}/dict/words.json")) rescue {})
WORD_VOWELS = %w[AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW]
WORD_MEAN = Hash.new { |h, k| h[k] = 1.0 }.merge(
  WORDDICT.values.flat_map { |e| e["phones"].zip(e["ms"]) }.reject { |_, ms| ms.nil? }
          .group_by(&:first).transform_values { |v| v.sum { |_, ms| ms } / v.size.to_f })
def word_factors(word, phones, lo: 0.6, hi: 1.6)
  e = WORDDICT[word.downcase.gsub(/[^a-z']/, "")] or return phones.map { nil }
  # line the song's phonemes up with the dictionary's (longest common subsequence)
  a, b = phones, e["phones"]
  t = Array.new(a.size + 1) { Array.new(b.size + 1, 0) }
  a.size.downto(1) { |i| b.size.downto(1) { |j| t[i - 1][j - 1] = a[i - 1] == b[j - 1] ? t[i][j] + 1 : [t[i - 1][j], t[i][j - 1]].max } }
  out = phones.map { nil }; i = j = 0
  while i < a.size && j < b.size
    if a[i] == b[j]
      ms = e["ms"][j]
      out[i] = [[ms / WORD_MEAN[a[i]], lo].max, hi].min if ms && !WORD_VOWELS.include?(a[i])   # (Sonic Pi redefines clamp)
      i += 1; j += 1
    elsif t[i + 1][j] >= t[i][j + 1] then i += 1
    else j += 1
    end
  end
  out
end
