import { Component, input } from '@angular/core';
import type { RecommendationReason } from '../../core/models/recommendation.model';

@Component({
  selector: 'app-recommendation-reason',
  template: `
    @if (reasons()[0]; as reason) {
      <p class="reason">
        <span aria-hidden="true">✦</span>
        {{ reason.label }}
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .reason {
      box-sizing: border-box;
      min-height: 3.5rem;
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
      margin: 0;
      padding: 0.75rem 0.85rem;
      border: 1px solid rgb(241 179 78 / 18%);
      border-radius: 0.8rem;
      background: rgb(241 179 78 / 7%);
      color: var(--text-muted);
      font-size: 0.75rem;
      line-height: 1.45;
    }

    span {
      flex: 0 0 auto;
      color: var(--gold);
    }
  `,
})
export class RecommendationReasonComponent {
  readonly reasons = input.required<RecommendationReason[]>();
}
