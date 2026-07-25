import type { CompanionData } from "./types";

export type PetActivityState =
  | "idle"
  | "photo"
  | "sleepy"
  | "looking"
  | "new-message"
  | "memory";

export interface PetActivity {
  state: PetActivityState;
  label: string;
  quiet: boolean;
  detail: string;
}

export interface PetActivityInput {
  data: CompanionData | null;
  now?: Date;
  pendingPhoto: boolean;
  albumOpen: boolean;
  unreadMessages: number;
}

function parseClock(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minuteInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(
    parts.find((part) => part.type === "hour")?.value ?? 0,
  );
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hour * 60 + minute;
}

export function isQuietMinute(
  minute: number,
  startClock: string,
  endClock: string,
) {
  const start = parseClock(startClock);
  const end = parseClock(endClock);
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

export function derivePetActivity({
  data,
  now = new Date(),
  pendingPhoto,
  albumOpen,
  unreadMessages,
}: PetActivityInput): PetActivity {
  const paused = data?.relationship.paused === true;
  const quietBySchedule = data
    ? isQuietMinute(
        minuteInTimeZone(now, data.profile.timeZone),
        data.profile.quietHours.start,
        data.profile.quietHours.end,
      )
    : false;
  const quiet = paused || quietBySchedule;

  if (pendingPhoto) {
    return {
      state: "photo",
      label: "照片待收藏",
      quiet,
      detail: "刚拍好的照片可以收进共同相册",
    };
  }
  if (albumOpen) {
    return {
      state: "memory",
      label: "翻看记忆",
      quiet,
      detail: "正在一起翻共同相册",
    };
  }
  if (quiet) {
    return {
      state: "sleepy",
      label: paused ? "同行已暂停" : "勿扰时间",
      quiet: true,
      detail: paused
        ? "角色同行已暂停，不会主动联系"
        : "当前处于你设置的勿扰时段",
    };
  }
  if (unreadMessages > 0) {
    return {
      state: "new-message",
      label: `${unreadMessages} 封新通信`,
      quiet,
      detail: "通信中心有尚未读过的角色消息",
    };
  }

  const activityBucket = Math.floor(now.getTime() / 60_000) % 4;
  if (activityBucket === 1) {
    return {
      state: "looking",
      label: "四处看看",
      quiet: false,
      detail: "三月七正在观察桌面上的新鲜事",
    };
  }
  return {
    state: "idle",
    label: "陪伴中",
    quiet: false,
    detail: "三月七正在桌面上安静陪着你",
  };
}
