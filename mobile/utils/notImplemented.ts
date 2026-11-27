import { Alert } from "react-native";
import { NOT_IMPLEMENTED_TITLE } from "./preferences";

/** Use for any control whose feature isn't built yet, so it never silently does nothing. */
export function showNotImplemented(feature?: string): void {
  Alert.alert(NOT_IMPLEMENTED_TITLE, feature ? `${feature} isn't available yet.` : undefined);
}
