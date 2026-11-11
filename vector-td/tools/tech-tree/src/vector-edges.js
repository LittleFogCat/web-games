/**
 * VECTOR 连线渲染与几何
 *
 * 能力：
 * 1. 连线从节点边缘到节点边缘（圆周边界），不穿过节点；
 * 2. 端点默认朝向对方，也可由 from_angle / to_angle 指定任意角度（拖动端点后保存）；
 * 3. 箭头由「前置」指向「后续」；
 * 4. 形状支持：贝塞尔曲线（bezier，默认）/ 直线（straight）/ 折线（polyline）；
 * 5. 描边支持：实线 / 虚线 / 点线；选中连线时显示两个可拖动的端点手柄。
 */
const SVG_NS = "http://www.w3.org/2000/svg";

export const NODE_SIZE = 100;
export const NODE_RADIUS = NODE_SIZE / 2;

const DASH = {
  solid: "",
  dashed: "10 6",
  dotted: "2 6",
};

const SHAPES = { bezier: "bezier", straight: "straight", polyline: "polyline" };

function node_center(node) {
  return { x: node.position.x + NODE_RADIUS, y: node.position.y + NODE_RADIUS };
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function point_on_edge(center, angle) {
  return {
    x: center.x + Math.cos(angle) * NODE_RADIUS,
    y: center.y + Math.sin(angle) * NODE_RADIUS,
  };
}

function to_radians(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? (number * Math.PI) / 180 : fallback;
}

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
 * 计算连线几何。
 * @param {object} from_node 前置节点
 * @param {object} to_node 后续节点
 * @param {object} connection 连线数据（shape / from_angle / to_angle）
 * @param {number} index 序号（用于默认弧度的左右交替）
 */
export function connection_geometry(from_node, to_node, connection = {}, index = 0) {
  const from_center = node_center(from_node);
  const to_center = node_center(to_node);

  const default_from_angle = Math.atan2(to_center.y - from_center.y, to_center.x - from_center.x);
  const default_to_angle = Math.atan2(from_center.y - to_center.y, from_center.x - to_center.x);
  const from_angle = to_radians(connection.from_angle, default_from_angle);
  const to_angle = to_radians(connection.to_angle, default_to_angle);

  const start = point_on_edge(from_center, from_angle);
  const end = point_on_edge(to_center, to_angle);

  const shape = SHAPES[connection.shape] || "bezier";
  const distance = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  let path_d = "";
  let tangent = normalize(end.x - start.x, end.y - start.y);

  if (shape === "straight") {
    path_d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  } else if (shape === "polyline") {
    // 折线：在中点做一个可见的折角（对齐的节点也会产生折点）
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const direction = normalize(end.x - start.x, end.y - start.y);
    const perpendicular = { x: -direction.y, y: direction.x };
    const offset = Math.min(Math.max(distance * 0.18, 16), 36) * (index % 2 === 0 ? 1 : -1);
    const bend = {
      x: mid.x + perpendicular.x * offset,
      y: mid.y + perpendicular.y * offset,
    };
    path_d = `M ${start.x} ${start.y} L ${bend.x} ${bend.y} L ${end.x} ${end.y}`;
    tangent = normalize(end.x - bend.x, end.y - bend.y);
  } else {
    // 贝塞尔：控制点沿两端切线方向伸出，再加一点交替弧度避免重叠
    const reach = Math.min(Math.max(distance * 0.35, 40), 140);
    const direction = normalize(end.x - start.x, end.y - start.y);
    const perpendicular = { x: -direction.y, y: direction.x };
    const curve = distance > NODE_SIZE ? Math.min(distance * 0.1, 44) * (index % 2 === 0 ? 1 : -1) : 0;
    const ctrl1 = {
      x: start.x + Math.cos(from_angle) * reach + perpendicular.x * curve,
      y: start.y + Math.sin(from_angle) * reach + perpendicular.y * curve,
    };
    const ctrl2 = {
      x: end.x + Math.cos(to_angle) * reach + perpendicular.x * curve,
      y: end.y + Math.sin(to_angle) * reach + perpendicular.y * curve,
    };
    path_d = `M ${start.x} ${start.y} C ${ctrl1.x} ${ctrl1.y}, ${ctrl2.x} ${ctrl2.y}, ${end.x} ${end.y}`;
    tangent = normalize(end.x - ctrl2.x, end.y - ctrl2.y);
  }

  // 起终点重合时给一个稳定的切线
  if (!Number.isFinite(tangent.x) || (tangent.x === 0 && tangent.y === 0)) {
    tangent = { x: 0, y: 1 };
  }

  return {
    start,
    end,
    path_d,
    arrow_points: arrow_polygon(end, tangent),
    shape,
  };
}

/**
 * 创建连线 SVG 组：命中区 + 可见线 + 箭头（选中时加端点手柄）。
 * @param {object} connection 连线数据
 * @param {object} from_node 前置节点
 * @param {object} to_node 后续节点
 * @param {{satisfied:boolean, selected:boolean, index:number}} options
 */
export function create_connection_element(connection, from_node, to_node, options = {}) {
  const geometry = connection_geometry(from_node, to_node, connection, options.index || 0);
  const stroke_style =
    connection.style && DASH[connection.style] !== undefined ? connection.style : "solid";

  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("connection_group");
  group.dataset.connection_id = connection.id;
  group.classList.add("style-" + stroke_style);
  group.classList.add("shape-" + geometry.shape);

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

  const dash = DASH[stroke_style];
  if (dash) path.setAttribute("stroke-dasharray", dash);

  return group;
}

/**
 * 创建一条连线的两个端点手柄（放在独立顶层 SVG 中，避免被节点遮挡）。
 */
export function create_endpoint_handles(connection, from_node, to_node, index = 0) {
  const geometry = connection_geometry(from_node, to_node, connection, index);
  return [
    { end: "from", point: geometry.start },
    { end: "to", point: geometry.end },
  ].map((item) => {
    const handle = document.createElementNS(SVG_NS, "circle");
    handle.setAttribute("cx", item.point.x);
    handle.setAttribute("cy", item.point.y);
    handle.setAttribute("r", 7);
    handle.setAttribute("class", "connection_endpoint");
    handle.dataset.connection_id = connection.id;
    handle.dataset.end = item.end;
    handle.setAttribute("data-tip", item.end === "from" ? "拖动：调整前置端点位置" : "拖动：调整后续端点位置");
    return handle;
  });
}
