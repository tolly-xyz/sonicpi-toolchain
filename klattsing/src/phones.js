// ARPABET classes, and inherent / minimum durations (ms) for Klatt's duration model.
// INH/MIN after Klatt (1979) and Allen, Hunnicutt & Klatt (1987), "From Text to Speech: The MITalk
// System", ch. 9, as best reconstructed; they are a starting point for tools/voicelab to tune.
export const VOWELS = new Set('AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW'.split(' '));
export const STOPS = new Set('P B T D K G'.split(' '));
export const VOICELESS_STOPS = new Set('P T K'.split(' '));
export const FRICATIVES = new Set('F V TH DH S Z SH ZH HH'.split(' '));
export const AFFRICATES = new Set('CH JH'.split(' '));
export const NASALS = new Set('M N NG'.split(' '));
export const LIQUIDS = new Set('L R'.split(' '));
export const GLIDES = new Set('W Y'.split(' '));
export const VOICED = new Set('B D G V DH Z ZH JH M N NG L R W Y'.split(' ').concat([...VOWELS]));
export const SONORANT = (p) => VOWELS.has(p) || NASALS.has(p) || LIQUIDS.has(p) || GLIDES.has(p);

export const DUR = {          // [inherent, minimum]
  AA: [240, 100], AE: [230, 80], AH: [140, 60], AO: [240, 100], AW: [260, 100], AY: [250, 150],
  EH: [150, 70], ER: [180, 80], EY: [190, 100], IH: [135, 40], IY: [155, 55], OW: [220, 80],
  OY: [280, 150], UH: [160, 60], UW: [210, 70],
  B: [85, 60], CH: [70, 50], D: [75, 50], DH: [50, 30], F: [100, 80], G: [80, 60], HH: [80, 20],
  JH: [70, 50], K: [80, 60], L: [80, 40], M: [70, 60], N: [60, 30], NG: [95, 45], P: [90, 50],
  R: [80, 30], S: [105, 60], SH: [105, 80], T: [75, 50], TH: [90, 60], V: [60, 40], W: [80, 60],
  Y: [80, 40], Z: [75, 40], ZH: [70, 40],
};

// Legal English syllable onsets (for maximal-onset syllabification)
export const ONSETS = new Set([
  '', ...'P B T D K G F V TH DH S Z SH ZH HH CH JH M N L R W Y'.split(' '),
  'P L', 'P R', 'P Y', 'B L', 'B R', 'B Y', 'T R', 'T W', 'T Y', 'D R', 'D W', 'D Y', 'K L', 'K R', 'K W', 'K Y',
  'G L', 'G R', 'G W', 'G Y', 'F L', 'F R', 'F Y', 'TH R', 'TH W', 'SH R', 'V Y', 'M Y', 'N Y', 'HH Y', 'HH W', 'L Y',
  'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'S F', 'S Y',
  'S P L', 'S P R', 'S P Y', 'S T R', 'S T Y', 'S K L', 'S K R', 'S K W', 'S K Y',
]);
