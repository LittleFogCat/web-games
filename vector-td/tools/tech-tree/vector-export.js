/**
 * VECTOR 科技树 · 浏览器导出插件
 *
 * 在编辑器工具栏注入「导出 MD」按钮：
 * 读取主程序写入 localStorage 的当前项目 → 生成 Markdown → 下载 .md 文件。
 * 与 Node CLI 共用 vector-export-core.js。
 */
import { generateMarkdown, summarizeIssues } from "./vector-export-core.js";

(function () {
  "use strict";

  const STORAGE_KEY = "vector_tech_tree_planner_v1";

  function read_project() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      raw = null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data && data.project) return data;
      return { project: data };
    } catch (err) {
      console.error("[VECTOR] 读取本地项目失败", err);
      return null;
    }
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  let toastTimer = null;
  function toast(message, is_error) {
    let el = document.getElementById("vector_toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "vector_toast";
      el.className = "vector_toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle("is-error", !!is_error);
    el.classList.add("show");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  function export_markdown() {
    try {
      const project = read_project();
      if (!project || !Array.isArray(project.project && project.project.trees)) {
        toast("没有可导出的科技树：先在编辑器里新建或「载入初稿」", true);
        return;
      }
      const { markdown, analysis } = generateMarkdown(project);
      const { errors, warnings } = summarizeIssues(analysis.issues);
      if (errors.length > 0) {
        const ok = window.confirm(
          "当前结构有 " + errors.length + " 个错误（导出文件的「校验」一节会列出）。\n仍要导出吗？"
        );
        if (!ok) return;
      }
      const now = new Date();
      const stamp =
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        "-" +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0");
      download("科技树-" + stamp + ".md", markdown);
      toast(
        "已导出 Markdown：" + analysis.stats.nodeCount + " 节点 · " + analysis.trees.length + " 棵树" +
          (errors.length ? "（含 " + errors.length + " 个错误）" : warnings.length ? "（" + warnings.length + " 条提醒）" : "")
      );
    } catch (err) {
      console.error("[VECTOR] 导出 Markdown 失败", err);
      toast("导出失败：" + err.message, true);
    }
  }

  function bind() {
    const actions = document.querySelector(".toolbar_actions");
    if (!actions) {
      window.setTimeout(bind, 300);
      return;
    }
    if (document.getElementById("btn_export_md")) return;
    const button = document.createElement("button");
    button.id = "btn_export_md";
    button.type = "button";
    button.className = "btn btn_secondary";
    button.title = "把当前科技树导出为 Markdown 文件（总览 / 每棵树节点表 / 效果字典 / 校验）";
    button.textContent = "导出 MD";
    button.addEventListener("click", export_markdown);
    actions.appendChild(button);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
