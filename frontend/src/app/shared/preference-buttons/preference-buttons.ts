import { Component, input, output } from '@angular/core';
import type { PreferenceValue } from '../../core/models/catalog.model';

@Component({
  selector: 'app-preference-buttons',
  template: `
    <div class="preference-actions" aria-label="Registrar preferência">
      <button
        type="button"
        class="preference-button like"
        [class.selected]="preference() === 'LIKE'"
        [disabled]="disabled() || pending()"
        [attr.aria-pressed]="preference() === 'LIKE'"
        [attr.aria-label]="
          preference() === 'LIKE' ? 'Remover gostei' : 'Marcar como gostei'
        "
        (click)="changed.emit('LIKE')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M7.7 21H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3.7m0 12V9l4-7 .8.4A3 3 0 0 1 14 5v3h5.2a2.8 2.8 0 0 1 2.7 3.5l-1.8 7A3.3 3.3 0 0 1 17 21H7.7Z" />
        </svg>
        <span>Gostei</span>
      </button>
      <button
        type="button"
        class="preference-button dislike"
        [class.selected]="preference() === 'DISLIKE'"
        [disabled]="disabled() || pending()"
        [attr.aria-pressed]="preference() === 'DISLIKE'"
        [attr.aria-label]="
          preference() === 'DISLIKE'
            ? 'Remover não gostei'
            : 'Marcar como não gostei'
        "
        (click)="changed.emit('DISLIKE')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M16.3 3H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.7m0-12v12l-4 7-.8-.4A3 3 0 0 1 10 19v-3H4.8a2.8 2.8 0 0 1-2.7-3.5l1.8-7A3.3 3.3 0 0 1 7 3h9.3Z" />
        </svg>
        <span>Não gostei</span>
      </button>
      @if (pending()) {
        <span class="saving" role="status">Salvando…</span>
      }
    </div>
  `,
  styleUrl: './preference-buttons.css',
})
export class PreferenceButtons {
  readonly preference = input<PreferenceValue | null>(null);
  readonly disabled = input(false);
  readonly pending = input(false);
  readonly changed = output<PreferenceValue>();
}
