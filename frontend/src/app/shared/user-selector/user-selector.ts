import { Component, input, output } from '@angular/core';
import type { User } from '../../core/models/user.model';

@Component({
  selector: 'app-user-selector',
  template: `
    <div class="user-control">
      <label for="active-user">Perfil ativo</label>
      <div class="control-row">
        <select
          id="active-user"
          [disabled]="loading() || users().length === 0"
          (change)="onSelectionChange($event)"
        >
          @if (users().length === 0) {
            <option value="">Nenhum perfil</option>
          }
          @for (user of users(); track user.id) {
            <option
              [value]="user.id"
              [selected]="user.id === selectedUserId()"
            >
              {{ user.name }} · {{ user.age }} anos
            </option>
          }
        </select>
        <button type="button" class="new-user" (click)="createRequested.emit()">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Novo perfil</span>
        </button>
      </div>
    </div>
  `,
  styleUrl: './user-selector.css',
})
export class UserSelector {
  readonly users = input.required<User[]>();
  readonly selectedUserId = input<number | null>(null);
  readonly loading = input(false);
  readonly selectionChange = output<number>();
  readonly createRequested = output<void>();

  protected onSelectionChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(value) && value > 0) this.selectionChange.emit(value);
  }
}
