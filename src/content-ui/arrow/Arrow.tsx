export default function Arrow() {
  return (
    <svg
      className=" pointer-events-none z-50 origin-top-left -translate-x- -translate-y- w-4 h-4 overflow-visible"
      style={{
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
      }}
      viewBox="0 0 20 20"
      fill="var(--color-primary)"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* White outer border (thick stroke to create rounding) */}
      <polygon
        points="0,0 8,20 12,12 20,8"
        fill="white"
        stroke="white"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      {/* Primary color inner fill (slightly thinner stroke to create the border gap) */}
      <polygon
        points="0,0 8,20 12,12 20,8"
        fill="var(--color-primary)"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
