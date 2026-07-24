import { useEffect, useState } from "react";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { CampaignStudioPanel } from "../components/CampaignStudioPanel";
import type { CompanionData } from "../domain/types";

export function OperatorApp() {
  const api = window.releaseOperator;
  const [data, setData] = useState<CompanionData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!api) {
      setError("运营桥接不可用。请使用 npm run operator 启动内部控制台。");
      return;
    }
    api
      .getData()
      .then(setData)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [api]);

  if (!api || error) {
    return (
      <main className="operator-state">
        <WarningCircle weight="fill" />
        <h1>三月七角色发行控制台</h1>
        <p>{error || "运营桥接不可用。"}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="operator-state">
        <SpinnerGap className="spin" />
        <h1>正在加载发行控制台</h1>
      </main>
    );
  }

  return (
    <main className="operator-shell">
      <CampaignStudioPanel
        api={api}
        data={data}
        onClose={api.close}
        onDataChange={setData}
        onOpenCommunication={() => undefined}
      />
    </main>
  );
}
