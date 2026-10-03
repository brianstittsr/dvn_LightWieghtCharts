import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <AuthGate>
      <Suspense>
        <Dashboard />
      </Suspense>
    </AuthGate>
  );
}
