import { Inject, Injectable } from '@nestjs/common';
import { FaqRepository } from './faq.repository.js';
import {
  AskFaqDto,
  CreateFaqDto,
  FaqCategoryInputDto,
  FaqSuggestionsQueryDto,
  ListFaqsQueryDto,
  UpdateFaqCategoryDto,
  UpdateFaqDto,
} from './dto/faq-input.dto.js';
import { validateDto } from '../common/validation.utils.js';
import { matchFaq } from './faq-matcher.js';
import type { FaqAnswer } from './interfaces/faq.interface.js';

@Injectable()
export class FaqService {
  constructor(
    @Inject(FaqRepository) private readonly repository: FaqRepository,
  ) {}

  async ask(input: AskFaqDto): Promise<FaqAnswer> {
    const dto = await validateDto(input, AskFaqDto);
    const faqs = await this.repository.active();
    const result = matchFaq(dto.question, faqs);
    const matched = faqs.find((item) => item.id === result.matchedId);
    if (matched)
      return {
        found: true,
        answer: matched.answer,
        matchedQuestion: matched.question,
        category: matched.category.name,
        suggestions: [],
      };
    const choices = result.suggestionIds.length
      ? result.suggestionIds.map((id) => faqs.find((item) => item.id === id)!)
      : faqs.slice(0, 3);
    return {
      found: false,
      answer:
        "I couldn't find a clear answer to that question. Please try a more specific question or choose one of these FAQs.",
      matchedQuestion: null,
      category: null,
      suggestions: choices.map((item) => this.repository.suggestion(item)),
    };
  }

  suggestions(query: FaqSuggestionsQueryDto) {
    return this.repository.suggestions(query);
  }
  categories(publicOnly = true) {
    return this.repository.categories(publicOnly);
  }
  findOne(id: string, publicOnly = true) {
    return this.repository.findOne(id, publicOnly);
  }
  list(query: ListFaqsQueryDto) {
    return this.repository.list(query);
  }
  create(input: CreateFaqDto) {
    return this.repository.create(input);
  }
  update(id: string, input: UpdateFaqDto) {
    return this.repository.update(id, input);
  }
  remove(id: string) {
    return this.repository.remove(id);
  }
  createCategory(input: FaqCategoryInputDto) {
    return this.repository.createCategory(input);
  }
  updateCategory(id: string, input: UpdateFaqCategoryDto) {
    return this.repository.updateCategory(id, input);
  }
  removeCategory(id: string) {
    return this.repository.removeCategory(id);
  }
}
