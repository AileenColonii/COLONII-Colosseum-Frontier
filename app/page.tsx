import { redirect } from "next/navigation";

// The Colosseum tech-demo build only ships the /colosseum surface.
// Anyone hitting the root is rerouted into the demo flow.
export default function RootIndex(): never {
  redirect("/colosseum");
}
