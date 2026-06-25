export type RGBA = [number, number, number, number];

export const STATUS_COLORS = {
  GREEN: [34, 197, 94, 185] as RGBA,
  YELLOW: [250, 204, 21, 185] as RGBA,
  RED: [239, 68, 68, 185] as RGBA,
  BLUE: [59, 130, 246, 185] as RGBA,
} as const;

export const STATUS_CSS = {
  GREEN: "rgb(34, 197, 94)",
  YELLOW: "rgb(250, 204, 21)",
  RED: "rgb(239, 68, 68)",
  BLUE: "rgb(59, 130, 246)",
} as const;
