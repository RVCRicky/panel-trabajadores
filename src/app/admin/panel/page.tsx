import { redirect } from "next/navigation";

export default function AdminPanelLegacyRedirect() {
  redirect("/panel/admin");
}
