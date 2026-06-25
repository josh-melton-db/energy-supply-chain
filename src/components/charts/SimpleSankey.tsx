import type { SankeyNode, SankeyLink } from "@/types/domain";
import { formatCurrency } from "@/lib/format";

interface SimpleSankeyProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  height?: number;
}

export default function SimpleSankey({ nodes, links, height = 220 }: SimpleSankeyProps) {
  if (nodes.length === 0) return null;

  const leftNodes = nodes.filter((n) => links.some((l) => l.source === n.id && links.some((l2) => l2.target === n.id) === false));
  const midNodes = nodes.filter((n) => links.some((l) => l.target === n.id) && links.some((l2) => l2.source === n.id));
  const rightNodes = nodes.filter((n) => links.some((l) => l.target === n.id) && !links.some((l2) => l2.source === n.id));

  const width = 500;
  const pad = 8;
  const colX = [30, 220, 390];

  function layoutColumn(col: SankeyNode[], x: number) {
    const totalValue = col.reduce((s, n) => {
      const val = links.filter((l) => l.target === n.id || l.source === n.id).reduce((ss, l) => ss + l.value, 0);
      return s + val;
    }, 0);
    const usableHeight = height - 40;
    let y = 20;
    return col.map((n) => {
      const val = links.filter((l) => l.target === n.id || l.source === n.id).reduce((ss, l) => ss + l.value, 0) / 2;
      const h = Math.max(14, (val / Math.max(1, totalValue / 2)) * usableHeight);
      const rect = { x, y, w: 90, h, node: n, val };
      y += h + pad;
      return rect;
    });
  }

  const leftRects = layoutColumn(leftNodes, colX[0]);
  const midRects = layoutColumn(midNodes, colX[1]);
  const rightRects = layoutColumn(rightNodes, colX[2]);
  const allRects = [...leftRects, ...midRects, ...rightRects];

  const colors = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#22c55e", "#ef4444", "#ec4899", "#64748b"];

  function rectFor(id: string) {
    return allRects.find((r) => r.node.id === id);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {links.map((link, i) => {
        const src = rectFor(link.source);
        const tgt = rectFor(link.target);
        if (!src || !tgt) return null;
        const x1 = src.x + src.w;
        const x2 = tgt.x;
        const y1 = src.y + src.h / 2;
        const y2 = tgt.y + tgt.h / 2;
        const thickness = Math.max(2, (link.value / Math.max(1, ...links.map((l) => l.value))) * 30);
        return (
          <path
            key={i}
            d={`M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth={thickness}
            opacity={0.25}
          />
        );
      })}
      {allRects.map((r, i) => (
        <g key={r.node.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill={colors[i % colors.length]} opacity={0.7} />
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 - 4} textAnchor="middle" className="fill-white text-[8px] font-medium">
            {r.node.label}
          </text>
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 8} textAnchor="middle" className="fill-white/80 text-[7px]">
            {formatCurrency(r.val)}
          </text>
        </g>
      ))}
    </svg>
  );
}
