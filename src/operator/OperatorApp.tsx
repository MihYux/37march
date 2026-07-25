import { useEffect, useState } from "react";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { ReleaseConsole } from "../components/ReleaseConsole";
import type { ReleaseWorkspaceSnapshot } from "./release-types";

export function OperatorApp() {
  const api = window.releaseOperator;
  const [data, setData] = useState<ReleaseWorkspaceSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!api) {
      setError("发行控制台桥接不可用，请使用 npm run operator 启动。");
      return;
    }
    api.getSnapshot().then(setData).catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [api]);

  if (!api || error) {
    return <main className="operator-state"><WarningCircle weight="fill" /><h1>三月七共生式发行控制台</h1><p>{error}</p></main>;
  }
  if (!data) {
    return <main className="operator-state"><SpinnerGap className="spin" /><h1>正在加载发行工作区</h1></main>;
  }
  return <ReleaseConsole api={api} data={data} onChange={setData} />;
}
