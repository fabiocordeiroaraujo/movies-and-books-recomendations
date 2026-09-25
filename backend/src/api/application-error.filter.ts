import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  BusinessRuleError,
  EntityNotFoundError,
} from '../domain/entities/application-error.js';

@Catch(EntityNotFoundError, BusinessRuleError)
export class ApplicationErrorFilter implements ExceptionFilter {
  catch(
    exception: EntityNotFoundError | BusinessRuleError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.statusCode).json({
      statusCode: exception.statusCode,
      error: exception.name,
      message: exception.message,
    });
  }
}
