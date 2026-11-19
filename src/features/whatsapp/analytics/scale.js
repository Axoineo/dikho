// The y scale for the dashboard charts, kept apart from the JSX so tests can import it.

/** A rounded top for the scale and evenly spaced ticks: 0, 250, 500, 750, 1000. */
export function scale(max, { count = 4, integer = true } = {}) {
  if (!(max > 0)) return { top: integer ? count : 1, ticks: Array.from({ length: count + 1 }, (_, i) => (integer ? i : i / count)) }
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  let step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw - 1e-9)
  if (integer) step = Math.max(1, Math.ceil(step))
  const top = Math.ceil(max / step - 1e-9) * step
  const ticks = []
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Math.round(value * 1000) / 1000)
  return { top, ticks }
}
