// Legacy exemplar heal — compatibility re-export.
//
// The exemplar implementation now lives in heal-classic.ts (renamed, frozen).
// This module re-exports it unchanged so existing imports of "./heal.js"
// keep working. New code should import from "./heal-classic.js" for the
// legacy engine or "./ml-heal.js" for the ML path directly.
export * from "./heal-classic.js";
