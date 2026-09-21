import { Injectable, signal } from '@angular/core';

/** How long a toast stays up. */
const TOAST_MS = 2600;

/** Transient confirmations and refusals. One at a time; a new one replaces it. */
@Injectable({ providedIn: 'root' })
export class ToastStore {
  private readonly _message = signal('');
  readonly message = this._message.asReadonly();

  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string): void {
    this._message.set(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._message.set(''), TOAST_MS);
  }
}
