import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Undo2 } from 'lucide-react';
import { IconButton, Toggle } from './EditorUI.js';

export interface AdjustmentMl {
  /** Testid prefix: `${id}-ml` for the button, `${id}-ml-revert` for the revert icon. */
  id: string;
  /** True while the recipe holds exactly the auto values: the button highlights. Manual edits clear it. */
  applied: boolean;
  /** True while a pre-ML snapshot exists: the revert icon shows, even after manual edits cleared the highlight. */
  canRevert: boolean;
  /** Revert when highlighted, otherwise apply fresh auto values (keeping the earliest snapshot). */
  onToggle: () => void;
  /** Always restore the pre-ML snapshot. */
  onRevert: () => void;
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
  /** Per-category ML action; omit for sections with no automatic action. */
  ml?: AdjustmentMl;
  /** Controlled visibility; omit for the self-managed disclosure default. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReset?: () => void;
}

/**
 * The single shared collapse/expand panel used across the app (adjust
 * categories, ML Enhance, and every Repair section). Keep collapse-only
 * markup differences to `is-collapsed` / `aria-expanded` / the chevron —
 * the heading must measure identically open and collapsed, or toggling
 * shifts the surrounding text (see collapsePanels.test.tsx).
 */
export function AdjustmentSection({ title, icon, children, initiallyOpen = true, enabled, badge, onToggle, toggleLabel, ml, open: controlledOpen, onOpenChange, onReset }: AdjustmentSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initiallyOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const lower = title.toLowerCase();
  const mlTitle = !ml ? '' : ml.applied ? `ML ${lower} applied — click to revert` : ml.canRevert ? `Re-apply automatic ${lower} with ML` : `Automatically adjust ${lower} with ML`;
  return <section className={`adjustment-section ${!open ? 'is-collapsed' : ''}`}><div className="adjustment-heading"><button className="section-disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="adjustment-section-icon">{icon}</span><h3>{title}</h3>{badge}</button><div className="section-actions">{ml && open && <button className={`ml-button${ml.applied ? ' is-active' : ''}`} data-testid={`${ml.id}-ml`} aria-pressed={ml.applied} title={mlTitle} onClick={ml.onToggle}>ML</button>}{ml && ml.canRevert && open && <IconButton className="ml-revert" data-testid={`${ml.id}-ml-revert`} label={`Revert ML ${lower}`} onClick={ml.onRevert}><Undo2 size={11} /></IconButton>}{onReset && <IconButton className="section-reset" label={`Reset ${lower}`} onClick={onReset}><RotateCcw size={11} /></IconButton>}{onToggle && <Toggle checked={Boolean(enabled)} onChange={onToggle} label={toggleLabel ?? `Show ${lower}`} />}</div></div>{open && <div className="adjustment-content">{children}</div>}</section>;
}
