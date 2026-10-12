export function normalizeTaxonomyName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

export function taxonomySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
