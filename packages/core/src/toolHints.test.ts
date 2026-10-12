import { describe, expect, it } from "vitest";
import { TOOL_HINT_FADE_MS, TOOL_HINT_VISIBLE_MS, createToolHintTracker } from "./toolHints.js";

describe("tool hint timing", () => {
  it("stays fully readable for 5s, then fades briefly (5.5s total on screen)", () => {
    expect(TOOL_HINT_VISIBLE_MS).toBe(5000);
    expect(TOOL_HINT_FADE_MS).toBe(500);
    expect(TOOL_HINT_VISIBLE_MS + TOOL_HINT_FADE_MS).toBe(5500);
  });
});

describe("createToolHintTracker", () => {
  it("shows every hint on a fresh photo visit", () => {
    const tracker = createToolHintTracker();
    expect(tracker.isDismissed("photo-1", "repair")).toBe(false);
    expect(tracker.isDismissed("photo-1", "crop")).toBe(false);
  });

  it("stays hidden once dismissed, and dismissal is idempotent", () => {
    const tracker = createToolHintTracker();
    tracker.dismiss("photo-1", "repair");
    tracker.dismiss("photo-1", "repair");
    expect(tracker.isDismissed("photo-1", "repair")).toBe(true);
  });

  it("tracks each hint independently within a photo visit", () => {
    const tracker = createToolHintTracker();
    tracker.dismiss("photo-1", "repair");
    expect(tracker.isDismissed("photo-1", "repair")).toBe(true);
    expect(tracker.isDismissed("photo-1", "crop")).toBe(false);
  });

  it("shows hints again on a different photo", () => {
    const tracker = createToolHintTracker();
    tracker.dismiss("photo-1", "repair");
    expect(tracker.isDismissed("photo-2", "repair")).toBe(false);
  });

  it("shows hints again when navigating away and back to the same photo", () => {
    const tracker = createToolHintTracker();
    tracker.dismiss("photo-1", "repair");
    expect(tracker.isDismissed("photo-1", "repair")).toBe(true);
    // Navigate away: touching another photo starts a new visit.
    expect(tracker.isDismissed("photo-2", "repair")).toBe(false);
    // Navigate back: the earlier visit's dismissals are gone.
    expect(tracker.isDismissed("photo-1", "repair")).toBe(false);
  });

  it("checking one photo never dismisses another photo's hints", () => {
    const tracker = createToolHintTracker();
    tracker.dismiss("photo-1", "repair");
    tracker.isDismissed("photo-2", "crop");
    tracker.dismiss("photo-2", "crop");
    expect(tracker.isDismissed("photo-1", "repair")).toBe(false);
  });
});
