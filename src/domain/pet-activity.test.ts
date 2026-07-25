import { describe, expect, it } from "vitest";
import { createRendererPreviewData } from "./preview-data";
import {
  derivePetActivity,
  isQuietMinute,
  minuteInTimeZone,
} from "./pet-activity";

describe("pet activity", () => {
  it("handles quiet hours that cross midnight", () => {
    expect(isQuietMinute(23 * 60, "22:00", "08:00")).toBe(true);
    expect(isQuietMinute(7 * 60 + 59, "22:00", "08:00")).toBe(true);
    expect(isQuietMinute(12 * 60, "22:00", "08:00")).toBe(false);
  });

  it("evaluates the player's configured time zone", () => {
    expect(
      minuteInTimeZone(
        new Date("2026-07-24T00:30:00.000Z"),
        "Asia/Shanghai",
      ),
    ).toBe(8 * 60 + 30);
  });

  it("prioritizes visible actions over background status", () => {
    const data = createRendererPreviewData();
    data.relationship.paused = true;
    expect(
      derivePetActivity({
        data,
        now: new Date("2026-07-24T04:00:00.000Z"),
        pendingPhoto: true,
        albumOpen: false,
        unreadMessages: 3,
      }),
    ).toMatchObject({
      state: "photo",
      quiet: true,
    });
  });

  it("shows unread communication and paused states", () => {
    const data = createRendererPreviewData();
    data.campaigns = [];
    data.profile.quietHours = {
      start: "23:00",
      end: "23:30",
    };
    expect(
      derivePetActivity({
        data,
        now: new Date("2026-07-24T04:00:00.000Z"),
        pendingPhoto: false,
        albumOpen: false,
        unreadMessages: 2,
      }).state,
    ).toBe("new-message");

    data.relationship.paused = true;
    expect(
      derivePetActivity({
        data,
        now: new Date("2026-07-24T04:00:00.000Z"),
        pendingPhoto: false,
        albumOpen: false,
        unreadMessages: 0,
      }),
    ).toMatchObject({
      state: "sleepy",
      quiet: true,
      label: "同行已暂停",
    });
  });

  it("shows pause before unread communication", () => {
    const data = createRendererPreviewData();
    data.relationship.paused = true;
    expect(
      derivePetActivity({
        data,
        now: new Date("2026-07-24T04:00:00.000Z"),
        pendingPhoto: false,
        albumOpen: false,
        unreadMessages: 4,
      }),
    ).toMatchObject({
      state: "sleepy",
      label: "同行已暂停",
      quiet: true,
    });
  });
});
