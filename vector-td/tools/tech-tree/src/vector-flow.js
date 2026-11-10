/**
 * VECTOR 流程图式交互：节点四边连接点
 *
 * - 从节点四边的圆点拖到空白处：创建新节点并连线（当前节点 → 新节点）；
 * - 从圆点拖到另一个节点：建立「当前节点 → 目标节点」依赖；
 * - 节点本体拖拽仍然是移动位置，空白拖拽仍然是平移画布。
 *
 * 由 renderer.js 挂载圆点、interactions.js 绑定拖拽逻辑，避免大改上游布局代码。
 */
import { find_node } from "./state.js";
import * as actions from "./actions.js";

export const FLOW_HANDLES = [
  { side: "top", label: "拖出新节点（后续节点），或拖到另一个节点上连线" },
  { side: "right", label: "拖出新节点（后续节点），或拖到另一个节点上连线" },
  { side: "bottom", label: "拖出新节点（后续节点），或拖到另一个节点上连线" },
  { side: "left", label: "拖出新节点（后续节点），或拖到另一个节点上连线" },
];

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD = 6;

/**
 * 给节点元素挂四个连接点（只在编辑模式调用）。
 * @param {object} node 节点数据
 * @param {HTMLElement} element 节点 DOM
 */
export function decorate_node_element(node, element) {
  if (!element || element.querySelector(".flow_handle")) return;
  FLOW_HANDLES.forEach((handle) => {
    const dot = document.createElement("span");
    dot.className = "flow_handle flow_handle_" + handle.side;
    dot.dataset.flow_node = node.id;
    dot.title = handle.label;
    dot.setAttribute("aria-hidden", "true");
    element.appendChild(dot);
  });
}

/**
 * 给新建节点自动补一份 VECTOR 元数据（branch/tier/type），避免整棵树校验时缺字段。
 * 只做保守推导：源节点有 tier 才推导层级，效果键留空待填。
 */
function build_metadata(tree, source_node) {
  const parse = (raw) => {
    const out = {};
    String(raw || "").split(";").forEach((part) => {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    });
    return out;
  };
  const source_meta = parse(source_node && source_node.metadata);
  const tree_prefix = String(tree.id || "").split("_")[0].toUpperCase();
  const branch = (source_meta.branch || tree_prefix || "??").toUpperCase();
  const source_tier = parseInt(source_meta.tier, 10);
  const tier = Number.isInteger(source_tier) ? source_tier + 1 : "";
  const type = source_meta.type || (tree.id === "fleet_tree" ? "unlock" : "rule");
  return "branch=" + branch + (tier === "" ? "" : ";tier=" + tier) + ";type=" + type + ";effect=";
}

/**
 * 绑定连接点拖拽：拖到空白新建节点，拖到节点直接连线。
 */
export function setup_flow_handles(get_state, dispatch, elements) {
  const container = elements.canvas_container;
  const temp_layer = elements.temp_connection_layer;
  let drag = null;
  let temp_line = null;
  let hover_element = null;

  function event_point(event) {
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function clear_hover() {
    if (hover_element) {
      hover_element.classList.remove("flow_target");
      hover_element = null;
    }
  }

  function stop_drag() {
    if (!drag) return;
    if (temp_line) {
      temp_line.remove();
      temp_line = null;
    }
    const source = document.querySelector('.skill_node[data-node_id="' + drag.from_id + '"]');
    if (source) source.classList.remove("flow_active");
    clear_hover();
    drag = null;
    document.body.classList.remove("flow_dragging");
  }

  function connect(tree_id, from_node_id, to_node_id) {
    if (!from_node_id || !to_node_id || from_node_id === to_node_id) return;
    dispatch(actions.add_connection, tree_id, {
      from_node_id: from_node_id,
      to_node_id: to_node_id,
      logic: "AND",
      required_rank: 1,
    });
  }

  function finish(event) {
    if (!drag) return;
    const current = drag;
    const state = get_state();
    const tree_id = state.ui_state.active_tree_id;
    const target_el = document.elementFromPoint(event.clientX, event.clientY);
    const target_node_el = target_el ? target_el.closest(".skill_node") : null;
    const target_id = target_node_el ? target_node_el.dataset.node_id : null;
    stop_drag();
    if (!tree_id) return;

    // 拖到另一个节点：当前节点 → 目标节点
    if (target_id && target_id !== current.from_id) {
      connect(tree_id, current.from_id, target_id);
      return;
    }

    // 拖回自己 / 未产生位移：忽略
    if (target_id === current.from_id || !current.moved) return;

    // 拖到空白：在落点新建节点并连线
    const rect = container.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) return;

    const viewport = state.ui_state.viewport;
    const world_x = Math.max(0, (event.clientX - rect.left - viewport.x) / viewport.zoom);
    const world_y = Math.max(0, (event.clientY - rect.top - viewport.y) / viewport.zoom);

    dispatch(actions.add_node, tree_id, {
      name: "新技能",
      x: world_x,
      y: world_y,
      max_rank: 1,
      cost_per_rank: [1],
      type: "passive",
    });

    const after = get_state();
    const new_id = after.ui_state.selected_node_id;
    if (!new_id) return;
    connect(tree_id, current.from_id, new_id);

    // VECTOR: 自动补 branch/tier/type，减少后续手工填写
    const final_state = get_state();
    const final_tree = final_state.project.trees.find((item) => item.id === tree_id);
    const source_node = final_tree ? final_tree.nodes.find((item) => item.id === current.from_id) : null;
    if (final_tree) {
      dispatch(actions.update_node, tree_id, new_id, {
        metadata: build_metadata(final_tree, source_node),
      });
    }
  }

  // 捕获阶段优先处理连接点，避免触发节点拖动 / 画布平移
  elements.nodes_layer.addEventListener(
    "mousedown",
    (event) => {
      const handle = event.target.closest(".flow_handle");
      if (!handle) return;
      const state = get_state();
      if (state.ui_state.mode !== "edit") return;
      if (event.button !== 0) return;
      const node_el = handle.closest(".skill_node");
      if (!node_el) return;
      const node = find_node(state, state.ui_state.active_tree_id, node_el.dataset.node_id);
      if (!node) return;

      event.preventDefault();
      event.stopPropagation();

      const point = event_point(event);
      drag = {
        from_id: node.id,
        start: point,
        moved: false,
        start_client: { x: event.clientX, y: event.clientY },
      };

      temp_line = document.createElementNS(SVG_NS, "line");
      temp_line.setAttribute("x1", point.x);
      temp_line.setAttribute("y1", point.y);
      temp_line.setAttribute("x2", point.x);
      temp_line.setAttribute("y2", point.y);
      temp_line.setAttribute("class", "flow_temp_line");
      temp_layer.appendChild(temp_line);
      node_el.classList.add("flow_active");
      document.body.classList.add("flow_dragging");
    },
    true,
  );

  document.addEventListener("mousemove", (event) => {
    if (!drag) return;
    const moved =
      Math.abs(event.clientX - drag.start_client.x) > DRAG_THRESHOLD ||
      Math.abs(event.clientY - drag.start_client.y) > DRAG_THRESHOLD;
    if (moved) drag.moved = true;
    if (!temp_line) return;
    const point = event_point(event);
    temp_line.setAttribute("x2", point.x);
    temp_line.setAttribute("y2", point.y);

    // 高亮可连接的节点
    const target_el = document.elementFromPoint(event.clientX, event.clientY);
    const node_el = target_el ? target_el.closest(".skill_node") : null;
    clear_hover();
    if (node_el && node_el.dataset.node_id !== drag.from_id) {
      node_el.classList.add("flow_target");
      hover_element = node_el;
    }
  });

  document.addEventListener("mouseup", (event) => {
    if (!drag) return;
    finish(event);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drag) stop_drag();
  });
}
