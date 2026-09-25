export class EntityNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'EntityNotFoundError';
  }
}

export class BusinessRuleError extends Error {
  readonly statusCode = 422;

  constructor(message: string) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}
