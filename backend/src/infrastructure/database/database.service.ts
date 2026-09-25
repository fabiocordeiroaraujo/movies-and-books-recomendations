import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'recommendations',
    user: process.env.DB_USER ?? 'recommendations',
    password: process.env.DB_PASSWORD ?? 'recommendations_dev',
    max: Number(process.env.DB_POOL_SIZE ?? 10),
    ssl:
      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  async query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Row[]> {
    const result = await this.pool.query<Row>(text, [...values]);
    return result.rows;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
