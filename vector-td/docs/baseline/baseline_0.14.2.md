# Baseline 0.14.2-dev — 调试面板 REPL

> 状态：accepted  
> 基线版本：0.14.2-dev  
> 依赖：0.14.1-dev  
> 完成日期：2026-10-28  
> 最后更新：2026-10-29

## 1. 目标

给调试面板增加命令行 REPL 与控制台 `debug()` 入口，提升开发与验收效率；不改正常玩法。

## 2. 已交付

- 调试面板底部命令行：`help / status / gold / crystals / heal / spawn / towers / wave / kill / win / lose / god / free / skill / skills / unlock / level / speed / clear`。
- ↑/↓ 历史回溯，日志上限 120 行。
- 控制台 `debug()` 入口；调试关闭时静默返回 `null` 并提示，不弹 UI。
- 命令输入拥有键盘焦点保护：输入框打字不触发 `P` / `W` / 数字键 / `Space`；`Esc` 仍可关闭面板。
- 版本号、构建、文档、部署与线上 `BUILD 0.14.2-dev`。

## 3. 验收

- 调试模式开关、命令执行、历史回溯、焦点保护正常。
- 正常玩法无回归；手机布局无溢出。
- 线上 `BUILD 0.14.2-dev` 与资源 200 验证通过。

## 4. 备注

- 调试战斗仍不写入正式进度、星级或金币。
