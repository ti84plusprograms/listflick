import { LegalDocumentScreen } from "../components/legal/LegalDocumentScreen";
import { PRIVACY_POLICY_MARKDOWN } from "../content/legalDocuments";

export default function PrivacyPolicyScreen() {
  return <LegalDocumentScreen markdown={PRIVACY_POLICY_MARKDOWN} screenTitle="Privacy & Data" />;
}
