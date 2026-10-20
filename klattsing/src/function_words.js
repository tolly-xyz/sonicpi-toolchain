// One-syllable English function words. With the option functionWords: true they lose their lexical stress
// (CMUdict gives many of them stress 1: "of" AH1 V, "to" T UW1, "is" IH1 Z, "for" F AO1 R) before the
// duration rules and accents run, as they are in connected speech. Only one-syllable entries are used,
// so the occasional two-syllable pronunciation ("our" AW1 ER0) keeps its stress.
const LIST = {
  articles: 'a an the',
  prepositions: 'at by for from in of on to with as up off out down near past through thru till than per round since',
  pronouns: "i me my you your he him his she her it its we us our they them their who whom whose which that thee thy ye",
  auxiliaries: 'am is are was were be been has have had do does did can could will would shall should may might must',
  conjunctions: "and or but nor if so yet though",
  existential: 'there',
  contractions: "i'm i'll i'd i've you're you'll you'd you've he's he'll he'd she's she'll she'd it's we're we'll we'd we've they're they'll they'd they've that's there's who's",
};
export const FUNCTION_WORDS = new Set(Object.values(LIST).flatMap((s) => s.split(' ')));
