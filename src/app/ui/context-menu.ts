import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AppIcon, IconName } from './icon';
import { placeMenu } from '../core/place-menu';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Shown right-aligned, e.g. the keyboard shortcut that does the same thing. */
  readonly keyHint?: string;
  readonly disabled?: boolean;
  /** Draw a divider above this item. */
  readonly separatorBefore?: boolean;
  /**
   * Present on toggles: renders a check in the icon slot, and reserves that
   * slot when false so the labels of a group stay aligned.
   */
  readonly checked?: boolean;
}

/**
 * A menu opened at a point -- by right-click on a row, or under a toolbar
 * button.
 *
 * It renders at the shell level with `position: fixed`, and it has to: the tree
 * rows carry `contain: layout paint` and the viewport clips its overflow, so a
 * menu rendered inside a row would be invisible below 24px.
 *
 * Positioning is `core/place-menu.ts` -- a right-click menu is anchored to a
 * *point*, which is arithmetic, not a reason to take on CDK Overlay and its
 * global prebuilt stylesheet.
 */
@Component({
  selector: 'app-context-menu',
  imports: [AppIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: fixed;
      z-index: 40;
    }
  `,
  template: `
    <div
      #menu
      class="menu"
      role="menu"
      [attr.aria-label]="label()"
      [style.visibility]="placed() ? 'visible' : 'hidden'"
      (keydown)="onKeydown($event)"
    >
      @if (heading(); as text) {
        <div class="menu-heading" aria-hidden="true">{{ text }}</div>
        <div class="menu-sep"></div>
      }
      @for (item of items(); track item.id) {
        @if (item.separatorBefore) {
          <div class="menu-sep" role="separator"></div>
        }
        <button
          type="button"
          class="menu-item"
          role="menuitem"
          [attr.aria-disabled]="item.disabled ? 'true' : null"
          [attr.tabindex]="item.disabled ? -1 : 0"
          (click)="choose(item)"
        >
          @if (item.checked !== undefined) {
            @if (item.checked) {
              <app-icon class="menu-icon" name="check" />
            } @else {
              <span class="menu-icon" style="width: 14px"></span>
            }
          } @else if (item.icon; as icon) {
            <app-icon class="menu-icon" [name]="icon" />
          }
          <span class="menu-label">{{ item.label }}</span>
          @if (item.keyHint; as hint) {
            <span class="menu-key">{{ hint }}</span>
          }
        </button>
      }
    </div>
  `,
})
export class ContextMenu {
  readonly items = input.required<readonly MenuItem[]>();
  /** Where the menu was opened, in client coordinates. */
  readonly at = input.required<{ x: number; y: number }>();
  readonly label = input('Actions');
  /** Optional context line above the items, e.g. the node's path. */
  readonly heading = input<string | null>(null);

  readonly action = output<string>();
  readonly dismissed = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  /** Hidden until measured, so it never flashes at the wrong place. */
  protected readonly placed = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Anything outside the menu closes it. `capture` so a handler on the target
    // cannot swallow it first, `pointerdown` so it closes before a click lands.
    const onPointerDown = (event: Event) => {
      if (!this.menu().nativeElement.contains(event.target as Node)) this.dismissed.emit();
    };
    const onDismiss = () => this.dismissed.emit();

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onDismiss);
    // A menu anchored to a point is wrong the moment anything scrolls under it.
    window.addEventListener('scroll', onDismiss, true);

    destroyRef.onDestroy(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    });

    afterNextRender(() => {
      const element = this.menu().nativeElement;
      const { x, y } = placeMenu(
        this.at().x,
        this.at().y,
        element.offsetWidth,
        element.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      );
      const style = this.host.nativeElement.style;
      style.left = `${x}px`;
      style.top = `${y}px`;
      this.placed.set(true);
      this.enabledItems()[0]?.focus();
    });
  }

  private enabledItems(): HTMLButtonElement[] {
    return [
      ...this.menu().nativeElement.querySelectorAll<HTMLButtonElement>(
        '.menu-item:not([aria-disabled="true"])',
      ),
    ];
  }

  protected choose(item: MenuItem): void {
    if (item.disabled) return;
    this.action.emit(item.id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const buttons = this.enabledItems();
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        buttons[(current + 1 + buttons.length) % buttons.length].focus();
        break;
      case 'ArrowUp':
        buttons[(current - 1 + buttons.length) % buttons.length].focus();
        break;
      case 'Home':
        buttons[0].focus();
        break;
      case 'End':
        buttons[buttons.length - 1].focus();
        break;
      case 'Escape':
      case 'Tab':
        this.dismissed.emit();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
}
