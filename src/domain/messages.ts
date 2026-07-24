import type { CharacterMessage } from "./types";

export function selectDeliverableMessages(
  messages: CharacterMessage[],
): CharacterMessage[] {
  return messages
    .filter(
      (message) =>
        message.reviewStatus === "approved" &&
        Boolean(message.sentAt),
    )
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
}

export function countUnreadDeliverableMessages(
  messages: CharacterMessage[],
): number {
  return selectDeliverableMessages(messages).filter(
    (message) => !message.readAt,
  ).length;
}
