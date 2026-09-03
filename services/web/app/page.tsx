import { redirect } from "next/navigation";

// The recruiter's /k/:slug page lands with Journey 2. Until then the app opens
// on the candidate side, which is what Journey 1 builds.
export default function Home() {
  redirect("/studio");
}
