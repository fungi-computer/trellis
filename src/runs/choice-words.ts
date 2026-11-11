/** Plain past-tense words for the common review choices, by choice id. */
const pastTense = new Map([
  ["keep", "Kept"],
  ["discard", "Discarded"],
  ["animate", "Kept and animated"],
  ["redo", "Regenerated"],
  ["reject", "Rejected"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
]);

/** What a person reads for a choice already made: "Kept", or the choice's own label. */
export function chosenWords(choiceId: string, label: string): string {
  return pastTense.get(choiceId) ?? label;
}
