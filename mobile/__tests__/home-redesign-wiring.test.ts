import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const home = read("../app/(tabs)/index.tsx");
const inventory = read("../app/(tabs)/inventory.tsx");
const tabs = read("../app/(tabs)/_layout.tsx");
const camera = read("../app/camera.tsx");
const review = read("../app/review.tsx");
const checklist = read("../components/listing/ReadyChecklist.tsx");
const recheckHook = read("../hooks/useListingRecheck.ts");
const api = read("../services/api.ts");

function expectIncludes(source: string, expected: string, label: string): void {
  if (!source.includes(expected)) throw new Error(`${label} is missing ${JSON.stringify(expected)}`);
}

function expectExcludes(source: string, unexpected: string, label: string): void {
  if (source.includes(unexpected)) throw new Error(`${label} should not contain ${JSON.stringify(unexpected)}`);
}

// Home: approved "Option A" copy and states.
for (const expected of [
  "Make your first listing",
  "Snap something you want to sell. ListFlick identifies it, prices it and writes the listing.",
  "How it works",
  "Snap the item",
  "A few photos or a short video. Include any flaws.",
  "ListFlick does the listing",
  "Prices come from what similar items actually sell for.",
  "Post it",
  "Save the photos to your camera roll and paste the text into Marketplace.",
  "Set up once: pickup area and payment",
  "New listing",
  "Snap a few photos. ListFlick writes the rest.",
  "Needs attention",
  "Unfinished listing",
  "See all {model.attention.length}",
  "All caught up.",
  "Nothing needs your attention.",
  "Ready to post",
  "in Inventory",
  'openInventory("attention")',
  "buildHomeModel(",
  'router.push("/camera")',
]) {
  expectIncludes(home, expected, "Home");
}

// Video exists now: the first-run card tags it next to Photos.
expectIncludes(home, "<Text style={styles.firstRunTagText}>Video</Text>", "Home");
expectIncludes(home, "videocam-outline", "Home");

// Needs attention and Ready to post show together: attention first, ready below it.
expectIncludes(home, "{model.ready.length > 0 && (", "Home");
if (home.indexOf("Needs attention") > home.indexOf("Ready to post</Text>")) {
  throw new Error("Home should list Needs attention above Ready to post");
}
expectExcludes(home, "<>\n                <View style={styles.caughtUp}>", "Home");

// Setup is one pill at the bottom of Home, never a row that looks like a listing.
expectIncludes(home, "styles.setupPill", "Home");
expectIncludes(home, "styles.bottomSpacer", "Home");
expectIncludes(home, 'accessibilityHint="Added to every listing for you"', "Home");
for (const removed of ['key="setup"', "styles.setupRow", "One-time setup"]) {
  expectExcludes(home, removed, "Home");
}

// The greeting, hero copy and library shortcut are gone; camera still offers the library.
for (const removed of ["Sell something today", "getGreeting", "Choose from Library", "openPicker"]) {
  expectExcludes(home, removed, "Home");
}
expectIncludes(camera, "launchImageLibraryAsync", "Camera");
expectIncludes(camera, "Library", "Camera");

// Inventory badges and filter use the same rules as Home.
expectIncludes(inventory, "statusLabel(item)", "Inventory");
expectExcludes(inventory, 'item.status === "saved" ? "Ready to list" : "Draft"', "Inventory");
expectIncludes(inventory, "Showing listings that need attention", "Inventory");
expectIncludes(inventory, "Show all", "Inventory");
expectIncludes(inventory, "filterInventoryListings(listings, filter)", "Inventory");
expectIncludes(tabs, "tabPress: () => setInventoryFilter(null)", "Tab layout");

// Live checklist on the review screen, re-checked through the backend.
expectIncludes(review, "<ReadyChecklist openQuestionCount={questions.length} />", "Review");
expectIncludes(checklist, "Re-checking your photos and tips…", "Checklist");
expectIncludes(checklist, "useListingRecheck(listing, insightsEnabled)", "Checklist");
expectIncludes(checklist, "done", "Checklist");
expectIncludes(recheckHook, "canUseAIProvider()", "Recheck hook");
expectIncludes(recheckHook, "RECHECK_DEBOUNCE_MS", "Recheck hook");
expectIncludes(recheckHook, "include_images: withImages", "Recheck hook");
expectIncludes(recheckHook, "await persistRecheck(", "Recheck hook");
expectIncludes(api, '"/api/items/recheck"', "API");

console.log("home redesign wiring tests passed");
