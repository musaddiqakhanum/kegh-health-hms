import { cn } from "@/lib/utils";

/**
 * Illustrated tile for a medicine — one picture per dosage form, with a
 * deterministic pastel colour per brand name. Drawn as inline SVG so it works
 * fully offline and needs no image assets (real product photos cannot be
 * bundled for copyright reasons).
 */

const PALETTES: [string, string][] = [
  ["#fee2e2", "#b91c1c"], // red
  ["#ffedd5", "#c2410c"], // orange
  ["#fef9c3", "#a16207"], // amber
  ["#dcfce7", "#15803d"], // green
  ["#ccfbf1", "#0f766e"], // teal
  ["#dbeafe", "#1d4ed8"], // blue
  ["#e0e7ff", "#4338ca"], // indigo
  ["#f3e8ff", "#7e22ce"], // purple
  ["#fce7f3", "#be185d"], // pink
  ["#f1f5f9", "#475569"], // slate
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function FormShape({ form, color }: { form: string; color: string }) {
  const f = normForm(form);
  switch (f) {
    case "tablet":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff">
          <ellipse cx={26} cy={28} rx={13} ry={9} />
          <line x1={13} y1={28} x2={39} y2={28} />
        </g>
      );
    case "capsule":
      return (
        <g transform="rotate(30 26 28)">
          <rect
            x={12}
            y={20}
            width={28}
            height={15}
            rx={7.5}
            fill="#fff"
            stroke={color}
            strokeWidth={2.4}
          />
          <path d="M 26 20 v 15" stroke={color} strokeWidth={2.4} />
          <path
            d="M 12.5 20 h 13.5 v 15 h -13.5 a 7.5 7.5 0 1 1 0-15 z"
            fill={color}
            opacity={0.85}
            stroke="none"
          />
        </g>
      );
    case "syrup":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff">
          <rect x={19} y={8} width={14} height={5} rx={1.5} />
          <path d="M 21 13 L 18 20 h 16 l -3 -7" strokeLinejoin="round" />
          <rect x={18} y={20} width={16} height={20} rx={2.5} />
          <rect x={21} y={25} width={10} height={9} fill="#fff" />
        </g>
      );
    case "suspension":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff">
          <rect x={19} y={8} width={14} height={5} rx={1.5} />
          <path d="M 21 13 L 18 20 h 16 l -3 -7" strokeLinejoin="round" />
          <rect x={18} y={20} width={16} height={20} rx={2.5} />
        </g>
      );
    case "suspension-dots":
      return null;
    case "injection":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff" strokeLinecap="round">
          <line x1={8} y1={8} x2={8} y2={16} />
          <line x1={8} y1={16} x2={16} y2={16} transform="rotate(45 8 16)" />
          <rect x={16} y={16} width={20} height={7} rx={1.5} transform="rotate(-45 26 20)" />
          <line x1={17} y1={21.5} x2={22.5} y2={16} />
          <line x1={34.5} y1={31.5} x2={41.5} y2={38.5} />
        </g>
      );
    case "drops":
      return (
        <g stroke={color} strokeWidth={2.2} fill="#fff">
          <rect x={23} y={7} width={7} height={7} rx={1.5} />
          <path d="M 21 14 h 11 l -1.5 19 a 4 4 0 0 1 -8 0 z" strokeLinejoin="round" />
          <path d="M 26.5 36.5 c 2 - 2.5 3 - 4 3 - 5.5 a 3 3 0 0 0 - 6 0 c 0 1.5 1 3 3 5.5 z" />
        </g>
      );
    case "cream":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff" strokeLinejoin="round">
          <rect x={22} y={7} width={9} height={4} rx={1.2} />
          <path d="M 21 11 h 11 l 3 26 a 2 2 0 0 1 -2 2 h -13 a 2 2 0 0 1 -2 -2 z" />
          <line x1={23.5} y1={30} x2={29.5} y2={30} />
        </g>
      );
    case "sachet":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff" strokeLinejoin="round">
          <rect x={15} y={14} width={22} height={27} rx={2} />
          <path d="M 15 14 l 4 4 h 18" strokeDasharray="3 3" />
          <line x1={21} y1={26} x2={31} y2={26} />
          <line x1={23} y1={31} x2={29} y2={31} />
        </g>
      );
    case "inhaler":
      return (
        <g
          stroke={color}
          strokeWidth={2.4}
          fill="#fff"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M 17 21 h 9 v 12 a 4 4 0 0 0 4 4 v 4 h -13 z" />
          <rect
            x={24}
            y={9}
            width={9}
            height={19}
            rx={2}
            fill={color}
            opacity={0.85}
            stroke="none"
          />
          <rect x={24} y={9} width={9} height={19} rx={2} />
        </g>
      );
    case "suppository":
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff">
          <path d="M 26 10 c 6 8 7.5 12 7.5 16 a 7.5 7.5 0 1 1 -15 0 c 0 -4 1.5 -8 7.5 -16 z" />
        </g>
      );
    case "consumable":
    default:
      return (
        <g stroke={color} strokeWidth={2.4} fill="#fff" strokeLinejoin="round">
          <rect x={14} y={14} width={24} height={24} rx={2.5} />
          <path d="M 26 21 v 10 M 21 26 h 10" strokeLinecap="round" />
        </g>
      );
  }
}

function normForm(form: string): string {
  const f = (form || "").toLowerCase();
  if (f === "tablet") return "tablet";
  if (f === "capsule") return "capsule";
  if (f === "syrup") return "syrup";
  if (f === "suspension") return "suspension";
  if (f === "injection") return "injection";
  if (f === "drops") return "drops";
  if (f.includes("cream") || f.includes("ointment")) return "cream";
  if (f === "sachet") return "sachet";
  if (f === "inhaler") return "inhaler";
  if (f === "suppository") return "suppository";
  if (f === "consumable") return "consumable";
  return "other";
}

export function MedFormArt({
  name,
  form,
  size = 44,
  className,
}: {
  name: string;
  form: string;
  size?: number;
  className?: string;
}) {
  const [bg, fg] = PALETTES[hash((name || "?").toLowerCase()) % PALETTES.length] ?? PALETTES[0]!;
  const dots = normForm(form) === "suspension";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl ring-1 ring-black/5",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: bg }}
      title={form || "medicine"}
    >
      <svg width={size} height={size} viewBox="12 3 29 40" aria-hidden="true">
        <FormShape form={form} color={fg} />
        {dots ? (
          <g fill={fg}>
            <circle cx={22} cy={26} r={1.4} />
            <circle cx={29} cy={30} r={1.4} />
            <circle cx={23.5} cy={34} r={1.4} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
