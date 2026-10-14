import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Toggle } from './EditorUI.js';

export interface AdjustmentMl {
  /** Testid prefix: `${id}-ml` for the button (`-auto` for kind 'auto'). */
  id: string;
  /** True while the action's effect is on the photo: the button highlights. */
  applied: boolean;
  /** Run the action (each Repair action is a fresh run; nothing persists to revert). */
  onToggle: () => void;
  /** Header action kind: 'ml' when a model runs, 'auto' for heuristics (histogram autos, denoise suggestion). Defaults to 'ml'. */
  kind?: 'ml' | 'auto';
  /** Disable the header action (e.g. Denoise while working or with no ISO suggestion). */
  disabled?: boolean;
  /** Override the computed tooltip (e.g. Denoise names its ISO suggestion). */
  hint?: string;
}

export interface AdjustmentToggle {
  /** Testid: `${id}-toggle`. */
  id: string;
  /** On = the tool holds an effect (auto-applied or hand-tweaked); off = defaults. */
  checked: boolean;
  /**
   * Off-to-on applies the suggested change; on-to-off resets to defaults.
   * Sections with no suggestion (Curves, Details, Effects) disable the
   * switch while off instead — it lights on the first tweak and resets on
   * click, so the header never needs a second control.
   */
  onToggle: () => void;
  /** Disable the switch (e.g. Denoise while working or with no ISO suggestion). */
  disabled?: boolean;
  /** Tooltip; the switch itself is labeled with the section title. */
  hint: string;
}

export interface AdjustmentSectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  /** Small heading adornment after the title, e.g. an ML badge. */
  badge?: ReactNode;
  /** Per-section automatic action (ML or Auto heuristic); omit for sections with no automatic action. */
  ml?: AdjustmentMl;
  /** Header on/off switch (every Color Adjustments section); omit where the header keeps the ML/Auto button (Repair). */
  toggle?: AdjustmentToggle;
  /** Controlled visibility; omit for the self-managed disclosure default. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The single shared collapse/expand panel used across the app (adjust
 * categories, ML Enhance, and every Repair section). Keep collapse-only
 * markup differences to `is-collapsed` / `aria-expanded` / the chevron —
 * the heading must measure identically open and collapsed, or toggling
 * shifts the surrounding text (see collapsePanels.test.tsx). A Color
 * Adjustments header carries exactly one switch: on applies the suggested
 * change, off resets to defaults (manual tweaks light it on their own,
 * and suggestion-less sections disable it while off) — no section header
 * carries a reset button. Repair headers keep the ML/Auto button.
 */
export function AdjustmentSection({ title, icon, children, initiallyOpen = true, badge, ml, toggle, open: controlledOpen, onOpenChange }: AdjustmentSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initiallyOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const lower = title.toLowerCase();
  // The header action is an ML button for model actions and a small Auto
  // pill (the straighten style) for heuristics — same placement, same
  // toggle contract, honest label either way.
  const kind = ml?.kind ?? 'ml';
  const actionLabel = kind === 'auto' ? 'Auto' : 'ML';
  const actionClass = kind === 'auto' ? 'auto-small' : 'ml-button';
  // Repair actions are ephemeral one-shots (the strokes they leave live
  // in the Repairs section from there), so applied never highlights and
  // every click runs fresh — callers pass a hint naming what the run does.
  const actionHint = !ml ? '' : (ml.hint ?? (kind === 'auto'
    ? (ml.applied ? `${title} applied — click to re-apply` : `Apply ${lower} automatically`)
    : (ml.applied ? `ML ${lower} applied — click to re-apply` : `Automatically adjust ${lower} with ML`)));
  // The action button (or switch) is the header's one control — on/off
  // via .is-active + aria-pressed, styled in apps/web/src/index.css — and
  // stays rendered while collapsed: collapsing hides the sliders, never
  // the header controls.
  return <section className={`adjustment-section ${!open ? 'is-collapsed' : ''}`}><div className="adjustment-heading"><button className="section-disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="adjustment-section-icon">{icon}</span><h3>{title}</h3>{badge}</button><div className="section-actions">{ml && <button className={`${actionClass}${ml.applied ? ' is-active' : ''}`} data-testid={`${ml.id}-${kind}`} aria-pressed={ml.applied} data-tooltip={actionHint} disabled={ml.disabled} onClick={ml.onToggle}>{actionLabel}</button>}{toggle && <Toggle checked={toggle.checked} onChange={toggle.onToggle} label={title} testId={`${toggle.id}-toggle`} hint={toggle.hint} disabled={toggle.disabled} />}</div></div>{open && <div className="adjustment-content">{children}</div>}</section>;
}
