'use client';

/**
 * Shared dense-UI primitives for the Compass Studio editor chrome.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Deliberately tiny and unstyled-by-default: every editor panel is a dense
 * table of labels and controls, so the primitives here only encode the shared
 * typography (mini-caps headers, 10px labels) and the single amber accent.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

// —— typography ————————————————————————————————————————————————
export function SectionHeader({
  children,
  right,
  className,
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1.5 ${className ?? ''}`}
    >
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{children}</span>
      {right ? <span className="flex items-center gap-1">{right}</span> : null}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-gray-500">{children}</span>;
}

/** Read-only label/value line. */
export function InfoRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <FieldLabel>{label}</FieldLabel>
      <span
        className={`truncate text-xs text-gray-300 ${mono ? 'font-mono tabular-nums' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// —— buttons ——————————————————————————————————————————————————
const BUTTON_BASE =
  'inline-flex select-none items-center justify-center gap-1 rounded-sm border px-2 text-xs ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-40';

export function Button({
  children,
  onClick,
  title,
  disabled,
  active,
  danger,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const tone = danger
    ? 'border-red-900/70 bg-red-950/40 text-red-300 hover:bg-red-900/40'
    : active
      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
      : 'border-editor-border bg-editor-raised text-gray-300 hover:border-gray-600 hover:text-gray-100';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`${BUTTON_BASE} h-7 ${tone} ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

/** Extra-compact button used inside panel headers and list rows. */
export function MiniButton(props: Parameters<typeof Button>[0]) {
  const { className, ...rest } = props;
  return <Button {...rest} className={`h-6 px-1.5 text-[11px] ${className ?? ''}`} />;
}

// —— segmented control ————————————————————————————————————————
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex h-7 shrink-0 overflow-hidden rounded-sm border border-editor-border bg-editor-raised ${className ?? ''}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`px-2 text-xs transition-colors ${
              selected
                ? 'bg-amber-500/15 text-amber-300'
                : 'text-gray-400 hover:bg-editor-border/60 hover:text-gray-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// —— text & select fields ——————————————————————————————————————
const INPUT_CLASS =
  'h-7 w-full rounded-sm border border-editor-border bg-editor-bg px-1.5 text-xs text-editor-text ' +
  'outline-none placeholder:text-gray-600 focus:border-amber-500/70';

/** Text input with draft-on-focus semantics: commit on Enter/blur, Esc reverts. */
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  disabled,
  className,
}: {
  label?: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  function commit() {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next === '' || next === value) return;
    onCommit(next);
  }

  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <input
        type="text"
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className={INPUT_CLASS}
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  title,
}: {
  label?: string;
  value: T | '';
  options: { value: T | ''; label: string }[];
  onChange: (next: T | '') => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ''}`} title={title}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value as T | '')}
        className={`${INPUT_CLASS} cursor-pointer pr-1`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-1.5 py-1 ${className ?? ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-3 w-3 accent-amber-500"
      />
      <FieldLabel>{label}</FieldLabel>
    </label>
  );
}

/** Click-to-edit label used for the project and building names. */
export function InlineEditableText({
  value,
  onCommit,
  className,
  inputClassName,
  title,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  inputClassName?: string;
  title?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next === '' || next === value) return;
    onCommit(next);
  }

  if (!editing) {
    return (
      <button
        type="button"
        title={title ?? 'Click to rename'}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={`truncate rounded-sm px-1 text-left hover:bg-editor-raised ${className ?? ''}`}
      >
        {value || (placeholder ?? '—')}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
          setDraft(value);
        }
      }}
      className={`${INPUT_CLASS} ${inputClassName ?? ''}`}
    />
  );
}

// —— indicators ————————————————————————————————————————————————
export function ColorDot({
  color,
  title,
  className,
}: {
  color: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 shrink-0 rounded-sm ring-1 ring-black/40 ${className ?? ''}`}
      style={{ backgroundColor: color }}
    />
  );
}

const STATUS_TONE: Record<string, string> = {
  leased: 'border-emerald-800/70 bg-emerald-900/30 text-emerald-300',
  proposed: 'border-sky-800/70 bg-sky-900/30 text-sky-300',
  expiring: 'border-amber-800/70 bg-amber-900/30 text-amber-300',
  vacant: 'border-gray-700 bg-gray-800/60 text-gray-400',
};

export function StatusChip({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE['vacant'];
  return (
    <span
      className={`shrink-0 rounded-sm border px-1 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-2.5 shrink-0 text-center text-[9px] leading-none text-gray-500 transition-transform ${
        open ? 'rotate-90' : ''
      }`}
    >
      ▶
    </span>
  );
}

export function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <path d="M1.5 8S4 3.75 8 3.75 14.5 8 14.5 8 12 12.25 8 12.25 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
      {off ? <path d="M2.5 13.5 13.5 2.5" /> : null}
    </svg>
  );
}

// —— text helpers ————————————————————————————————————————————
/** `tenant-suite` → `Tenant Suite`; used for every enum rendered in the UI. */
export function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Last 6 characters of an id — enough to disambiguate in a dense header. */
export function shortId(id: string): string {
  return id.length <= 6 ? id : id.slice(-6);
}
