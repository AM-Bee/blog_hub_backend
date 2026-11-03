export interface FaqCategory {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}
export interface FaqSuggestion {
  id: string;
  question: string;
  category: string;
}
export interface PublicFaq extends FaqSuggestion {
  answer: string;
}
export interface AdminFaq extends PublicFaq {
  categoryId: string;
  alternativeQuestions: string[];
  keywords: string[];
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface FaqPage {
  items: AdminFaq[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface FaqAnswer {
  found: boolean;
  answer: string;
  matchedQuestion: string | null;
  category: string | null;
  suggestions: FaqSuggestion[];
}
