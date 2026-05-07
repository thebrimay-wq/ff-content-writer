/**
 * <ff-brand-button> — canonical CTA across the FF AI Workspace.
 *
 * The single source of truth for the brand button in this app. Sibling apps
 * (AI Meeting Studio, AI Assessment Studio) implement the equivalent React
 * primitive — they must stay visually identical. If you change padding,
 * radius, color, or shadow here, port the change to the sibling repos in
 * the same PR cycle.
 *
 * Implementation
 * ──────────────
 * Uses Shadow DOM with explicit inline styles that mirror the Tailwind
 * utilities used elsewhere in the app. We deliberately don't share Tailwind
 * with the host page because:
 *   - Light DOM + Lit's `<slot>` element doesn't project (slots only work
 *     in shadow DOM), and the parent's slotted text would be stranded as
 *     an orphan sibling next to an empty inner button.
 *   - Light DOM + the host-as-button approach (no inner element) collides
 *     with the parent's Lit ChildPart markers and produces zero-width
 *     content.
 * Shadow DOM with a real <button> + real <slot>s is the only reliable
 * combination, so the styles below are duplicated from the Tailwind
 * tokens for the three variants × three sizes.
 *
 * Usage
 * ─────
 *   <ff-brand-button @click=${...}>New article</ff-brand-button>
 *
 *   <ff-brand-button variant="ai" size="sm">
 *     <svg slot="icon" ...></svg>
 *     Summarize
 *   </ff-brand-button>
 *
 *   <ff-brand-button variant="ghost" size="lg" disabled>Cancel</ff-brand-button>
 *
 * Props
 * ─────
 *   variant : "primary" (default) | "ai" | "ghost"
 *   size    : "sm" | "md" (default) | "lg"
 *   disabled: boolean
 *   type    : "button" (default) | "submit" | "reset"
 *
 * Slots
 * ─────
 *   default : the label text
 *   icon    : optional icon (rendered before the label)
 *   trailing: optional trailing icon (rendered after the label)
 */

import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

type Variant = 'primary' | 'ai' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

@customElement('ff-brand-button')
export class FFBrandButton extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    :host([disabled]) {
      pointer-events: none;
    }
    button {
      /* Layout */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      white-space: nowrap;
      /* Type */
      font-family: inherit;
      font-weight: 600;
      letter-spacing: -0.005em;
      /* Shape */
      border: 0;
      border-radius: 9999px;
      cursor: pointer;
      user-select: none;
      transition: all 150ms ease-out;
      /* Reset */
      margin: 0;
      padding: 0 0.875rem;
      height: 2rem;
      font-size: 12.5px;
      color: inherit;
      background: transparent;
    }
    button:active:not(:disabled) {
      transform: scale(0.98);
    }
    button:focus {
      outline: none;
    }
    button:focus-visible {
      box-shadow: 0 0 0 2px rgba(6, 56, 83, 0.3);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      box-shadow: none;
    }
    button:disabled:active {
      transform: none;
    }

    /* Sizes */
    button[data-size="sm"] {
      height: 1.75rem;
      padding: 0 0.75rem;
      font-size: 12px;
      gap: 0.375rem;
    }
    button[data-size="md"] {
      height: 2rem;
      padding: 0 0.875rem;
      font-size: 12.5px;
      gap: 0.375rem;
    }
    button[data-size="lg"] {
      height: 2.5rem;
      padding: 0 1.25rem;
      font-size: 14px;
      gap: 0.5rem;
    }

    /* Variants */
    button[data-variant="primary"] {
      color: #ffffff;
      background: #063853;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
    button[data-variant="primary"]:hover:not(:disabled) {
      background: #04293D;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    }

    button[data-variant="ai"] {
      color: #063853;
      background: #EFEDFB;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      box-shadow: inset 0 0 0 1px rgba(124, 112, 227, 0.18), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
    button[data-variant="ai"]:hover:not(:disabled) {
      background: #F7F6FD;
      box-shadow: inset 0 0 0 1px rgba(124, 112, 227, 0.18), 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    }

    button[data-variant="ghost"] {
      color: #374151;
      background: transparent;
    }
    button[data-variant="ghost"]:hover:not(:disabled) {
      color: #111827;
      background: rgba(0, 0, 0, 0.04);
    }

    /* Slot styling. Icon SVGs sometimes carry an explicit fill/currentColor
       and rely on the button's color. */
    ::slotted(svg) {
      flex: 0 0 auto;
    }
  `

  @property({ type: String }) variant: Variant = 'primary'
  @property({ type: String }) size: Size = 'md'
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: String }) type: 'button' | 'submit' | 'reset' = 'button'
  @property({ type: String, attribute: 'aria-label' }) ariaLabelAttr: string | null = null

  override render() {
    return html`
      <button
        type=${this.type}
        ?disabled=${this.disabled}
        data-variant=${this.variant}
        data-size=${this.size}
        aria-label=${this.ariaLabelAttr ?? nothing}
        @click=${this._onClick}
      >
        <slot name="icon"></slot>
        <slot></slot>
        <slot name="trailing"></slot>
      </button>
    `
  }

  private _onClick = (e: MouseEvent) => {
    if (this.disabled) {
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }
    if (this.type === 'submit' || this.type === 'reset') {
      const form = this.closest('form')
      if (form) {
        e.preventDefault()
        if (this.type === 'submit') form.requestSubmit()
        else form.reset()
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ff-brand-button': FFBrandButton
  }
}
