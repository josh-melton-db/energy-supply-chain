import type { ForecastPoint } from "@/types/domain";

interface ForecastMiniChartProps {
  data: ForecastPoint[];
  height?: number;
}

export default function ForecastMiniChart({ data, height = 140 }: ForecastMiniChartProps) {
  if (data.length === 0) return null;

  const width = 360;
  const padX = 36;
  const padY = 20;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const allVals = data.flatMap((d) => [d.demandTpd, d.supplyTpd]);
  const maxVal = Math.max(...allVals) * 1.1;
  const minVal = Math.min(...allVals) * 0.9;
  const range = maxVal - minVal || 1;

  function x(i: number) {
    return padX + (i / (data.length - 1)) * chartW;
  }
  function y(v: number) {
    return padY + (1 - (v - minVal) / range) * chartH;
  }

  const demandPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.demandTpd)}`).join(" ");
  const supplyPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.supplyTpd)}`).join(" ");
  const demandPathReversed = [...data].reverse().map((d, i) => `L${x(data.length - 1 - i)},${y(d.demandTpd)}`).join(" ");

  const gapAreaPath = `${supplyPath} ${demandPathReversed} Z`;

  const crossIdx = data.findIndex((d, i) => i > 0 && data[i - 1].supplyTpd >= data[i - 1].demandTpd && d.supplyTpd < d.demandTpd);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <path d={gapAreaPath} fill="#3b82f6" opacity={0.12} />
      <path d={supplyPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
      <path d={demandPath} fill="none" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 3" />

      {crossIdx > 0 && (
        <>
          <line x1={x(crossIdx)} y1={padY} x2={x(crossIdx)} y2={height - padY} stroke="#ef4444" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
          <text x={x(crossIdx)} y={padY - 4} textAnchor="middle" className="fill-red-500 text-[8px] font-medium">
            Zero Day
          </text>
        </>
      )}

      {data.filter((_, i) => i % 3 === 0 || i === data.length - 1).map((d, i) => {
        const idx = data.indexOf(d);
        return (
          <text key={i} x={x(idx)} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[7px]">
            {d.date.slice(5)}
          </text>
        );
      })}

      <circle cx={width - padX - 40} cy={8} r={3} fill="#3b82f6" />
      <text x={width - padX - 34} y={11} className="fill-muted-foreground text-[8px]">Supply</text>
      <circle cx={width - padX + 4} cy={8} r={3} fill="#ef4444" />
      <text x={width - padX + 10} y={11} className="fill-muted-foreground text-[8px]">Demand</text>
    </svg>
  );
}
