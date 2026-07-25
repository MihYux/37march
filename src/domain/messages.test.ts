import { describe, expect, it } from "vitest";
import { createRendererPreviewData } from "./preview-data";
import {
  countUnreadDeliverableMessages,
  selectDeliverableMessages,
} from "./messages";

describe("deliverable communication messages", () => {
  it("excludes drafts, rejected content and unsent approvals", () => {
    const data = createRendererPreviewData();
    const base = data.messages[0];
    const messages = [
      ...data.messages,
      {
        ...base,
        id: "draft-message",
        reviewStatus: "draft" as const,
      },
      {
        ...base,
        id: "rejected-message",
        reviewStatus: "rejected" as const,
      },
      {
        ...base,
        id: "approved-but-unsent",
        sentAt: undefined,
      },
    ];

    expect(
      selectDeliverableMessages(messages).map((message) => message.id),
    ).toEqual(["preview-message-daily", "preview-message-photo"]);
  });

  it("counts unread messages only after approval and delivery", () => {
    const data = createRendererPreviewData();

    expect(countUnreadDeliverableMessages(data.messages)).toBe(1);
  });
});
