import type { BuildingLoadCalculation, BuildingRoom } from '../types';
import {
  buildEngineeringQualityPresentation,
  engineeringQualityMessageLabel,
  qualityLevelPresentation,
  shouldShowEngineeringQuality,
  type EngineeringQualityTone,
} from '../utils/engineeringQualityPresentation';

function toneClasses(tone: EngineeringQualityTone): string {
  if (tone === 'success') return 'border border-ok/30 bg-ok/5';
  if (tone === 'warning') return 'border border-warn/30 bg-warn/5';
  return 'border border-line bg-surface';
}

function toneTextClass(tone: EngineeringQualityTone): string | undefined {
  if (tone === 'success') return 'text-ok';
  if (tone === 'warning') return 'text-warn';
  return undefined;
}

function blockerGroupCountLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} групп исходных данных`;
  if (mod10 === 1) return `${count} группу исходных данных`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} группы исходных данных`;
  return `${count} групп исходных данных`;
}

function LegacyQualityNotice() {
  return (
    <div className="bp-card" style={{ marginTop: 8, minWidth: 0 }}>
      <strong>Качество исходных данных</strong>
      <div className="bp-muted" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>
        Качество исходных данных для этого старого расчёта не оценивалось.
      </div>
    </div>
  );
}

export function EngineeringQualityPanel({
  loads,
  rooms,
}: {
  loads: BuildingLoadCalculation;
  rooms: ReadonlyArray<Pick<BuildingRoom, 'id' | 'name'>>;
}) {
  if (!shouldShowEngineeringQuality(loads.mode)) return null;

  const quality = loads.engineeringQuality;
  if (!quality) return <LegacyQualityNotice />;
  if (quality.gateStatus === 'LEGACY_UNASSESSED') return <LegacyQualityNotice />;

  const presentation = buildEngineeringQualityPresentation(quality, rooms);
  const gateTextClass = toneTextClass(presentation.gate.tone);
  const requestedLabel = qualityLevelPresentation(quality.requestedLevel).label;

  return (
    <div className="bp-card" style={{ marginTop: 8, minWidth: 0 }}>
      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <strong>Качество исходных данных</strong>

        <div className={toneClasses(presentation.gate.tone)} style={{ borderRadius: 12, padding: 10, minWidth: 0 }}>
          <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
            <strong className={gateTextClass} style={{ overflowWrap: 'anywhere' }}>
              {presentation.achieved.label}
            </strong>
            <span className="bp-muted" style={{ fontSize: 14 }}>{presentation.achieved.ordinal}</span>
            <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              Требуется для профессионального расчёта: {presentation.requested.level} — {requestedLabel}
            </span>
            <strong className={gateTextClass} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              {presentation.gate.label}
            </strong>
            {quality.gateStatus === 'BLOCKED' && (
              <span className="bp-muted" style={{ fontSize: 14, overflowWrap: 'anywhere' }}>
                Численный результат сохранён: ограничение относится к качеству исходных данных, а не к работе расчётного метода.
              </span>
            )}
          </div>
        </div>

        {presentation.blockerGroupCount > 0 && (
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              Нужно уточнить {blockerGroupCountLabel(presentation.blockerGroupCount)}.
            </div>
            <details style={{ minWidth: 0 }}>
              <summary style={{ cursor: 'pointer', minHeight: 40, display: 'flex', alignItems: 'center' }}>
                Что нужно уточнить
              </summary>
              <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                {presentation.blockerGroups.map((group) => (
                  <div key={group.key} className="border border-line bg-surface" style={{ borderRadius: 10, padding: 9, minWidth: 0 }}>
                    {group.roomLabel && <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{group.roomLabel}</div>}
                    <div style={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>{group.groupLabel}</div>
                    <ul style={{ margin: '5px 0 0', paddingLeft: 18, fontSize: 14 }}>
                      {group.items.map((item) => (
                        <li key={item.technicalFieldId} style={{ overflowWrap: 'anywhere' }}>
                          {item.parameterLabel} — <span className="bp-muted">{item.reasonLabel}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {presentation.coverage.warning && (
          <div className="border border-warn/30 bg-warn/5" style={{ borderRadius: 10, padding: 9, minWidth: 0 }}>
            <strong className="text-warn" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              {presentation.coverage.warning}
            </strong>
            {presentation.coverage.metrics.map((metric) => (
              <div key={metric} className="bp-muted" style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{metric}</div>
            ))}
          </div>
        )}

        {quality.warnings.length > 0 && (
          <details style={{ minWidth: 0 }}>
            <summary style={{ cursor: 'pointer', minHeight: 40, display: 'flex', alignItems: 'center' }}>
              Замечания к качеству данных
            </summary>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {quality.warnings.map((warning) => (
                <li key={warning} style={{ overflowWrap: 'anywhere' }}>{engineeringQualityMessageLabel(warning)}</li>
              ))}
            </ul>
          </details>
        )}

        <details style={{ minWidth: 0 }}>
          <summary className="bp-muted" style={{ cursor: 'pointer', minHeight: 40, display: 'flex', alignItems: 'center' }}>
            Подробнее о качестве данных
          </summary>
          <div className="bp-grid" style={{ marginTop: 4, fontSize: 14, overflowWrap: 'anywhere' }}>
            <div>Quality model: <strong>{quality.qualityModelId}</strong></div>
            <div>Version: <strong>{quality.qualityModelVersion}</strong></div>
            <div>Requested level: <strong>{quality.requestedLevel}</strong></div>
            <div>Maximum eligible: <strong>{quality.maximumEligibleLevel ?? 'unassessed'}</strong></div>
            <div>Gate: <strong>{quality.gateStatus}</strong></div>
          </div>
        </details>
      </div>
    </div>
  );
}
