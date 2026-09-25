import { Injectable } from '@nestjs/common';
import type { MediaType } from '../../domain/entities/catalog.js';
import type {
  Preference,
  PreferenceValue,
} from '../../domain/entities/preference.js';
import { PreferenceRepository } from '../../domain/repositories/preference.repository.js';
import { DatabaseService } from '../database/database.service.js';

interface PreferenceRow {
  item_type: MediaType;
  item_id: string;
  preference: PreferenceValue;
  updated_at: Date;
}

const RETURNED_PREFERENCE = `
  item_type,
  COALESCE(movie_id, book_id) AS item_id,
  preference,
  updated_at
`;

@Injectable()
export class PostgresPreferenceRepository extends PreferenceRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async listByUser(userId: number): Promise<Preference[]> {
    const rows = await this.database.query<PreferenceRow>(
      `SELECT ${RETURNED_PREFERENCE}
       FROM app.user_preferences
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );
    return rows.map((row) => this.map(row));
  }

  async upsert(
    userId: number,
    itemType: MediaType,
    itemId: number,
    preference: PreferenceValue,
  ): Promise<Preference> {
    const isMovie = itemType === 'MOVIE';
    const mediaColumn = isMovie ? 'movie_id' : 'book_id';
    const conflictPredicate = `${mediaColumn} IS NOT NULL`;
    const rows = await this.database.query<PreferenceRow>(
      `INSERT INTO app.user_preferences (
        user_id, item_type, ${mediaColumn}, preference
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, ${mediaColumn}) WHERE ${conflictPredicate}
      DO UPDATE SET preference = EXCLUDED.preference, updated_at = CURRENT_TIMESTAMP
      RETURNING ${RETURNED_PREFERENCE}`,
      [userId, itemType, itemId, preference],
    );
    return this.map(rows[0]);
  }

  async remove(
    userId: number,
    itemType: MediaType,
    itemId: number,
  ): Promise<void> {
    const mediaColumn = itemType === 'MOVIE' ? 'movie_id' : 'book_id';
    await this.database.query(
      `DELETE FROM app.user_preferences
       WHERE user_id = $1 AND ${mediaColumn} = $2`,
      [userId, itemId],
    );
  }

  private map(row: PreferenceRow): Preference {
    return {
      itemType: row.item_type,
      itemId: Number(row.item_id),
      preference: row.preference,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
