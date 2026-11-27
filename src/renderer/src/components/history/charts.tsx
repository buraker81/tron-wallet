// Small hand-written SVG charts (single series each): a balance line and fee bars.
// Marks use the ink colour, grid/axes are recessive, hover shows a crosshair / bar tooltip.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fmt } from '../../ui'

/** Width of a container, kept up to date with a ResizeObserver. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** ~n "nice" ticks covering [min, max] (1, 2, 2.5, 5 × 10^k steps). */
function niceTicks(min: number, max: number, n = 4): number[] {
  if (!(max > min)) {
    const v = max || 1
    return [0, v]
  }
  const raw = (max - min) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => raw <= s)!
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e9) / 1e9)
  return out
}

const short = (n: number) =>
  Math.abs(n) >= 1e9
    ? `${fmt(n / 1e9, 2)}b`
    : Math.abs(n) >= 1e6
      ? `${fmt(n / 1e6, 2)}m`
      : Math.abs(n) >= 1e4
        ? `${fmt(n / 1e3, 1)}k`
        : fmt(n, 2)

const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const AXIS_W = 56
const PAD_T = 10
const PAD_B = 22

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // keep the box inside the chart: flip to the left of the cursor on the right half
  const left = x > width / 2
  return (
    <div className="chart-tip" style={left ? { right: width - x + 10 } : { left: x + 10 }}>
      {children}
    </div>
  )
}

export function LineChart({ points, unit, height = 180, label }: {
  points: { day: string; value: number }[]
  unit: string
  height?: number
  /** accessible name of the series */
  label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number>()
  const n = points.length
  const values = points.map((p) => p.value)
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const plotW = Math.max(0, width - AXIS_W)
  const plotH = height - PAD_T - PAD_B
  const x = (i: number) => AXIS_W + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 80))))

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / (r.width || 1)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} />
              <text className="axis" x={AXIS_W - 8} y={y(t) + 4} textAnchor="end">
                {short(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={p.day} className="axis" x={x(i)} y={height - 6} textAnchor={i === n - 1 ? 'end' : 'middle'}>
                {dayLabel(p.day)}
              </text>
            ) : null
          )}
          <path className="line" d={path} />
          {hover !== undefined && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} />
              <circle className="dot" cx={x(hover)} cy={y(points[hover].value)} r={4} />
            </g>
          )}
          <rect
            className="hit"
            x={AXIS_W}
            y={0}
            width={plotW}
            height={height}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(undefined)}
          />
        </svg>
      )}
      {hover !== undefined && width > 0 && (
        <Tooltip x={x(hover)} width={width}>
          <div className="muted">{points[hover].day}</div>
          <b>
            {fmt(points[hover].value, 6)} {unit}
          </b>
        </Tooltip>
      )}
    </div>
  )
}

export function Bars({ buckets, height = 110, label, tip }: {
  buckets: { key: string; start: string; value: number }[]
  height?: number
  label: string
  tip: (i: number) => ReactNode
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number>()
  const n = buckets.length
  const ticks = niceTicks(0, Math.max(...buckets.map((b) => b.value), 0), 3)
  const hi = ticks[ticks.length - 1] || 1
  const plotW = Math.max(0, width - AXIS_W)
  const plotH = height - PAD_T - PAD_B
  const slot = n ? plotW / n : 0
  const gap = Math.min(2, slot / 3) // 2px surface gap between adjacent bars
  const barW = Math.max(1, slot - gap)
  const y = (v: number) => PAD_T + plotH - (v / hi) * plotH
  const base = PAD_T + plotH
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 80))))

  /** Bar with a 4px rounded top, flat on the baseline. */
  const bar = (x0: number, top: number) => {
    const h = base - top
    if (h <= 0) return ''
    const r = Math.min(4, barW / 2, h)
    return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${base}Z`
  }

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} />
              <text className="axis" x={AXIS_W - 8} y={y(t) + 4} textAnchor="end">
                {short(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => (
            <g key={b.key}>
              <path className={`bar ${hover === i ? 'on' : ''}`} d={bar(AXIS_W + i * slot + gap / 2, y(b.value))} />
              {(i % labelEvery === 0 || i === n - 1) && (
                <text
                  className="axis"
                  x={AXIS_W + i * slot + slot / 2}
                  y={height - 6}
                  textAnchor={i === n - 1 ? 'end' : 'middle'}
                >
                  {dayLabel(b.start)}
                </text>
              )}
              {/* hit target: the whole column, bigger than the bar */}
              <rect
                className="hit"
                x={AXIS_W + i * slot}
                y={0}
                width={slot}
                height={height}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(undefined)}
              />
            </g>
          ))}
        </svg>
      )}
      {hover !== undefined && width > 0 && (
        <Tooltip x={AXIS_W + hover * slot + slot / 2} width={width}>
          {tip(hover)}
        </Tooltip>
      )}
    </div>
  )
}
