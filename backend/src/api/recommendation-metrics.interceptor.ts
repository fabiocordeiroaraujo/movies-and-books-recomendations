import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DatabaseService } from '../infrastructure/database/database.service.js';

@Injectable()
export class RecommendationMetricsInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = performance.now();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const endpoint = request.route?.path
      ? `${request.method} ${String(request.route.path)}`
      : `${request.method} recommendation`;

    return next.handle().pipe(
      tap({
        next: (body: unknown) =>
          this.record(endpoint, response.statusCode, startedAt, body),
        error: () => this.record(endpoint, response.statusCode || 500, startedAt),
      }),
    );
  }

  private record(
    endpoint: string,
    statusCode: number,
    startedAt: number,
    body?: unknown,
  ): void {
    const strategy =
      typeof body === 'object' && body !== null && 'strategy' in body
        ? String(body.strategy)
        : '';
    void this.database
      .query(
        `INSERT INTO recommendation.api_request_metrics (
           endpoint, status_code, duration_ms, fallback_used
         ) VALUES ($1, $2, $3, $4)`,
        [
          endpoint,
          statusCode,
          Math.max(0, Math.round(performance.now() - startedAt)),
          strategy.endsWith('FALLBACK'),
        ],
      )
      .catch(() => undefined);
  }
}
