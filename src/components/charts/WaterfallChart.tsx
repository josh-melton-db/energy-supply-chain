import type { WaterfallNode } from "@/types/domain";
import { formatCurrency } from "@/lib/format";

interface WaterfallChartProps {
  data: WaterfallNode[];
  height?: number;
}

export default function WaterfallChart({ data, height = 200 }: WaterfallChartProps) {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map((d) => Math.abs(d.value)));
  const barWidth = Math.min(60, (320 - data.length * 4) / data.length);
  const chartWidth = data.length * (barWidth + 16) + 20;
  const scaleY = (height - 60) / maxVal;

  let runningTotal = 0;
  const bars = data.map((node, i) => {
    let barHeight: number;
    let y: number;
    let color: string;

    if (node.type === "start") {
      runningTotal = node.value;
      barHeight = Math.abs(node.value) * scaleY;
      y = height - 30 - barHeight;
      color = "#3b82f6";
    } else if (node.type === "end") {
      barHeight = Math.abs(node.value) * scaleY;
      y = height - 30 - barHeight;
      color = node.value >= 0 ? "#22c55e" : "#ef4444";
    } else {
      barHeight = Math.abs(node.value) * scaleY;
      if (node.value < 0) {
        y = height - 30 - runningTotal * scaleY;
        runningTotal += node.value;
      } else {
        runningTotal += node.value;
        y = height - 30 - runningTotal * scaleY;
      }
      color = node.value >= 0 ? "#22c55e" : "#ef4444";
    }

    const x = 10 + i * (barWidth + 16);

    return (
      <g key={i}>
        <rect x={x} y={y} width={barWidth} height={Math.max(2, barHeight)} rx={2} fill={color} opacity={0.85} />
        <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="fill-foreground text-[9px]">
          {node.value >= 0 ? "" : "-"}{formatCurrency(Math.abs(node.value))}
        </text>
        <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" className="fill-muted-foreground text-[8px]">
          {node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label}
        </text>
      </g>
    );
  });

  return (
    <svg viewBox={`0 0 ${chartWidth} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <line x1={10} y1={height - 30} x2={chartWidth - 10} y2={height - 30} stroke="currentColor" strokeOpacity={0.15} />
      {bars}
    </svg>
  );
}
