import { Injectable } from '@nestjs/common';
import type { CreateUser, User } from '../../domain/entities/user.js';
import { UserRepository } from '../../domain/repositories/user.repository.js';
import { DatabaseService } from '../database/database.service.js';

interface UserRow {
  id: string;
  name: string;
  birth_date: string;
  gender: string | null;
  sexual_orientation: string | null;
  nationality: string | null;
  city: string | null;
  profession: string | null;
  created_at: Date;
}

const USER_COLUMNS = `
  user_id AS id,
  name,
  birth_date::TEXT,
  gender,
  sexual_orientation,
  nationality,
  city,
  profession,
  created_at
`;

@Injectable()
export class PostgresUserRepository extends UserRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async list(): Promise<User[]> {
    const rows = await this.database.query<UserRow>(
      `SELECT ${USER_COLUMNS}
       FROM app.users
       ORDER BY LOWER(name), user_id`,
    );
    return rows.map((row) => this.map(row));
  }

  async findById(id: number): Promise<User | null> {
    const rows = await this.database.query<UserRow>(
      `SELECT ${USER_COLUMNS}
       FROM app.users
       WHERE user_id = $1`,
      [id],
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  async create(input: CreateUser): Promise<User> {
    const rows = await this.database.query<UserRow>(
      `INSERT INTO app.users (
        name,
        birth_date,
        gender,
        sexual_orientation,
        nationality,
        city,
        profession
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${USER_COLUMNS}`,
      [
        input.name,
        input.birthDate,
        input.gender ?? null,
        input.sexualOrientation ?? null,
        input.nationality ?? null,
        input.city ?? null,
        input.profession ?? null,
      ],
    );
    return this.map(rows[0]);
  }

  private map(row: UserRow): User {
    return {
      id: Number(row.id),
      name: row.name,
      birthDate: row.birth_date,
      gender: row.gender,
      sexualOrientation: row.sexual_orientation,
      nationality: row.nationality,
      city: row.city,
      profession: row.profession,
      createdAt: row.created_at.toISOString(),
    };
  }
}
