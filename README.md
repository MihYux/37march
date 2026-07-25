# 三月七共生式角色发行系统

这是 `MihYux/desktop-march-7th` 的最新角色发行功能包，包含：

- 可运行的三月七桌宠与 DeepSeek 对话。
- 分层自主记忆和最近 10 轮聊天上下文。
- 区域发行方案上传、灰度设置、发布与示例发布。
- 发行方案到三月七桌宠的本地投递闭环。
- 三月七共生式发行执行 Skill。
- 玩家可见内容零泄漏保护。
- 发行效果模拟图表和关系健康评估。

## 内容

- [`feature-files/`](./feature-files)：涉及功能的完整文件，保持原项目目录结构。
- [`patches/`](./patches)：可按顺序应用到原项目的 Git 补丁。
- [`更新文档.md`](./更新文档.md)：最新版能力、架构和验证结果。
- [`合并指南.md`](./合并指南.md)：补丁及按文件合并方式。

## 推荐合并方式

在 `desktop-march-7th` 的目标分支中执行：

```bash
git am /path/to/37march/patches/*.patch
npm install
npm run check
npm run all
```

当前功能包对应源提交：

- `7e69fbc`：受控角色发行系统基础能力。
- `4a9e980`：共生式发行工作流、执行 Skill、分层记忆、零泄漏保护和 UI 重构。

当前验证结果：115 项自动化测试通过，TypeScript/Vite 生产构建、36/36 原型验收及发布审计通过。
