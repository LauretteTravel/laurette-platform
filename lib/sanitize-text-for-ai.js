const NUMBER_SEQUENCE = /\+?(?:\(\p{Nd}{1,4}\)|\p{Nd}+)(?:[ \t\u00a0\u202f.\u2010-\u2015-]+(?:\(\p{Nd}{1,4}\)|\p{Nd}+))*/gu;

// Mask numeric identifiers, including Arabic digits and formatted phone numbers.
// Other personal information can still be present in the returned text.
export function sanitizeTextForAI(text) {
  if (typeof text !== 'string') return '';

  return text.replace(NUMBER_SEQUENCE, (sequence) => {
    const digits = sequence.replace(/\P{Nd}/gu, '');
    return digits.length >= 7 ? '[CONFIDENTIAL_ID]' : sequence;
  });
}
