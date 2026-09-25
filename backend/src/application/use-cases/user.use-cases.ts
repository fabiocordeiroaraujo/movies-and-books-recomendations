import { Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  EntityNotFoundError,
} from '../../domain/entities/application-error.js';
import {
  calculateAge,
  type CreateUser,
  type User,
  type UserWithAge,
} from '../../domain/entities/user.js';
import { UserRepository } from '../../domain/repositories/user.repository.js';

@Injectable()
export class UserUseCases {
  constructor(private readonly userRepository: UserRepository) {}

  async list(): Promise<UserWithAge[]> {
    const users = await this.userRepository.list();
    return users.map((user) => this.withAge(user));
  }

  async getById(id: number): Promise<UserWithAge> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new EntityNotFoundError('Usuário não encontrado.');
    }
    return this.withAge(user);
  }

  async create(input: CreateUser): Promise<UserWithAge> {
    this.assertValidBirthDate(input.birthDate);

    const normalized: CreateUser = {
      name: input.name.trim(),
      birthDate: input.birthDate,
      gender: this.normalizeOptional(input.gender),
      sexualOrientation: this.normalizeOptional(input.sexualOrientation),
      nationality: this.normalizeOptional(input.nationality),
      city: this.normalizeOptional(input.city),
      profession: this.normalizeOptional(input.profession),
    };

    const user = await this.userRepository.create(normalized);
    return this.withAge(user);
  }

  private assertValidBirthDate(value: string): void {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const isRealDate =
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day;

    if (!isRealDate) {
      throw new BusinessRuleError('Informe uma data de nascimento válida.');
    }

    const now = new Date();
    if (parsed.getTime() > now.getTime()) {
      throw new BusinessRuleError(
        'A data de nascimento não pode estar no futuro.',
      );
    }

    if (year < 1900) {
      throw new BusinessRuleError(
        'A data de nascimento deve ser posterior a 1900.',
      );
    }
  }

  private normalizeOptional(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private withAge(user: User): UserWithAge {
    return { ...user, age: calculateAge(user.birthDate) };
  }
}
