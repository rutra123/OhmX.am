/**
 * Configurator design system: tokens, shared chrome and primitives for the
 * Building Project wizard. Presentation only — every control receives the
 * wizard's existing handlers.
 *
 * Semantic colour roles (all theme-aware, built on the site tokens):
 *   --bp-accent   primary action, current step, generic selected state (brand)
 *   --bp-heat / --bp-cool   service context (heating / cooling equipment)
 *   --bp-ok       completed / successful status (never used for selection)
 *   --bp-info     recommendations
 *   --bp-warn     warnings only
 *   --bp-danger   blockers / errors only
 */
import type { ReactNode } from 'react';
import { ServiceGlyph } from '../equipmentSelection/EquipmentSelection';

/** All configurator-chrome strings in one place (the wizard is Russian-only today). */
export const CFG_TEXT = {
  steps: 'Шаги',
  stepOf: (n: number, total: number) => `Шаг ${n} из ${total}`,
  stepDone: 'выполнено',
  stepLocked: 'станет доступно позже',
  designing: 'Проектируем',
  chooseOnSystems: 'выберите на шаге «Системы»',
  change: 'Изменить',
  showOtherOptions: (n: number) => `Показать другие варианты (${n})`,
  hideOtherOptions: 'Скрыть другие варианты',
  engineeringDetails: 'Инженерная сводка',
  engineeringDetailsMeta: 'архитектура, гидравлика, предварительная спецификация',
  readiness: 'Проверка готовности',
  blockers: 'Нужно исправить',
  warnings: 'Требует внимания',
  rooms: (n: number) => `${n} пом.`,
  recommendedScheme: 'Рекомендуемая схема',
  recommendedSchemeHint: 'Шаблон по типу помещений, не расчёт мощности.',
  recommendedByRoom: (n: number) => `Что предлагается по помещениям (${n})`,
  nextToReview: 'Далее: проверка проекта',
} as const;

export const CONFIGURATOR_CSS = `
.bp-wrap {
  container: cfg / inline-size;
  --bp-surface-0: var(--bg); --bp-surface-1: var(--card); --bp-surface-2: var(--card-contrast);
  --bp-line: var(--line); --bp-line-strong: 71 85 105;
  --bp-text: var(--fg); --bp-text-soft: var(--fg-soft); --bp-text-muted: var(--fg-muted);
  --bp-accent: var(--primary); --bp-on-accent: 5 10 20;
  --bp-heat: 255 128 82; --bp-cool: 56 198 226;
  --bp-ok: var(--ok); --bp-warn: var(--warn); --bp-danger: 248 113 113; --bp-info: 125 211 252;
  --bp-r-sm: 8px; --bp-r-md: 12px; --bp-r-lg: 16px;
  --bp-s1: 4px; --bp-s2: 8px; --bp-s3: 12px; --bp-s4: 16px; --bp-s5: 24px; --bp-s6: 32px;
  --bp-fs-xs: 13px; --bp-fs-sm: 14px; --bp-fs-body: 16px; --bp-fs-h: 18px; --bp-fs-title: 20px;
  --bp-tap: 44px;
  --bp-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--fg));
  font-size: var(--bp-fs-body); line-height: 1.5; color: rgb(var(--bp-text));
}
:root[data-theme='light'] .bp-wrap {
  --bp-line-strong: 148 163 184; --bp-on-accent: 255 255 255;
  --bp-heat: 200 66 24; --bp-cool: 8 112 140; --bp-danger: 220 38 38; --bp-info: 3 105 161;
}

.bp-wrap details > summary { min-height: var(--bp-tap); display: flex; align-items: center; gap: 6px; cursor: pointer; }
/* ---- step navigation ---- */
.cfg-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--cfg-step-count, 5), minmax(0, 1fr)); position: relative; }
.cfg-steps::before { content: ''; position: absolute; left: 10%; right: 10%; top: 21px; height: 2px; background: rgb(var(--bp-line)); }
.cfg-step { position: relative; display: grid; justify-items: center; }
.cfg-step-btn { display: grid; justify-items: center; gap: 4px; min-width: var(--bp-tap); min-height: var(--bp-tap); padding: 0 2px; border: 0; background: transparent; color: rgb(var(--bp-text-muted)); font: inherit; cursor: pointer; }
.cfg-step-btn:disabled { cursor: default; }
.cfg-step-dot { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgb(var(--bp-line-strong)); background: rgb(var(--bp-surface-0)); font-weight: 750; font-size: 16px; color: rgb(var(--bp-text-soft)); }
.cfg-step-label { font-size: var(--bp-fs-xs); font-weight: 600; line-height: 1.2; text-align: center; }
.cfg-step.is-done .cfg-step-dot { border-color: rgb(var(--bp-ok)); color: rgb(var(--bp-ok)); }
.cfg-step.is-current .cfg-step-dot { border-color: rgb(var(--bp-accent)); background: rgb(var(--bp-accent)); color: rgb(var(--bp-on-accent)); }
.cfg-step.is-current .cfg-step-label { color: rgb(var(--bp-text)); }
.cfg-step.is-locked .cfg-step-dot { border-style: dashed; opacity: .55; }
.cfg-step-btn:focus-visible { outline: none; }
.cfg-step-btn:focus-visible .cfg-step-dot { box-shadow: var(--bp-focus); }
.cfg-steps-caption { display: none; margin-top: var(--bp-s2); font-size: var(--bp-fs-sm); color: rgb(var(--bp-text-muted)); text-align: center; }
.cfg-steps-caption strong { color: rgb(var(--bp-text)); }
@container cfg (max-width: 519px) {
  .cfg-step-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .cfg-steps-caption { display: block; }
}

/* ---- project bar ---- */
.cfg-projbar-label { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; flex: 1 1 0; min-width: 0; font-weight: 700; }
@container cfg (max-width: 419px) { .cfg-projbar-prefix { display: none; } }
.bp-kv.cfg-facts { grid-template-columns: minmax(7.5em, .9fr) minmax(0, 1.5fr); }
.bp-kv.cfg-facts dd { text-align: left; white-space: normal; overflow-wrap: break-word; }
@container cfg (max-width: 479px) {
  .bp-kv.cfg-facts { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .bp-kv.cfg-facts dt { color: rgb(var(--bp-text-muted)); font-size: var(--bp-fs-sm); }
  .bp-kv.cfg-facts dd { margin-bottom: 8px; }
}
.cfg-projbar-value { min-width: 0; }
.bp-input { font-weight: 400; }
.cfg-projbar-label .eq-service-glyph { flex: 0 0 auto; }
.cfg-projbar-prefix { color: rgb(var(--bp-text-muted)); font-weight: 500; font-size: var(--bp-fs-sm); }
.cfg-linkbtn { min-height: var(--bp-tap); padding: 0 var(--bp-s3); border-radius: var(--bp-r-sm); border: 1px solid rgb(var(--bp-line-strong)); background: transparent; color: rgb(var(--bp-text)); font: inherit; font-size: var(--bp-fs-sm); font-weight: 650; cursor: pointer; }
.cfg-linkbtn:focus-visible { outline: none; box-shadow: var(--bp-focus); }

/* ---- sections, disclosure, notices ---- */
.cfg-section-title { margin: 0; font-size: var(--bp-fs-h); font-weight: 750; line-height: 1.3; }
.cfg-section-hint { margin: 0; font-size: var(--bp-fs-sm); color: rgb(var(--bp-text-muted)); }
.cfg-disclosure { border: 1px solid rgb(var(--bp-line)); border-radius: var(--bp-r-lg); background: rgb(var(--bp-surface-1)); }
.cfg-disclosure > summary { display: flex; align-items: center; gap: var(--bp-s3); min-height: 56px; padding: var(--bp-s2) var(--bp-s4); cursor: pointer; list-style: none; border-radius: var(--bp-r-lg); }
.cfg-disclosure > summary::-webkit-details-marker { display: none; }
.cfg-disclosure > summary:focus-visible { outline: none; box-shadow: var(--bp-focus); }
.cfg-disclosure-text { display: grid; gap: 2px; flex: 1 1 auto; min-width: 0; }
.cfg-disclosure-title { font-weight: 700; font-size: var(--bp-fs-body); }
.cfg-disclosure-meta { font-size: var(--bp-fs-sm); color: rgb(var(--bp-text-muted)); }
.cfg-chevron { flex: 0 0 auto; transition: transform .15s ease; }
.cfg-disclosure[open] > summary .cfg-chevron { transform: rotate(180deg); }
.cfg-disclosure-body { display: grid; gap: var(--bp-s3); padding: 0 var(--bp-s4) var(--bp-s4); }
.cfg-disclosure-body > .bp-card { border: 0; padding: 0; background: transparent; }
.cfg-notice { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: var(--bp-s2) var(--bp-s3); align-items: start; padding: var(--bp-s3) var(--bp-s4); border-radius: var(--bp-r-md); border: 1px solid rgb(var(--cfg-tone) / .45); background: rgb(var(--cfg-tone) / .08); font-size: var(--bp-fs-sm); }
.cfg-notice-icon { color: rgb(var(--cfg-tone)); margin-top: 1px; }
.cfg-notice-title { font-weight: 700; color: rgb(var(--bp-text)); }
.cfg-notice ul { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 4px; }
.cfg-notice[data-tone='warn'] { --cfg-tone: var(--bp-warn); }
.cfg-notice[data-tone='danger'] { --cfg-tone: var(--bp-danger); }
.cfg-notice[data-tone='info'] { --cfg-tone: var(--bp-info); }
.cfg-notice[data-tone='ok'] { --cfg-tone: var(--bp-ok); }

/* ---- segmented choice ---- */
.cfg-seg { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: var(--bp-s2); }
.cfg-seg-btn { display: flex; align-items: center; justify-content: flex-start; gap: var(--bp-s3); min-height: 52px; padding: var(--bp-s2) 40px var(--bp-s2) var(--bp-s4); border-radius: var(--bp-r-md); border: 1px solid rgb(var(--bp-line-strong)); background: rgb(var(--bp-surface-1)); color: rgb(var(--bp-text)); font: inherit; font-weight: 650; text-align: left; cursor: pointer; min-width: 0; }
.cfg-seg-btn > span:last-child { min-width: 0; overflow-wrap: break-word; }
.cfg-seg-btn[aria-pressed='true'] { border-color: rgb(var(--bp-accent)); box-shadow: inset 0 0 0 1px rgb(var(--bp-accent)); background: linear-gradient(rgb(var(--bp-accent) / .1), rgb(var(--bp-accent) / .1)), rgb(var(--bp-surface-1)); }
.cfg-seg-btn { position: relative; }
.cfg-seg-btn[aria-pressed='true']::after { content: ''; position: absolute; top: 50%; right: 12px; margin-top: -10px; width: 20px; height: 20px; border-radius: 50%; background: rgb(var(--bp-accent)) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3.5 8.5 3 3 6-7' fill='none' stroke='%23050a14' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 12px no-repeat; }
:root[data-theme='light'] .cfg-seg-btn[aria-pressed='true']::after { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3.5 8.5 3 3 6-7' fill='none' stroke='%23ffffff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
.cfg-seg-objects { grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); }
.cfg-seg-objects .cfg-seg-btn { flex-direction: column; justify-content: center; text-align: center; min-height: 104px; gap: 8px; padding: var(--bp-s3); }
.cfg-seg-objects .cfg-seg-btn[aria-pressed='true']::after { top: 10px; margin-top: 0; right: 10px; }
.cfg-seg-objects .cfg-seg-btn .eq-glyph { color: rgb(var(--bp-text-soft)); }
.cfg-seg-objects .cfg-seg-btn[aria-pressed='true'] .eq-glyph { color: rgb(var(--bp-accent)); }
.cfg-workspace-head { display: grid; gap: 4px; margin-bottom: var(--bp-s3); }
.cfg-seg-btn:focus-visible { outline: none; box-shadow: var(--bp-focus); }
.cfg-seg-btn .eq-glyph, .cfg-seg-btn .eq-service-glyph { flex: 0 0 auto; }

/* ---- next action ---- */
.cfg-next { display: grid; gap: var(--bp-s2); padding-top: var(--bp-s2); }
.cfg-next .bp-btn { min-height: 52px; font-size: var(--bp-fs-body); }

/* ---- room summary rows (review) ---- */
.cfg-room-rows { display: grid; gap: 0; }
.cfg-room-row { display: grid; gap: var(--bp-s2); padding: var(--bp-s3) 0; border-top: 1px solid rgb(var(--bp-line)); }
.cfg-room-row:first-child { border-top: 0; }
.cfg-room-head { display: flex; align-items: center; gap: var(--bp-s2); font-weight: 650; }
.cfg-room-head .eq-glyph { color: rgb(var(--bp-text-soft)); }
.cfg-room-area { margin-left: auto; color: rgb(var(--bp-text-muted)); font-size: var(--bp-fs-sm); font-variant-numeric: tabular-nums; }
.cfg-floor-title { margin: var(--bp-s3) 0 0; font-size: var(--bp-fs-sm); font-weight: 700; color: rgb(var(--bp-text-muted)); }
`;

export type StepItem = { id: string; label: string; enabled: boolean; done: boolean };

export function StepNav({ steps, current, onSelect }: { steps: StepItem[]; current: string; onSelect: (id: string) => void }) {
  const index = steps.findIndex((s) => s.id === current);
  const currentStep = steps[index];
  return (
    <>
      <ol className="cfg-steps" style={{ ['--cfg-step-count' as string]: steps.length }}>
        {steps.map((step, i) => {
          const isCurrent = step.id === current;
          const state = isCurrent ? 'is-current' : step.done ? 'is-done' : step.enabled ? '' : 'is-locked';
          const extra = isCurrent ? '' : step.done ? `, ${CFG_TEXT.stepDone}` : step.enabled ? '' : `, ${CFG_TEXT.stepLocked}`;
          return (
            <li key={step.id} className={`cfg-step ${state}`}>
              <button
                type="button"
                className="cfg-step-btn"
                disabled={!step.enabled}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${i + 1}. ${step.label}${extra}`}
                onClick={() => onSelect(step.id)}
              >
                <span className="cfg-step-dot" aria-hidden="true">
                  {step.done && !isCurrent
                    ? <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m3.5 8.5 3 3 6-7" /></svg>
                    : i + 1}
                </span>
                <span className="cfg-step-label" aria-hidden="true">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {currentStep && (
        <div className="cfg-steps-caption" aria-hidden="true">
          {CFG_TEXT.stepOf(index + 1, steps.length)} · <strong>{currentStep.label}</strong>
        </div>
      )}
    </>
  );
}

export function ProjectServicesLabel({ services, label }: { services: Array<'heating' | 'cooling'>; label: string | null }) {
  return (
    <span className="cfg-projbar-label">
      <span className="cfg-projbar-prefix">{CFG_TEXT.designing}:</span>
      {label
        ? (
          <span className="cfg-projbar-value">
            {services.map((s) => <span key={s} className="bp-svc" data-service={s}><ServiceGlyph service={s} size={18} /></span>)}
            {label}
          </span>
        )
        : <span>{CFG_TEXT.chooseOnSystems}</span>}
    </span>
  );
}

export function Chevron() {
  return (
    <svg className="cfg-chevron" viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
  );
}

/** Accessible expandable section (native details/summary). */
export function Disclosure({ title, meta, defaultOpen, children, className }: { title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; children: ReactNode; className?: string }) {
  return (
    <details className={`cfg-disclosure${className ? ` ${className}` : ''}`} open={defaultOpen}>
      <summary>
        <span className="cfg-disclosure-text">
          <span className="cfg-disclosure-title">{title}</span>
          {meta && <span className="cfg-disclosure-meta">{meta}</span>}
        </span>
        <Chevron />
      </summary>
      <div className="cfg-disclosure-body">{children}</div>
    </details>
  );
}

const NOTICE_PATH: Record<'warn' | 'danger' | 'info' | 'ok', string> = {
  warn: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.2v.1',
  danger: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v6M12 16.5v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8v.1',
  ok: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.8 2.8L16.5 9.5',
};

export function Notice({ tone, title, children }: { tone: 'warn' | 'danger' | 'info' | 'ok'; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cfg-notice" data-tone={tone}>
      <svg className="cfg-notice-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={NOTICE_PATH[tone]} /></svg>
      <div>
        {title && <div className="cfg-notice-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Exclusive choice rendered as pressed buttons (same handlers as the old chips). */
export function SegmentedChoice<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="cfg-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="cfg-seg-btn" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
