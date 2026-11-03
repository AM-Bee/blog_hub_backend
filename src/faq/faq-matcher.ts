export interface MatchableFaq {
  id: string;
  question: string;
  alternativeQuestions: string[];
  keywords: string[];
  displayOrder: number;
}

const synonyms: Record<string, string> = {
  signin: 'login',
  signup: 'register',
  registration: 'register',
  posts: 'blog',
  post: 'blog',
  blogs: 'blog',
  article: 'blog',
  articles: 'blog',
  write: 'create',
  writing: 'create',
  creating: 'create',
  editing: 'edit',
  update: 'edit',
  updating: 'edit',
  remove: 'delete',
  deleting: 'delete',
  removing: 'delete',
  pictures: 'image',
  picture: 'image',
  images: 'image',
  photo: 'image',
  photos: 'image',
  comments: 'comment',
  replies: 'reply',
  reactions: 'reaction',
  tags: 'tag',
  categories: 'category',
  searching: 'search',
};
const stopWords = new Set(
  'how do does i a an the my to can is are on in for of what with please me about bloghub and'.split(
    ' ',
  ),
);

export function normalizeQuestion(text: string): string {
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(?:sign|log)\s+in\b/g, 'login')
    .replace(/\bsign\s+up\b/g, 'register')
    .trim()
    .split(/\s+/)
    .map((word) => synonyms[word] ?? word);
  return words
    .filter((word, index) => word && word !== words[index - 1])
    .join(' ');
}
const tokens = (text: string) =>
  new Set(
    normalizeQuestion(text)
      .split(' ')
      .filter((word) => word && !stopWords.has(word)),
  );

function relevance(input: string, faq: MatchableFaq): number {
  const query = tokens(input);
  if (!query.size) return 0;
  let bestText = 0;
  for (const text of [faq.question, ...faq.alternativeQuestions]) {
    const document = tokens(text);
    const overlap = [...query].filter((word) => document.has(word)).length;
    if (document.size)
      bestText = Math.max(
        bestText,
        (0.6 * overlap) / query.size + (0.4 * overlap) / document.size,
      );
  }
  const normalized = ` ${normalizeQuestion(input)} `;
  const matchedKeywords = new Set<string>();
  let phrase = false;
  for (const keyword of faq.keywords) {
    const normalizedKeyword = normalizeQuestion(keyword);
    if (normalizedKeyword && normalized.includes(` ${normalizedKeyword} `)) {
      for (const word of tokens(keyword)) matchedKeywords.add(word);
      if (tokens(keyword).size > 1) phrase = true;
    }
  }
  const keywordCoverage =
    [...query].filter((word) => matchedKeywords.has(word)).length / query.size;
  // A keyword phrase can identify an intent; one incidental word in a longer question cannot.
  const keywordScore =
    phrase || matchedKeywords.size >= 2
      ? 0.8 * keywordCoverage + 0.2 * bestText
      : 0;
  return Math.min(
    0.95,
    Math.max(0.8 * bestText + 0.2 * keywordCoverage, keywordScore) +
      (phrase ? 0.05 : 0),
  );
}

export function matchFaq(question: string, faqs: MatchableFaq[]) {
  const normalized = normalizeQuestion(question);
  const ranked = faqs
    .map((faq) => ({
      faq,
      score: relevance(question, faq),
      exact: [faq.question, ...faq.alternativeQuestions].some(
        (text) => normalizeQuestion(text) === normalized,
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        b.score - a.score ||
        a.faq.displayOrder - b.faq.displayOrder ||
        a.faq.id.localeCompare(b.faq.id),
    );
  const exact = ranked.filter((item) => item.exact);
  const best = ranked[0];
  const ambiguous =
    exact.length > 1 ||
    (!exact.length &&
      ranked[1]?.score >= 0.6 &&
      best.score - ranked[1].score < 0.12);
  const found =
    best && !ambiguous && (exact.length === 1 || best.score >= 0.72);
  return {
    matchedId: found ? best.faq.id : null,
    suggestionIds: ranked
      .filter((item) => item.exact || item.score > 0)
      .slice(0, 3)
      .map((item) => item.faq.id),
  };
}
