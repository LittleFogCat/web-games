/**
 * VECTOR 科技树编辑器 · 初稿加载器
 *
 * 仅内部设计工具使用，不随游戏发布：
 * 1. 首次打开（无本地存档）时自动载入 vector-tree.json；
 * 2. 顶部「载入初稿」按钮可随时用初稿覆盖当前项目（二次确认）；
 * 3. 导入后自动「适应视图」（等价于点击工具栏的 Zoom to Fit）。
 *
 * 依赖主程序（src/main.js）已注册的 import_project 自定义事件。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "vector_tech_tree_planner_v1";
  const STARTER_URL = "vector-tree.json";
  let loading = false;

  async function loadStarter(confirm_first) {
    if (loading) return;
    if (confirm_first) {
      const ok = window.confirm(
        "用 vector-tree.json 覆盖当前项目？\n当前未导出的改动会丢失。"
      );
      if (!ok) return;
    }
    loading = true;
    try {
      const res = await fetch(STARTER_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      window.dispatchEvent(new CustomEvent("import_project", { detail: data }));
      window.setTimeout(function () {
        const fit = document.getElementById("btn_zoom_fit");
        if (fit) fit.click();
      }, 350);
      console.info("[VECTOR] 已载入初稿 vector-tree.json");
    } catch (err) {
      console.error("[VECTOR] 载入初稿失败", err);
      window.alert(
        "载入初稿失败：" + err.message + "\n请用 Import 手动导入 vector-tree.json。"
      );
    } finally {
      loading = false;
    }
  }


  /** 判断本地存档里是否已有可用项目（至少一棵树）。 */
  function has_usable_project() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const project = data && data.project ? data.project : data;
      return !!(project && Array.isArray(project.trees) && project.trees.length > 0);
    } catch (err) {
      return false;
    }
  }

  function bind() {
    const btn = document.getElementById("btn_load_vector_tree");
    if (btn) {
      btn.addEventListener("click", function () {
        loadStarter(true);
      });
    }
    // 主程序初始化时会立刻写入一份空存档，因此以“项目里是否已有树”判定，
    // 只有空项目才自动载入初稿，避免覆盖使用者已编辑的版本。
    if (!has_usable_project()) loadStarter(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
