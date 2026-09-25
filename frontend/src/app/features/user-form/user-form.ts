import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { HttpErrorResponse } from '@angular/common/http';
import { AppStateService } from '../../core/services/app-state.service';

@Component({
  selector: 'app-user-form',
  imports: [ReactiveFormsModule],
  templateUrl: './user-form.html',
  styleUrl: './user-form.css',
})
export class UserFormComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly state = inject(AppStateService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly birthDate = signal('');
  protected readonly maxDate = new Date().toISOString().slice(0, 10);
  protected readonly calculatedAge = computed(() => {
    const value = this.birthDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const today = new Date();
    let age = today.getFullYear() - year;
    if (
      today.getMonth() + 1 < month ||
      (today.getMonth() + 1 === month && today.getDate() < day)
    ) {
      age -= 1;
    }
    return age >= 0 ? age : null;
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    birthDate: ['', Validators.required],
    gender: [''],
    sexualOrientation: [''],
    nationality: ['', Validators.maxLength(100)],
    city: ['', Validators.maxLength(120)],
    profession: ['', Validators.maxLength(120)],
  });

  open(): void {
    this.error.set(null);
    this.submitted.set(false);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
    this.form.reset();
    this.birthDate.set('');
  }

  protected updateBirthDate(event: Event): void {
    this.birthDate.set((event.target as HTMLInputElement).value);
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    try {
      const value = this.form.getRawValue();
      await this.state.createUser({
        name: value.name,
        birthDate: value.birthDate,
        gender: value.gender || undefined,
        sexualOrientation: value.sexualOrientation || undefined,
        nationality: value.nationality || undefined,
        city: value.city || undefined,
        profession: value.profession || undefined,
      });
      this.close();
    } catch (error: unknown) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected closeFromBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  private errorMessage(error: unknown): string {
    const response = error as HttpErrorResponse;
    const message = response.error?.message as unknown;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    if (typeof message === 'string') return message;
    return 'Não foi possível cadastrar o perfil. Tente novamente.';
  }
}
