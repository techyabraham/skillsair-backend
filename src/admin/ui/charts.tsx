/**
 * Studio charts: hand-built SVG/HTML, rendered on the server (no chart library, no client JS).
 * Colours come from --sa-chart-1..6 and status tokens, so they follow the theme.
 * Hover/keyboard tooltips are CSS only (focusable marks reveal their value label); every chart
 * also renders a visually hidden data table so screen-reader users get the numbers.
 *
 * Sparkline      14–30 points, area at 12% opacity, last-point dot; aria-hidden (value is shown as text)
 * HBarChart      horizontal bars, sorted by the caller, optional links
 * ColumnChart    vertical (optionally stacked) columns with an optional line overlay (e.g. MRR)
 * LineChart      single line with area
 * Donut          centre label, legend with values and %
 * Funnel         steps with step %, drop-off and click targets
 */
import React from 'react'

export const CHART_COLOURS = ['var(--sa-chart-1)', 'var(--sa-chart-2)', 'var(--sa-chart-3)', 'var(--sa-chart-4)', 'var(--sa-chart-5)', 'var(--sa-chart-6)']

type Format = (value: number) => string
const plain: Format = (value) => new Intl.NumberFormat('en-GB').format(value)

/** "Nice" axis ticks: 0..max in 3–5 round steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)))
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step)
  return ticks
}

function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="sa-visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Sparkline({ values, width = 120, height = 32, tone = 'accent' }: { values: number[]; width?: number; height?: number; tone?: 'accent' | 'info' | 'positive' | 'critical' }) {
  if (values.length < 2) return <svg className="sa-spark" width={width} height={height} aria-hidden="true" />
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pad = 3
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2)
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(values.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`
  const last = values[values.length - 1]!
  return (
    <svg className={`sa-spark sa-spark--${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <path className="sa-spark__area" d={area} />
      <path className="sa-spark__line" d={line} fill="none" />
      <circle className="sa-spark__dot" cx={x(values.length - 1)} cy={y(last)} r={2.5} />
    </svg>
  )
}

export interface BarDatum {
  label: string
  value: number
  colour?: string
  href?: string
  detail?: string
}

export function HBarChart({ data, title, format = plain, valueLabel = 'Count' }: { data: BarDatum[]; title: string; format?: Format; valueLabel?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <figure className="sa-hbar">
      <ul className="sa-hbar__list" aria-hidden="true">
        {data.map((datum, index) => {
          const inner = (
            <>
              <span className="sa-hbar__label">{datum.label}</span>
              <span className="sa-hbar__track">
                <span className="sa-hbar__fill" style={{ width: `${Math.max(datum.value ? 2 : 0, (datum.value / max) * 100)}%`, background: datum.colour ?? CHART_COLOURS[index % CHART_COLOURS.length] }} />
              </span>
              <span className="sa-hbar__value">{format(datum.value)}</span>
            </>
          )
          return (
            <li key={datum.label}>
              {datum.href ? (
                <a className="sa-hbar__row" href={datum.href} tabIndex={-1}>
                  {inner}
                </a>
              ) : (
                <span className="sa-hbar__row">{inner}</span>
              )}
            </li>
          )
        })}
      </ul>
      {/* Keyboard and screen-reader access: the same rows as real links in a table. */}
      <table className="sa-visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.label}>
              <th scope="row">{datum.href ? <a href={datum.href}>{datum.label}</a> : datum.label}</th>
              <td>{format(datum.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export interface ColumnSeries {
  key: string
  label: string
  colour: string
}

export function ColumnChart({
  labels,
  series,
  values,
  line,
  title,
  format = plain,
  lineFormat = plain,
  height = 260,
  width = 960,
}: {
  labels: string[]
  series: ColumnSeries[]
  /** values[seriesKey][i] */
  values: Record<string, number[]>
  line?: { label: string; values: number[]; colour?: string }
  title: string
  format?: Format
  lineFormat?: Format
  height?: number
  /** viewBox width: pick close to the rendered width so 11px labels stay ~11px. */
  width?: number
}) {
  const pad = { top: 16, right: line ? 64 : 12, bottom: 28, left: 64 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (values[s.key]?.[i] ?? 0), 0))
  const ticks = niceTicks(Math.max(...totals, 1))
  const top = ticks[ticks.length - 1]!
  const band = innerW / Math.max(labels.length, 1)
  const barW = Math.max(4, Math.min(28, band * 0.62))
  const y = (v: number) => pad.top + innerH - (v / top) * innerH
  const lineTicks = line ? niceTicks(Math.max(...line.values, 1)) : []
  const lineTop = lineTicks[lineTicks.length - 1] ?? 1
  const ly = (v: number) => pad.top + innerH - (v / lineTop) * innerH
  const labelEvery = Math.ceil(labels.length / 8)

  return (
    <figure className="sa-columns">
      <svg viewBox={`0 0 ${width} ${height}`} className="sa-columns__svg" role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick} className="sa-axis">
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="sa-axis__grid" />
            <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="sa-axis__label">
              {format(tick)}
            </text>
          </g>
        ))}
        {line
          ? lineTicks.map((tick) => (
              <text key={`l${tick}`} x={width - pad.right + 8} y={ly(tick)} dy="0.32em" className="sa-axis__label">
                {lineFormat(tick)}
              </text>
            ))
          : null}
        {labels.map((label, i) => {
          let base = 0
          const cxPos = pad.left + band * i + band / 2
          const tip = `${label}: ${series.map((s) => `${s.label} ${format(values[s.key]?.[i] ?? 0)}`).join(', ')}${line ? `; ${line.label} ${lineFormat(line.values[i] ?? 0)}` : ''}`
          return (
            <g key={label + i} className="sa-columns__group" tabIndex={0} aria-label={tip}>
              <title>{tip}</title>
              <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} className="sa-columns__hit" />
              {series.map((s) => {
                const v = values[s.key]?.[i] ?? 0
                if (!v) return null
                const y0 = y(base)
                base += v
                const y1 = y(base)
                return <rect key={s.key} x={cxPos - barW / 2} y={y1} width={barW} height={Math.max(1, y0 - y1)} rx={2} style={{ fill: s.colour }} />
              })}
              <text x={cxPos} y={y(totals[i]!) - 6} textAnchor="middle" className="sa-columns__tip">
                {format(totals[i]!)}
              </text>
              {i % labelEvery === 0 ? (
                <text x={cxPos} y={height - 8} textAnchor="middle" className="sa-axis__label">
                  {label}
                </text>
              ) : null}
            </g>
          )
        })}
        {line ? (
          <path
            className="sa-columns__line"
            d={line.values.map((v, i) => `${i ? 'L' : 'M'}${(pad.left + band * i + band / 2).toFixed(1)},${ly(v).toFixed(1)}`).join(' ')}
            style={{ stroke: line.colour ?? 'var(--sa-ink)' }}
            fill="none"
          />
        ) : null}
      </svg>
      <figcaption className="sa-legend">
        {series.map((s) => (
          <span key={s.key} className="sa-legend__item">
            <i className="sa-legend__swatch" style={{ background: s.colour }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        {line ? (
          <span className="sa-legend__item">
            <i className="sa-legend__line" style={{ background: line.colour ?? 'var(--sa-ink)' }} aria-hidden="true" />
            {line.label}
          </span>
        ) : null}
      </figcaption>
      <DataTable
        caption={title}
        columns={['Day', ...series.map((s) => s.label), ...(line ? [line.label] : [])]}
        rows={labels.map((label, i) => [label, ...series.map((s) => format(values[s.key]?.[i] ?? 0)), ...(line ? [lineFormat(line.values[i] ?? 0)] : [])])}
      />
    </figure>
  )
}

export function LineChart({ labels, values, title, format = plain, height = 160, colour = 'var(--sa-chart-1)' }: { labels: string[]; values: number[]; title: string; format?: Format; height?: number; colour?: string }) {
  const width = 640
  const pad = { top: 12, right: 12, bottom: 24, left: 56 }
  const ticks = niceTicks(Math.max(...values, 1))
  const top = ticks[ticks.length - 1]!
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const x = (i: number) => pad.left + (labels.length > 1 ? (i / (labels.length - 1)) * innerW : innerW / 2)
  const y = (v: number) => pad.top + innerH - (v / top) * innerH
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <figure className="sa-line">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick} className="sa-axis">
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="sa-axis__grid" />
            <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="sa-axis__label">
              {format(tick)}
            </text>
          </g>
        ))}
        <path d={`${d} L${x(values.length - 1)},${pad.top + innerH} L${x(0)},${pad.top + innerH} Z`} style={{ fill: colour }} className="sa-line__area" />
        <path d={d} fill="none" style={{ stroke: colour }} className="sa-line__path" />
      </svg>
      <DataTable caption={title} columns={['Point', 'Value']} rows={labels.map((label, i) => [label, format(values[i] ?? 0)])} />
    </figure>
  )
}

export interface DonutDatum {
  label: string
  value: number
  colour: string
}

export function Donut({ data, title, centreLabel, size = 140 }: { data: DonutDatum[]; title: string; centreLabel?: string; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const stroke = 18
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <figure className="sa-donut">
      <div className="sa-donut__chart" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="sa-donut__track" />
          {total > 0
            ? data.map((d) => {
                const length = (d.value / total) * c
                const segment = (
                  <circle
                    key={d.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    style={{ stroke: d.colour }}
                    strokeDasharray={`${Math.max(0, length - (data.length > 1 ? 2 : 0))} ${c}`}
                    strokeDashoffset={-offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  />
                )
                offset += length
                return segment
              })
            : null}
        </svg>
        <span className="sa-donut__centre" aria-hidden="true">
          <strong>{plain(total)}</strong>
          {centreLabel ? <small>{centreLabel}</small> : null}
        </span>
      </div>
      <ul className="sa-donut__legend">
        {data.map((d) => (
          <li key={d.label}>
            <i className="sa-legend__swatch" style={{ background: d.colour }} aria-hidden="true" />
            <span className="sa-donut__label">{d.label}</span>
            <span className="sa-donut__value">{plain(d.value)}</span>
            <span className="sa-donut__pct">{total ? `${Math.round((d.value / total) * 100)}%` : '–'}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export interface FunnelStep {
  label: string
  value: number
  href?: string
}

export function Funnel({ steps, title }: { steps: FunnelStep[]; title: string }) {
  const first = steps[0]?.value ?? 0
  return (
    <figure className="sa-funnel" aria-label={title}>
      <ol className="sa-funnel__steps">
        {steps.map((step, index) => {
          const previous = index ? steps[index - 1]!.value : step.value
          const stepRate = previous ? step.value / previous : 0
          const overall = first ? step.value / first : 0
          const dropped = index ? previous - step.value : 0
          const content = (
            <>
              <span className="sa-funnel__head">
                <span className="sa-funnel__label">{step.label}</span>
                <strong className="sa-funnel__value">{plain(step.value)}</strong>
              </span>
              <span className="sa-funnel__track" aria-hidden="true">
                <span className="sa-funnel__fill" style={{ width: `${first ? Math.max(step.value ? 1.5 : 0, overall * 100) : 0}%` }} />
              </span>
              <span className="sa-funnel__meta">
                {index === 0 ? 'Start' : `${Math.round(stepRate * 100)}% of previous step · ${plain(dropped)} dropped`}
                {index > 0 ? <span className="sa-funnel__overall"> · {Math.round(overall * 100)}% overall</span> : null}
              </span>
            </>
          )
          return (
            <li key={step.label}>
              {step.href ? (
                <a className="sa-funnel__step" href={step.href}>
                  {content}
                </a>
              ) : (
                <div className="sa-funnel__step">{content}</div>
              )}
            </li>
          )
        })}
      </ol>
    </figure>
  )
}
