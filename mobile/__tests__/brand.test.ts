import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BRAND_NAME } from "../constants/brand";

if (BRAND_NAME !== "ListFlick") {
  throw new Error("The shared mobile brand name must be ListFlick");
}

const expectedBrandReferences = [
  ["Expo app name", "../app.json", '"name": "ListFlick"'],
  ["Expo camera permission", "../app.json", "Allow ListFlick to access your camera"],
  ["Firebase OAuth brand", "../../firebase.json", '"oAuthBrandDisplayName": "ListFlick"'],
  ["FastAPI title", "../../backend/app/main.py", 'title="ListFlick API"'],
] as const;

for (const [label, relativePath, expected] of expectedBrandReferences) {
  const source = readFileSync(resolve(__dirname, relativePath), "utf8");
  if (!source.includes(expected)) {
    throw new Error(`${label} is not branded as ${BRAND_NAME}`);
  }
}

const processingSource = readFileSync(resolve(__dirname, "../app/processing.tsx"), "utf8");
if (!processingSource.includes("<ListFlickMark size={48} />")) {
  throw new Error("The processing loader must use the ListFlick mark");
}
if (processingSource.includes('name="sparkles-outline"')) {
  throw new Error("The processing loader must not use the sparkle icon");
}

console.log("ListFlick brand consistency tests passed.");
