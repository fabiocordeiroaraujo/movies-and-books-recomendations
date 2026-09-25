import { Component, input, output, signal } from '@angular/core';
import type {
  MediaSummary,
  PreferenceValue,
} from '../../core/models/catalog.model';
import { PreferenceButtons } from '../preference-buttons/preference-buttons';

@Component({
  selector: 'app-media-card',
  imports: [PreferenceButtons],
  template: `
    <article class="media-card">
      <button
        type="button"
        class="cover-button"
        [attr.aria-label]="'Abrir detalhes de ' + item().title"
        (click)="detailsRequested.emit(item())"
      >
        @if (item().imageUrl && !imageFailed()) {
          <img
            class="cover"
            [src]="item().imageUrl"
            [alt]="'Capa de ' + item().title"
            loading="lazy"
            width="320"
            height="480"
            (error)="imageFailed.set(true)"
          />
        } @else {
          <span class="cover placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              @if (item().type === 'MOVIE') {
                <path d="M3 6h18v13H3zM7 6l2-3m4 3 2-3m4 3 2-3" />
              } @else {
                <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Zm0 17A2.5 2.5 0 0 1 6.5 19H20" />
              }
            </svg>
          </span>
        }
        <span class="open-hint" aria-hidden="true">Ver detalhes</span>
        @if (preference()) {
          <span
            class="preference-marker"
            [class.disliked]="preference() === 'DISLIKE'"
            aria-hidden="true"
          >
            {{ preference() === 'LIKE' ? '♥' : '—' }}
          </span>
        }
      </button>

      <div class="card-body">
        <button
          type="button"
          class="title-button"
          (click)="detailsRequested.emit(item())"
        >
          {{ item().title }}
        </button>
        <div class="metadata">
          <span>{{ item().releaseYear ?? 'Ano indisponível' }}</span>
          @if (item().averageRating !== null) {
            <span class="rating" aria-label="Avaliação média">
              ★ {{ item().averageRating!.toFixed(1) }}
            </span>
          }
        </div>
        <p class="category">
          {{ item().categories[0]?.name ?? (item().type === 'MOVIE' ? 'Filme' : 'Livro') }}
        </p>
        <app-preference-buttons
          [preference]="preference()"
          [disabled]="!hasUser()"
          [pending]="pending()"
          (changed)="preferenceChanged.emit($event)"
        />
      </div>
    </article>
  `,
  styleUrl: './media-card.css',
})
export class MediaCard {
  readonly item = input.required<MediaSummary>();
  readonly preference = input<PreferenceValue | null>(null);
  readonly hasUser = input(false);
  readonly pending = input(false);
  readonly detailsRequested = output<MediaSummary>();
  readonly preferenceChanged = output<PreferenceValue>();
  protected readonly imageFailed = signal(false);
}
