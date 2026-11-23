import { LegalDocumentScreen } from "../components/legal/LegalDocumentScreen";
import { TERMS_OF_USE_MARKDOWN } from "../content/legalDocuments";

export default function TermsOfUseScreen() {
  return <LegalDocumentScreen markdown={TERMS_OF_USE_MARKDOWN} screenTitle="Terms of Service" />;
}
