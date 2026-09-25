import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../config/api.config';
import type { CreateUser, User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list() {
    return this.http.get<User[]>(`${this.baseUrl}/users`);
  }

  create(input: CreateUser) {
    return this.http.post<User>(`${this.baseUrl}/users`, input);
  }
}
