import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

export function normalizeTaxonomyName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

export function taxonomySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// Validate internal callers too, not just HTTP requests.
export async function validateTaxonomyName(
  input: object,
  dtoClass: ClassConstructor<{ name: string }>,
): Promise<string> {
  const dto = await validateTaxonomyInput(input, dtoClass);
  return dto.name;
}

export async function validateTaxonomyInput<T extends object>(
  input: object,
  dtoClass: ClassConstructor<T>,
): Promise<T> {
  const dto = plainToInstance(dtoClass, input);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    throw new BadRequestException(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    );
  }
  return dto;
}
