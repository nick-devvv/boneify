import { BoneIcon } from "./Sprites";

/** The key that explains the bones, shown wherever verdicts appear. */
export function Key({ size = 14, dark = false }: { size?: number; dark?: boolean }) {
  const item = { display: "flex", alignItems: "center", gap: 6 } as const;
  return (
    <div aria-label="Key" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: size, color: dark ? "#F5EEE2" : "var(--ink)" }}>
      <span style={item}><BoneIcon verdict="supported" width={26} dark={dark} />Correct</span>
      <span style={item}><BoneIcon verdict="contradicted" width={26} dark={dark} />Wrong</span>
      <span style={item}><BoneIcon verdict="not_in_source" width={26} dark={dark} />Made up</span>
    </div>
  );
}
