import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthForm } from "../components/AuthForm";

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect(session.role === "admin" ? "/admin" : "/");
  return <AuthForm mode="register" />;
}
