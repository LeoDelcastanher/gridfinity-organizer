import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';
import { useStore } from '../model/store';
import { fromUnit, round, toUnit } from './format';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  suffix?: string;
  prefix?: string;
  title?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Number box that commits on Enter/blur (so geometry is not rebuilt on every
 * keystroke), steps with the arrow keys and accepts a decimal comma.
 */
export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  digits = 2,
  suffix,
  prefix,
  title,
  className = '',
  disabled,
}: NumberInputProps) {
  const fmt = (v: number) => String(round(v, digits));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, digits]);

  const commitText = () => {
    const parsed = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setText(fmt(value));
      return;
    }
    const v = clamp(round(parsed, digits), min, max);
    setText(fmt(v));
    if (v !== value) onChange(v);
  };

  const bump = (dir: number, big: boolean) => {
    const v = clamp(round(value + dir * step * (big ? 10 : 1), digits), min, max);
    setText(fmt(v));
    if (v !== value) onChange(v);
  };

  return (
    <label className={`num ${disabled ? 'disabled' : ''} ${className}`} title={title}>
      {prefix && <span className="affix prefix">{prefix}</span>}
      <input
        inputMode="decimal"
        aria-label={title ?? prefix}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
          }
        }}
      />
      {suffix && <span className="affix suffix">{suffix}</span>}
    </label>
  );
}

/** Length in mm, shown and typed in the user's chosen unit. */
export function LengthInput(props: Omit<NumberInputProps, 'suffix' | 'digits'> & { showUnit?: boolean }) {
  const units = useStore((s) => s.prefs.units);
  const { value, onChange, min, max, step, showUnit = true, ...rest } = props;
  return (
    <NumberInput
      {...rest}
      value={toUnit(value, units)}
      onChange={(v) => onChange(round(fromUnit(v, units), 3))}
      min={min != null ? toUnit(min, units) : undefined}
      max={max != null ? toUnit(max, units) : undefined}
      step={units === 'in' ? 0.05 : (step ?? 1)}
      digits={units === 'in' ? 3 : 2}
      suffix={showUnit ? units : undefined}
    />
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  suffix,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  title?: string;
}) {
  return (
    <div className="stepper" title={title}>
      <button type="button" className="step" onClick={() => onChange(clamp(value - 1, min, max))} disabled={value <= min} aria-label="Decrease">
        <Minus size={13} />
      </button>
      <NumberInput value={value} onChange={(v) => onChange(clamp(Math.round(v), min, max))} min={min} max={max} digits={0} suffix={suffix} />
      <button type="button" className="step" onClick={() => onChange(clamp(value + 1, min, max))} disabled={value >= max} aria-label="Increase">
        <Plus size={13} />
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id} title={hint}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="row" title={hint}>
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  );
}

export function Section({
  title,
  icon,
  actions,
  children,
  defaultOpen = true,
  storageKey,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
}) {
  const key = storageKey ? `gridfinity-planner/section/${storageKey}` : null;
  const [open, setOpen] = useState(() => {
    if (!key) return defaultOpen;
    try {
      const v = localStorage.getItem(key);
      return v == null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      if (key) {
        try {
          localStorage.setItem(key, o ? '0' : '1');
        } catch {
          // ignore
        }
      }
      return !o;
    });
  };
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className="section-head">
        <button type="button" className="section-title" onClick={toggle} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          <span>{title}</span>
        </button>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

/** Text field that commits on Enter/blur. */
export function TextInput({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commitText = () => {
    const v = text.trim();
    if (v && v !== value) onChange(v);
    else setText(value);
  };
  return (
    <input
      className={`text ${className}`}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commitText();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function IconButton({
  onClick,
  title,
  children,
  disabled,
  active,
  className = '',
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button type="button" className={`icon-btn ${active ? 'active' : ''} ${className}`} onClick={onClick} title={title} aria-label={title} disabled={disabled}>
      {children}
    </button>
  );
}
