import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs><linearGradient id="brand-base" x1="4" y1="0" x2="30" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#ffd45f" /><stop offset=".48" stopColor="#ef785c" /><stop offset="1" stopColor="#7b57d7" /></linearGradient></defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#brand-base)" />
      <g transform="translate(16 16)">
        {Array.from({ length: 7 }, (_, i) => <path key={i} d="M0 0C-5-2-6-9-2-11C2-13 7-7 0 0Z" transform={`rotate(${i * 360 / 7})`} fill="white" fillOpacity=".72" />)}
      </g>
    </svg>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  /** Stable e2e selector; passed through to the button. */
  'data-testid'?: string;
  children: ReactNode;
}

export function IconButton({ label, active, className = '', children, ...props }: IconButtonProps) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props}>{children}</button>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className={`toggle ${checked ? 'is-on' : ''}`} onClick={onChange}><span /></button>;
}

interface RangeControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  suffix?: string;
  signed?: boolean;
  color?: 'temperature' | 'tint' | 'hue';
  disabled?: boolean;
  /** Stable selector for e2e; no visual or behavior change. */
  testId?: string;
  onChange: (value: number) => void;
}

export function RangeControl({ label, value, min = -100, max = 100, step = 1, defaultValue = 0, suffix = '', signed = false, color, disabled, testId, onChange }: RangeControlProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const digits = step < 1 ? 2 : 0;
  const displayed = String(Number(value.toFixed(digits)));
  const progress = (value - min) / (max - min) * 100;
  const center = (defaultValue - min) / (max - min) * 100;
  const style = { '--range-progress': `${progress}%`, '--range-center': `${center}%` } as CSSProperties;
  return (
    <div className={`range-control ${disabled ? 'is-disabled' : ''}`} {...(testId ? { 'data-testid': testId } : {})}>
      <div className="range-label">
        <label htmlFor={id}>{label}</label>
        <div className="range-value">
          {signed && value > 0 && draft === null && <span>+</span>}
          <input
            aria-label={`${label} value`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? displayed}
            disabled={disabled}
            style={{ width: `${Math.max(2, (draft ?? displayed).length) + 0.3}ch` }}
            onFocus={(event) => { setDraft(displayed); event.currentTarget.select(); }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
              const text = event.target.value;
              if (text.trim() && Number.isFinite(Number(text))) {
                const next = Math.max(min, Math.min(max, Number(text)));
                if (next !== value) onChange(next);
              }
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === 'Escape') { event.currentTarget.value = displayed; event.currentTarget.blur(); }
            }}
          />
          {suffix && <span>{suffix}</span>}
        </div>
      </div>
      <div className={`range-track ${color ? `range-${color}` : ''}`} style={style}>
        {!color && <span className="range-origin" />}
        <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} title={`Double-click to reset ${label.toLowerCase()}`} onDoubleClick={() => onChange(defaultValue)} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </div>
  );
}

export function MenuItem({ children, shortcut, onClick, disabled, checked, danger }: { children: ReactNode; shortcut?: string; onClick: () => void; disabled?: boolean; checked?: boolean; danger?: boolean }) {
  return <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} className={`menu-item ${danger ? 'is-danger' : ''}`} disabled={disabled} onClick={onClick}>{checked !== undefined && <span className="menu-check">{checked && <Check size={13} />}</span>}<span>{children}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const id = useId();
  return <label className="select-field" htmlFor={id}><span>{label}</span><span className="select-wrap"><select id={id} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></span></label>;
}

export function Modal({ title, subtitle, children, onClose, className = '' }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const firstInput = dialog?.querySelector<HTMLElement>('input:not([type="range"]), select') || dialog?.querySelector<HTMLElement>('button');
    firstInput?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, a[href], [tabindex="0"]'));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></div>{children}</div></div>;
}