import type { Metadata } from "next";
import { CheckApp } from "./CheckApp";

export const metadata: Metadata = { title: "Boneify · Try it" };

export default function CheckPage() {
  return <CheckApp />;
}
