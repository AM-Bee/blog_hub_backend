import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

export function dtoValidationPipe(dtoClass: ClassConstructor<object>) {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    expectedType: dtoClass,
  });
}

export async function validateDto<T extends object>(
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
