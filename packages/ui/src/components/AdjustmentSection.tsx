import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { IconButton, Toggle } from './EditorUI.js';

export interface AdjustmentMl {
  /** Testid prefix: `${id}-ml` for the button (`-auto` for kind 'auto'). */
  id: string;
  /** True while the recipe holds exactly the auto values: the button highlights. Manual edits clear it. */
  applied: boolean;
  /** True while a pre-apply snapshot exists: the reset icon restores it, even after manual edits cleared the highlight. */
  canRevert: boolean;
  /** Revert when highlighted, otherwise apply fresh auto values (keeping the earliest snapshot). */
  onToggle: () => void;
  /** Always restore the pre-apply snapshot. */
  onRevert: () => void;
  /** Header action kind: 'ml' for model actions, 'auto' for heuristics (classic enhance). Defaults to 'ml'. */
  kind?: 'ml' | 'auto';
}

export interface AdjustmentSectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  enabled?: boolean;
  /** Small heading adornment after the title, e.g. an ML badge. */
  badge?: ReactNode;
  onToggle?: () => void;
  /** Accessibility label for the header toggle; defaults to "Show {title}". */
  toggleLabel?: string;
  /** Per-section automatic action (ML or Auto heuristic); omit for sections with no automatic action. */
  ml?: AdjustmentMl;
  /** Controlled visibility; omit for the self-managed disclosure default. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReset?: () => void;
  /** True when the section differs from its defaults: the reset icon stays visible. Otherwise it is hover-only. */
  dirty?: boolean;
}

/**
 * The single shared collapse/expand panel used across the app (adjust
 * categories, ML Enhance, and every Repair section). Keep collapse-only
 * markup differences to `is-collapsed` / `aria-expanded` / the chevron —
 * the heading must measure identically open and collapsed, or toggling
 * shifts the surrounding text (see collapsePanels.test.tsx).
 */
export function AdjustmentSection({ title, icon, children, initiallyOpen = true, enabled, badge, onToggle, toggleLabel, ml, open: controlledOpen, onOpenChange, onReset, dirty = false }: AdjustmentSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initiallyOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const lower = title.toLowerCase();
  // The header action is an ML button for model actions and a small Auto
  // pill (the straighten/denoise style) for heuristics — same placement,
  // same toggle contract, honest label either way.
  const kind = ml?.kind ?? 'ml';
  const actionLabel = kind === 'auto' ? 'Auto' : 'ML';
  const actionClass = kind === 'auto' ? 'auto-small' : 'ml-button';
  const actionTitle = !ml ? '' : kind === 'auto'
    ? (ml.applied ? `${title} applied — click to revert` : ml.canRevert ? `Re-apply ${lower}` : `Apply ${lower} automatically`)
    : (ml.applied ? `ML ${lower} applied — click to revert` : ml.canRevert ? `Re-apply automatic ${lower} with ML` : `Automatically adjust ${lower} with ML`);
  // One reset control per header, left of the action button: while a
  // pre-apply snapshot exists it restores the pre-apply values, otherwise
  // it resets the sliders to defaults. The icon stays visible while the
  // section is non-default (dirty values or a live snapshot) and is
  // hover-only at defaults. The action button stays rightmost (on/off via
  // .is-active + aria-pressed, styled in apps/web/src/index.css).
  const resetActive = dirty || Boolean(ml?.canRevert);
  const onResetClick = ml && ml.canRevert ? ml.onRevert : onReset;
  return <section className={`adjustment-section ${!open ? 'is-collapsed' : ''}`}><div className="adjustment-heading"><button className="section-disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="adjustment-section-icon">{icon}</span><h3>{title}</h3>{badge}</button><div className="section-actions">{onReset && <IconButton className={`section-reset${resetActive ? ' is-dirty' : ''}`} label={`Reset ${lower}`} onClick={onResetClick}><RotateCcw size={11} /></IconButton>}{ml && open && <button className={`${actionClass}${ml.applied ? ' is-active' : ''}`} data-testid={`${ml.id}-${kind}`} aria-pressed={ml.applied} title={actionTitle} onClick={ml.onToggle}>{actionLabel}</button>}{onToggle && <Toggle checked={Boolean(enabled)} onChange={onToggle} label={toggleLabel ?? `Show ${lower}`} />}</div></div>{open && <div className="adjustment-content">{children}</div>}</section>;
}
