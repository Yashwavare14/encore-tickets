import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OversoldError extends AppError {
  constructor(requested: number, available: number, tierId: string) {
    super(
      `Only ${available} ticket(s) remaining for tier ${tierId}, requested ${requested}.`,
      409,
      'OVERSOLD',
      {
        requested,
        available,
        tier_id: tierId,
      }
    );
    this.name = 'OversoldError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} with ID '${id}' was not found.`, 404, 'NOT_FOUND', {
      resource,
      id,
    });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.statusCode }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload schema.',
          details: error.flatten().fieldErrors,
        },
      },
      { status: 400 }
    );
  }

  console.error('Unhandled API Error:', error);

  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal server error occurred.',
      },
    },
    { status: 500 }
  );
}
