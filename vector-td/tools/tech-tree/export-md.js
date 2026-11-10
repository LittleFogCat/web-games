#!/usr/bin/env node
/**
 * VECTOR 科技树 · Markdown 生成器（Node CLI）
 *
 * 读取 vector-tree.json（Skill Tree Planner 项目格式），校验并生成 Markdown。
 * 与浏览器端「导出 MD」共用 vector-export-core.js，保证输出一致。
 *
 * 用法（在仓库根目录）：
 *   node vector-td/tools/tech-tree/export-md.js --check
 *   node vector-td/tools/tech-tree/export-md.js --inject vector-td/docs/design/科技树.md
 *   node vector-td/tools/tech-tree/export-md.js --out tmp/tech-tree.md
 *   node vector-td/tools/tech-tree/export-md.js            # 打印到 stdout
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMarkdown, summarizeIssues } from "./vector-export-core.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IN = path.join(SCRIPT_DIR, "vector-tree.json");
const MARK_BEGIN = "<!-- TECH-TREE:DATA:BEGIN -->";
const MARK_END = "<!-- TECH-TREE:DATA:END -->";

function fail(message) {
  console.error("✗ " + message);
  process.exit(1);
}

function usage() {
  console.log(
    [
      "用法: node vector-td/tools/tech-tree/export-md.js [选项]",
      "",
      "  --in <file>      输入 JSON（默认 tools/tech-tree/vector-tree.json）",
      "  --check          只校验，不输出 Markdown；有错误时退出码 1",
      "  --inject <file>  把生成的数据段写入文档的两个标记之间",
      "  --out <file>     把生成的数据段写入独立文件",
      "  --quiet          不打印校验摘要",
      "  -h, --help       显示帮助",
      "",
      "节点 Meta Data 约定：branch=EXP;tier=1;type=unlock;effect=unlock.expedition",
      "货币：能量核心（写入节点的 cost_per_rank）",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = { input: DEFAULT_IN, check: false, inject: null, output: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--in") options.input = argv[++i];
    else if (arg === "--check") options.check = true;
    else if (arg === "--inject") options.inject = argv[++i];
    else if (arg === "--out") options.output = argv[++i];
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else fail("未知参数：" + arg);
  }
  return options;
}

function readProject(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    fail("读不到输入文件：" + file + "（" + err.message + "）");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail("JSON 解析失败：" + err.message);
  }
}

function injectIntoDocument(docPath, block) {
  let text;
  try {
    text = fs.readFileSync(docPath, "utf8");
  } catch (err) {
    fail("读不到目标文档：" + docPath + "（" + err.message + "）");
  }
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  if (begin === -1 || end === -1 || end < begin) {
    fail("目标文档缺少标记：" + MARK_BEGIN + " / " + MARK_END);
  }
  const head = text.slice(0, begin + MARK_BEGIN.length);
  const tail = text.slice(end);
  fs.writeFileSync(docPath, head + "\n\n" + block.trim() + "\n\n" + tail, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const project = readProject(options.input);
  const { markdown, analysis } = generateMarkdown(project);
  const { errors, warnings, infos } = summarizeIssues(analysis.issues);

  if (!options.quiet) {
    const treeParts = analysis.trees.map((entry) => entry.meta.label + " " + entry.models.length + " 节点/" + entry.cost);
    console.log(
      "[tech-tree] 树 " + analysis.trees.length + " 棵 · 节点 " + analysis.stats.nodeCount +
        " · 错误 " + errors.length + " · 提醒 " + warnings.length + " · 信息 " + infos.length
    );
    console.log("[tech-tree] " + treeParts.join("，"));
    analysis.issues
      .filter((issue) => issue.level !== "info")
      .slice(0, 20)
      .forEach((issue) => {
        console.log("  - " + (issue.level === "error" ? "错误" : "提醒") + "：" + issue.msg);
      });
  }

  if (options.check) {
    if (errors.length > 0) process.exitCode = 1;
    return;
  }

  if (options.inject) {
    injectIntoDocument(options.inject, markdown);
    if (!options.quiet) console.log("[tech-tree] 已写入 " + options.inject);
  } else if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, markdown.trim() + "\n", "utf8");
    if (!options.quiet) console.log("[tech-tree] 已写入 " + options.output);
  } else {
    process.stdout.write(markdown + "\n");
  }

  if (errors.length > 0) process.exitCode = 1;
}

main();
