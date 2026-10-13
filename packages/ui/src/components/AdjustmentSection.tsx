import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { IconButton } from './EditorUI.js';

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
  /** Header action kind: 'ml' when a model runs, 'auto' for heuristics (histogram autos, denoise suggestion). Defaults to 'ml'. */
  kind?: 'ml' | 'auto';
  /** Disable the header action (e.g. Denoise while working or with no ISO suggestion). */
  disabled?: boolean;
  /** Override the computed tooltip (e.g. Denoise names its ISO suggestion). */
  hint?: string;
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
  /** Controlled visibility; omit for the self-managed disclosure default. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReset?: () => void;
  /** True when the section differs from its defaults: the reset icon renders. Otherwise no reset renders at all. */
  dirty?: boolean;
}

/**
 * The single shared collapse/expand panel used across the app (adjust
 * categories, ML Enhance, and every Repair section). Keep collapse-only
 * markup differences to `is-collapsed` / `aria-expanded` / the chevron —
 * the heading must measure identically open and collapsed, or toggling
 * shifts the surrounding text (see collapsePanels.test.tsx). The header
 * carries no toggle: on/off lives in the content (bypass switches,
 * effect buttons), the header carries at most the reset + the action.
 */
export function AdjustmentSection({ title, icon, children, initiallyOpen = true, badge, ml, open: controlledOpen, onOpenChange, onReset, dirty = false }: AdjustmentSectionProps) {
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
  // Applied without a snapshot is a draft state with no revert (Denoise's
  // ISO suggestion): clicking re-applies fresh instead of reverting, and
  // the tooltip must not promise a revert. Auto actions always carry their
  // persisted stack snapshot, so applied implies canRevert for them.
  const actionHint = !ml ? '' : (ml.hint ?? (kind === 'auto'
    ? (ml.applied ? (ml.canRevert ? `${title} applied — click to revert` : `${title} applied — click to re-apply`) : ml.canRevert ? `Re-apply ${lower}` : `Apply ${lower} automatically`)
    : (ml.applied ? (ml.canRevert ? `ML ${lower} applied — click to revert` : `ML ${lower} applied — click to re-apply`) : ml.canRevert ? `Re-apply automatic ${lower} with ML` : `Automatically adjust ${lower} with ML`)));
  // One reset control per header, left of the action button: while a
  // pre-apply snapshot exists it restores the pre-apply values, otherwise
  // it resets the sliders to defaults. The icon renders only while the
  // section is non-default (dirty values or a live snapshot) — a clean
  // section renders no reset at all, not even hover-only. The action
  // button stays rightmost (on/off via .is-active + aria-pressed, styled
  // in apps/web/src/index.css) and stays rendered while collapsed, like
  // the reset — collapsing hides the sliders, never the header controls.
  const resetActive = dirty || Boolean(ml?.canRevert);
  const onResetClick = ml && ml.canRevert ? ml.onRevert : onReset;
  return <section className={`adjustment-section ${!open ? 'is-collapsed' : ''}`}><div className="adjustment-heading"><button className="section-disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="adjustment-section-icon">{icon}</span><h3>{title}</h3>{badge}</button><div className="section-actions">{onReset && resetActive && <IconButton className="section-reset is-dirty" label={`Reset ${lower}`} onClick={onResetClick}><RotateCcw size={11} /></IconButton>}{ml && <button className={`${actionClass}${ml.applied ? ' is-active' : ''}`} data-testid={`${ml.id}-${kind}`} aria-pressed={ml.applied} data-tooltip={actionHint} disabled={ml.disabled} onClick={ml.onToggle}>{actionLabel}</button>}</div></div>{open && <div className="adjustment-content">{children}</div>}</section>;
}
