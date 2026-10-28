# Baseline 0.14.3-dev — 补丁线收尾

> 状态：accepted  
> 基线版本：0.14.3-dev  
> 依赖：0.14.2-dev（调试 REPL）  
> 计划周期：收尾  
> 最后更新：2026-10-29

## 1. 目标

把 0.14.x 补丁线收尾：版本号、构建产物、文档与部署记录一致；不引入新玩法。

## 2. 范围

- 版本号 `0.14.3-dev` 同步到 `index.html`、`styles.css?v=`、`src/*.js?v=`、`README`、`AGENTS`、`dist/`。
- 调试面板字号可读性放大（标题 12px / 按钮 11.5px / 命令行 13px，面板 380px）并同步 `screenshots/home.png`。
- 生成 `release/vector-td-v0.14.3-dev-static.zip` 与 `.sha256`。
- 更新 `docs/deployment.md` 的线上记录；部署并验证 `BUILD 0.14.3-dev`。
- 回归 0.14.1 / 0.14.2 的功能：平衡修正、小行星可见性、灯塔升阶、调试 REPL、移动端布局。
- 检查 UTF-8：`index.html` 等文件无 `U+FFFD`。

## 3. 不包含

- 矢量反应、超载、新模式、新地图、新塔、天赋、光环、升阶、融合。

## 4. 验收标准

- `BUILD 0.14.3-dev` 在本地与线上一致；`dist/` 与 release 包一致。
- 0.14.1 / 0.14.2 已交付功能无回归。
- 320×568 / 390×667 / 390×844 无横向溢出。
- 控制台无错误；无 `U+FFFD`。
- 部署前备份、staging 校验、部署后公网 BUILD 验证完成。

## 5. 完成记录

- [x] 版本号与构建产物同步
- [x] release 包与 SHA-256（`1cf75e42fc9ca217664312dd21f7244cd455dd1d7ddc372cef85fd292101ccd3`）
- [x] 部署与线上验证（备份 `vector-td-20261029-012310.tar.gz`；公网 `BUILD 0.14.3-dev`，page/css/app 200）
- [x] 回归通过（Playwright 15 项：REPL / spawn / god / canvas 等宽 / 320·390×667·390×844 无溢出 / 无控制台错误 / 生产环境静默）
- [x] 标记 accepted（2026-10-29）
