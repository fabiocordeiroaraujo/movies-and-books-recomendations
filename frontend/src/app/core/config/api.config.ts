import { DOCUMENT } from '@angular/common';
import { inject, InjectionToken } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  factory: () => {
    const document = inject(DOCUMENT);
    const hostname = document.location?.hostname || 'localhost';
    return `http://${hostname}:3000`;
  },
});
