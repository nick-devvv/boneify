import type { Metadata } from "next";
import { LiveDemo } from "./LiveDemo";

export const metadata: Metadata = { title: "Boneify · Demo" };

export default function DemoPage() {
  return <LiveDemo />;
}
