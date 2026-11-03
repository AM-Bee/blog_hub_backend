import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { validateDto } from '../common/validation.utils.js';
import {
  AskFaqDto,
  CreateFaqDto,
  FaqCategoryInputDto,
  FaqSuggestionsQueryDto,
  ListFaqsQueryDto,
  UpdateFaqDto,
} from './dto/faq-input.dto.js';
import { matchFaq, normalizeQuestion } from './faq-matcher.js';
import { initialFaqs } from './seed-faqs.js';

const faqs = initialFaqs.map((item, index) => ({
  ...item,
  id: item.key,
  displayOrder: index,
}));
const matches = (question: string) => matchFaq(question, faqs).matchedId;

it.each(initialFaqs.map((item) => [item.question, item.key]))(
  'matches verified FAQ %s',
  (question, id) => {
    expect(matches(question)).toBe(id);
  },
);
it.each([
  ['HOW do I LOG IN???', 'login'],
  [' How   do I sign-in? ', 'login'],
  ['How do I sign up?', 'register'],
  ['How do I write an article?', 'create-blog'],
  ['How do I update an article?', 'edit-blog'],
  ['What image formats are supported?', 'images'],
  ['publishing blocked', 'unpublished'],
  ['draft privacy', 'drafts'],
])(
  'matches normalization, alternatives, synonyms, and phrases: %s',
  (question, id) => {
    expect(matches(question)).toBe(id);
  },
);
it.each([
  'What is the weather tomorrow?',
  'delete account',
  'login register',
  'password',
  'login moon',
  '!!!',
])('does not guess for unknown or ambiguous input: %s', (question) => {
  expect(matches(question)).toBeNull();
});
it('matches configured keyword phrases even when the question has different words', () => {
  expect(
    matchFaq('customer service', [
      {
        id: 'support',
        question: 'Where can I get help?',
        keywords: ['customer service'],
        alternativeQuestions: [],
        displayOrder: 0,
      },
    ]).matchedId,
  ).toBe('support');
});
it('rejects duplicate exact questions and overlapping alternatives as ambiguous', () => {
  const duplicate = {
    ...faqs[0],
    id: 'duplicate',
    question: 'Other question',
    alternativeQuestions: [faqs[0].question],
  };
  const result = matchFaq(faqs[0].question, [faqs[0], duplicate]);
  expect(result.matchedId).toBeNull();
  expect(result.suggestionIds).toHaveLength(2);
});
it('is deterministic for tied suggestions and an empty catalog', () => {
  expect(matchFaq('password', [...faqs].reverse())).toEqual(
    matchFaq('password', faqs),
  );
  expect(matchFaq('anything', [])).toEqual({
    matchedId: null,
    suggestionIds: [],
  });
  expect(normalizeQuestion('  SIGN-IN!! ')).toBe('login');
});
it('validates FAQ creation defaults and does not inject defaults into PATCH', async () => {
  const created = await validateDto(
    { categoryId: randomUUID(), question: ' Question? ', answer: ' Answer ' },
    CreateFaqDto,
  );
  expect(created).toMatchObject({
    question: 'Question?',
    answer: 'Answer',
    alternativeQuestions: [],
    keywords: [],
    isActive: true,
    displayOrder: 0,
  });
  expect(await validateDto({ answer: ' Changed ' }, UpdateFaqDto)).toEqual({
    answer: 'Changed',
  });
  expect(
    await validateDto(
      { isActive: false, displayOrder: 0, keywords: [] },
      UpdateFaqDto,
    ),
  ).toEqual({ isActive: false, displayOrder: 0, keywords: [] });
});
it.each([
  {},
  { question: ' ' },
  { question: '!!!' },
  { question: 'a'.repeat(501) },
  { question: 'Valid', userId: randomUUID() },
])('rejects bad ask input %j', async (input) => {
  await expect(validateDto(input, AskFaqDto)).rejects.toThrow();
});
it.each([
  { isActive: null },
  { keywords: null },
  { answer: null },
  { isActive: 'false' },
  { displayOrder: -1 },
  { displayOrder: 1.5 },
  { alternativeQuestions: [' '] },
  { keywords: Array(21).fill('word') },
  { keywords: ['a'.repeat(101)] },
  { categoryId: 'not-uuid' },
  { surprise: true },
])('rejects bad patch input %j', async (input) => {
  await expect(validateDto(input, UpdateFaqDto)).rejects.toThrow();
});
it('bounds and strictly transforms FAQ filters', async () => {
  expect(
    await validateDto(
      { isActive: 'false', page: '2', limit: '3' },
      ListFaqsQueryDto,
    ),
  ).toMatchObject({ isActive: false, page: 2, limit: 3 });
  for (const input of [
    { isActive: 'yes' },
    { page: 0 },
    { limit: 51 },
    { categoryId: 'bad' },
  ])
    await expect(validateDto(input, ListFaqsQueryDto)).rejects.toThrow();
  await expect(
    validateDto({ limit: 11 }, FaqSuggestionsQueryDto),
  ).rejects.toThrow();
  await expect(
    validateDto(
      { name: 'Account', slug: 'Unsafe / Path' },
      FaqCategoryInputDto,
    ),
  ).rejects.toThrow();
});
