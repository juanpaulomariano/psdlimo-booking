import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthForm } from "../components/AuthForm";

export default async function LoginPage() {
  // Already logged in → no reason to see the login form.
  const session = await getSession();
  if (session) redirect(session.role === "admin" ? "/admin" : "/");
  return <AuthForm mode="login" />;
}
