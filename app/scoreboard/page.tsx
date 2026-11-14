import type { Metadata } from "next";
import { Scoreboard } from "./Scoreboard";

export const metadata: Metadata = { title: "Boneify · Scoreboard" };

export default function ScoreboardPage() {
  return <Scoreboard />;
}
