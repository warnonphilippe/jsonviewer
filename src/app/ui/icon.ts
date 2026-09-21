import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The icon set, as inline SVG.
 *
 * A closed union rather than a string: adding a name that has no `@case` is a
 * compile error at every call site, and `icon.spec.ts` asserts every member of
 * the union renders a path. There is no icon font, no sprite file and no
 * network request -- the paths are part of the template, which is what keeps
 * the "no runtime dependency beyond @angular/cdk" promise intact.
 *
 * Every path is drawn on a 16x16 grid with a 1.5 stroke, so they sit together
 * without per-icon nudging.
 */
export type IconName =
  | 'braces'
  | 'case'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'close'
  | 'collapse'
  | 'copy'
  | 'expand'
  | 'file'
  | 'keyboard'
  | 'link'
  | 'monitor'
  | 'moon'
  | 'more'
  | 'search'
  | 'shield'
  | 'sun'
  | 'swap'
  | 'warning';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
      flex: 0 0 auto;
    }
  `,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('braces') {
          <path d="M6.3 2.3C4.6 2.3 4.8 4.6 4.8 5.7s-1 2.3-2 2.3c1 0 2 1.1 2 2.3s-.2 3.4 1.5 3.4" />
          <path d="M9.7 2.3c1.7 0 1.5 2.3 1.5 3.4s1 2.3 2 2.3c-1 0-2 1.1-2 2.3s.2 3.4-1.5 3.4" />
        }
        @case ('case') {
          <path d="M1.6 12l3.6-8.4L8.8 12M2.9 9.1h4.6M14.4 7.6v4.4M14.4 9.1a2.4 2.4 0 1 0 0 2.9" />
        }
        @case ('check') {
          <path d="M3 8.4l3.2 3.2L13 4.8" />
        }
        @case ('chevron-down') {
          <path d="M4 6l4 4 4-4" />
        }
        @case ('chevron-right') {
          <path d="M6 3.5L10.5 8 6 12.5" />
        }
        @case ('chevron-up') {
          <path d="M4 10l4-4 4 4" />
        }
        @case ('close') {
          <path d="M4 4l8 8M12 4l-8 8" />
        }
        @case ('collapse') {
          <rect x="2.3" y="2.3" width="11.4" height="11.4" rx="2.7" />
          <path d="M5.3 8h5.4" />
        }
        @case ('copy') {
          <rect x="5.3" y="5.3" width="9" height="9" rx="2" />
          <path d="M10.7 2.7H4.3a1.6 1.6 0 0 0-1.6 1.6v6.4" />
        }
        @case ('expand') {
          <rect x="2.3" y="2.3" width="11.4" height="11.4" rx="2.7" />
          <path d="M5.3 8h5.4M8 5.3v5.4" />
        }
        @case ('file') {
          <path
            d="M9.2 1.8H5.2A1.7 1.7 0 0 0 3.5 3.5v9a1.7 1.7 0 0 0 1.7 1.7h5.6a1.7 1.7 0 0 0 1.7-1.7V5z"
          />
          <path d="M9.2 1.8V5h3.3" />
        }
        @case ('keyboard') {
          <rect x="1.2" y="4" width="13.6" height="8" rx="1.8" />
          <path d="M3.9 6.9h.01M6.6 6.9h.01M9.4 6.9h.01M12.1 6.9h.01M5.2 9.6h5.6" />
        }
        @case ('link') {
          <path d="M7 9a3 3 0 0 0 4.5 0l2-2a3 3 0 1 0-4.5-4.5l-1.1 1.1" />
          <path d="M9 7a3 3 0 0 0-4.5 0l-2 2A3 3 0 0 0 7 13.5l1.1-1.1" />
        }
        @case ('monitor') {
          <rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.6" />
          <path d="M5.6 14h4.8M8 11.2V14" />
        }
        @case ('moon') {
          <path d="M13.2 9.6A5.8 5.8 0 0 1 6.4 2.8a5.8 5.8 0 1 0 6.8 6.8z" />
        }
        @case ('more') {
          <circle cx="8" cy="3.4" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="12.6" r="1.2" fill="currentColor" stroke="none" />
        }
        @case ('search') {
          <circle cx="7.1" cy="7.1" r="4.9" />
          <path d="M10.7 10.7L14.3 14.3" />
        }
        @case ('shield') {
          <path d="M8 1.6l5.3 2v4.5c0 3.3-2.2 5.7-5.3 6.3-3.1-.6-5.3-3-5.3-6.3V3.6z" />
          <path d="M5.8 8.1l1.5 1.5 2.9-3.1" />
        }
        @case ('sun') {
          <circle cx="8" cy="8" r="3.3" />
          <path
            d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"
          />
        }
        @case ('swap') {
          <path d="M2.3 5.5h9.4L9.2 3M13.7 10.5H4.3L6.8 13" />
        }
        @case ('warning') {
          <path d="M8 2.2l6 10.4H2z" />
          <path d="M8 6.4v3M8 11.3h.01" />
        }
      }
    </svg>
  `,
})
export class AppIcon {
  readonly name = input.required<IconName>();
  readonly size = input(14);
}
