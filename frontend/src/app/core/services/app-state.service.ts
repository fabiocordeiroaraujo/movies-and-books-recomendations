import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  MediaType,
  Preference,
  PreferenceValue,
} from '../models/catalog.model';
import type { CreateUser, User } from '../models/user.model';
import { PreferencesApiService } from './preferences-api.service';
import { UsersApiService } from './users-api.service';

const ACTIVE_USER_KEY = 'reel-and-read.active-user';

@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly usersApi = inject(UsersApiService);
  private readonly preferencesApi = inject(PreferencesApiService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly usersState = signal<User[]>([]);
  private readonly activeUserIdState = signal<number | null>(null);
  private readonly preferencesState = signal<Preference[]>([]);
  private readonly loadingUsersState = signal(false);
  private readonly loadingPreferencesState = signal(false);
  private readonly pendingPreferencesState = signal<ReadonlySet<string>>(
    new Set(),
  );
  private readonly errorState = signal<string | null>(null);

  readonly users = this.usersState.asReadonly();
  readonly activeUserId = this.activeUserIdState.asReadonly();
  readonly preferences = this.preferencesState.asReadonly();
  readonly loadingUsers = this.loadingUsersState.asReadonly();
  readonly loadingPreferences = this.loadingPreferencesState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly activeUser = computed(
    () =>
      this.usersState().find(
        (user) => user.id === this.activeUserIdState(),
      ) ?? null,
  );
  private readonly preferenceMap = computed(() => {
    const entries = this.preferencesState().map(
      (preference) =>
        [
          this.preferenceKey(preference.itemType, preference.itemId),
          preference.preference,
        ] as const,
    );
    return new Map(entries);
  });

  async initialize(): Promise<void> {
    this.loadingUsersState.set(true);
    this.errorState.set(null);
    try {
      const users = await firstValueFrom(this.usersApi.list());
      this.usersState.set(users);
      const storedId = this.readStoredUserId();
      const selected = users.find((user) => user.id === storedId) ?? users[0];
      if (selected) await this.selectUser(selected.id);
    } catch {
      this.errorState.set(
        'Não foi possível carregar os usuários. Verifique se a API está ativa.',
      );
    } finally {
      this.loadingUsersState.set(false);
    }
  }

  async selectUser(id: number): Promise<void> {
    if (!this.usersState().some((user) => user.id === id)) return;
    this.activeUserIdState.set(id);
    this.preferencesState.set([]);
    this.storeUserId(id);
    await this.loadPreferences(id);
  }

  async createUser(input: CreateUser): Promise<User> {
    const created = await firstValueFrom(this.usersApi.create(input));
    this.usersState.update((users) =>
      [...users, created].sort((left, right) =>
        left.name.localeCompare(right.name, 'pt-BR'),
      ),
    );
    await this.selectUser(created.id);
    return created;
  }

  preferenceFor(type: MediaType, itemId: number): PreferenceValue | null {
    return this.preferenceMap().get(this.preferenceKey(type, itemId)) ?? null;
  }

  isPreferencePending(type: MediaType, itemId: number): boolean {
    return this.pendingPreferencesState().has(this.preferenceKey(type, itemId));
  }

  async togglePreference(
    type: MediaType,
    itemId: number,
    value: PreferenceValue,
  ): Promise<void> {
    const userId = this.activeUserIdState();
    if (!userId) {
      this.errorState.set('Selecione ou cadastre um usuário primeiro.');
      return;
    }

    const key = this.preferenceKey(type, itemId);
    if (this.pendingPreferencesState().has(key)) return;
    this.setPending(key, true);
    this.errorState.set(null);

    try {
      const current = this.preferenceFor(type, itemId);
      if (current === value) {
        await firstValueFrom(this.preferencesApi.remove(userId, type, itemId));
        this.preferencesState.update((preferences) =>
          preferences.filter(
            (item) => !(item.itemType === type && item.itemId === itemId),
          ),
        );
      } else {
        const saved = await firstValueFrom(
          this.preferencesApi.set(userId, type, itemId, value),
        );
        this.preferencesState.update((preferences) => [
          ...preferences.filter(
            (item) => !(item.itemType === type && item.itemId === itemId),
          ),
          saved,
        ]);
      }
    } catch {
      this.errorState.set('Não foi possível salvar sua preferência. Tente novamente.');
    } finally {
      this.setPending(key, false);
    }
  }

  clearError(): void {
    this.errorState.set(null);
  }

  reportError(message: string): void {
    this.errorState.set(message);
  }

  private async loadPreferences(userId: number): Promise<void> {
    this.loadingPreferencesState.set(true);
    try {
      const preferences = await firstValueFrom(
        this.preferencesApi.list(userId),
      );
      if (this.activeUserIdState() === userId) {
        this.preferencesState.set(preferences);
      }
    } catch {
      this.errorState.set('Não foi possível carregar as preferências deste usuário.');
    } finally {
      this.loadingPreferencesState.set(false);
    }
  }

  private setPending(key: string, pending: boolean): void {
    this.pendingPreferencesState.update((current) => {
      const updated = new Set(current);
      if (pending) updated.add(key);
      else updated.delete(key);
      return updated;
    });
  }

  private preferenceKey(type: MediaType, itemId: number): string {
    return `${type}:${itemId}`;
  }

  private readStoredUserId(): number | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const value = localStorage.getItem(ACTIVE_USER_KEY);
    const parsed = value ? Number(value) : Number.NaN;
    return Number.isInteger(parsed) ? parsed : null;
  }

  private storeUserId(id: number): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(ACTIVE_USER_KEY, String(id));
    }
  }
}
