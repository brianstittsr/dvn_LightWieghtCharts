import { AuthGate } from "@/components/auth-gate";
import PropFirmCalc from "@/components/prop-firm-calc";

export default function PropFirmPage(): React.ReactElement {
  return (
    <AuthGate>
      <PropFirmCalc />
    </AuthGate>
  );
}
