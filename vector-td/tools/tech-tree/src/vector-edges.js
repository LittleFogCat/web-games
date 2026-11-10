/**
 * VECTOR 连线渲染与几何
 *
 * 目标：
 * 1. 连线从节点边缘到节点边缘（不穿过圆形节点）；
 * 2. 端点位置按「朝向对方」自动落在圆周上，因此可以位于节点边缘任意角度；
 * 3. 箭头从「前置」指向「后续」；
 * 4. 支持实线 / 虚线 / 点线三种格式与选中高亮。
 */
const SVG_NS = "http://www.w3.org/2000/svg";

export const NODE_SIZE = 100;
export const NODE_RADIUS = NODE_SIZE / 2;

const STYLE_DASH = {
  solid: "",
  dashed: "10 6",
  dotted: "2 6",
};

function node_center(node) {
  return {
    x: node.position.x + NODE_RADIUS,
    y: node.position.y + NODE_RADIUS,
  };
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * 计算一条连线的几何：起点、终点、贝塞尔路径、箭头多边形。
 * 起点/终点都落在节点圆周上，所以不会穿过节点。
 * @param {object} from_node 前置节点
 * @param {object} to_node 后续节点
 * @param {number} index 连线序号（用于左右交替的轻微弧度，避免重叠）
 */
export function connection_geometry(from_node, to_node, index = 0) {
  const from_center = node_center(from_node);
  const to_center = node_center(to_node);

  let dx = to_center.x - from_center.x;
  let dy = to_center.y - from_center.y;
  if (Math.hypot(dx, dy) < 1) {
    dx = 0;
    dy = 1;
  }
  const direction = normalize(dx, dy);
  const perpendicular = { x: -direction.y, y: direction.x };
  const distance = Math.hypot(dx, dy);

  // 端点落在圆周上
  const start = {
    x: from_center.x + direction.x * NODE_RADIUS,
    y: from_center.y + direction.y * NODE_RADIUS,
  };
  const end = {
    x: to_center.x - direction.x * NODE_RADIUS,
    y: to_center.y - direction.y * NODE_RADIUS,
  };

  // 轻微弧度，按序号左右交替；距离太短时收敛为直线
  const curve = distance > NODE_SIZE ? Math.min(distance * 0.14, 52) : 0;
  const sign = index % 2 === 0 ? 1 : -1;
  const control = {
    x: (start.x + end.x) / 2 + perpendicular.x * curve * sign,
    y: (start.y + end.y) / 2 + perpendicular.y * curve * sign,
  };

  const path_d =
    curve === 0
      ? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;

  // 箭头：沿曲线末端的切线方向
  const tangent = normalize(end.x - control.x, end.y - control.y);
  const arrow = arrow_polygon(end, tangent);

  return {
    start,
    end,
    control,
    path_d,
    arrow_points: arrow,
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

/**
 * 生成指向切线的箭头三角形顶点字符串。
 */
function arrow_polygon(tip, tangent) {
  const size = 12;
  const half_width = 5.5;
  const base = {
    x: tip.x - tangent.x * size,
    y: tip.y - tangent.y * size,
  };
  const perpendicular = { x: -tangent.y, y: tangent.x };
  const left = {
    x: base.x + perpendicular.x * half_width,
    y: base.y + perpendicular.y * half_width,
  };
  const right = {
    x: base.x - perpendicular.x * half_width,
    y: base.y - perpendicular.y * half_width,
  };
  return [tip, left, right].map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * 创建一个连线 SVG 组：命中区域 + 可见线 + 箭头。
 * @param {object} connection 连线数据（含 id / style）
 * @param {object} from_node 前置节点
 * @param {object} to_node 后续节点
 * @param {{satisfied:boolean, selected:boolean, index:number}} options
 */
export function create_connection_element(connection, from_node, to_node, options = {}) {
  const geometry = connection_geometry(from_node, to_node, options.index || 0);
  const style = connection.style && STYLE_DASH[connection.style] !== undefined ? connection.style : "solid";

  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("connection_group");
  group.dataset.connection_id = connection.id;
  group.classList.add("style-" + style);

  const state_class = options.satisfied ? "active" : "locked";
  if (options.selected) group.classList.add("selected");

  const hit = document.createElementNS(SVG_NS, "path");
  hit.setAttribute("d", geometry.path_d);
  hit.setAttribute("class", "connection_hit");
  group.appendChild(hit);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", geometry.path_d);
  path.setAttribute("class", "connection_path " + state_class);
  group.appendChild(path);

  const arrow = document.createElementNS(SVG_NS, "polygon");
  arrow.setAttribute("points", geometry.arrow_points);
  arrow.setAttribute("class", "connection_arrow " + state_class);
  group.appendChild(arrow);

  // 虚线 / 点线：作用在可见线与箭头上（箭头默认实心）
  const dash = STYLE_DASH[style];
  if (dash) {
    path.setAttribute("stroke-dasharray", dash);
  }

  return group;
}
