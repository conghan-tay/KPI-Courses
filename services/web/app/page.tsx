import { redirect } from "next/navigation";

// The catalog lands with Journey 2. Until then the app opens on the Specialist
// side, which is what Journey 1 builds.
export default function Home() {
  redirect("/studio");
}
