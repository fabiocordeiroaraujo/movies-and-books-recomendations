import type { CreateUser, User } from '../entities/user.js';

export abstract class UserRepository {
  abstract list(): Promise<User[]>;
  abstract findById(id: number): Promise<User | null>;
  abstract create(input: CreateUser): Promise<User>;
}
