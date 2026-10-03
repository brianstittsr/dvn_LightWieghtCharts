import { AuthGate } from "@/components/auth-gate";
import { ScannerPage } from "@/components/scanner-page";

export default function ScannerRoute() {
  return (
    <AuthGate>
      <ScannerPage />
    </AuthGate>
  );
}
