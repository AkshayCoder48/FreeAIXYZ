import { redirect } from "next/navigation";

export default function SettingsRedirect() {
  // The standalone Settings page was removed — BYOK management now lives
  // on the /providers page (which is a single-page provider router). Redirect
  // any stale links/bookmarks to the new home.
  redirect("/providers");
}
