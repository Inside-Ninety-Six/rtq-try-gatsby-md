import type { Data, Parent, Root, RootContent } from "mdast";
import type { Plugin } from "unified";

export const PAPER_TABLE_DENSITIES = ["compact", "default", "roomy"] as const;
export const PAPER_TABLE_GRIDS = [
  "framed",
  "horizontal",
  "interior",
  "none",
  "rows",
  "vertical",
] as const;
export const PAPER_TABLE_CELL_ALIGNS = ["center", "left", "right"] as const;
export const PAPER_TABLE_WIDTHS = ["fit", "full"] as const;
export const PAPER_TABLE_ALIGNS = ["start", "center", "end"] as const;
export const PAPER_TABLE_COLUMN_HEADERS = ["first-row", "none"] as const;
export const PAPER_TABLE_ROW_HEADERS = ["none", "first-column"] as const;
export const PAPER_TABLE_BLANK_CORNERS = ["ruled", "open"] as const;
export const PAPER_TABLE_FIRST_COLUMN_START_PADDINGS = [
  "default",
  "none",
] as const;
export const PAPER_TABLE_INDENTS = ["none", "sm", "md"] as const;

export const PAPER_TABLE_PROP_VALUES = {
  align: PAPER_TABLE_ALIGNS,
  blankCorner: PAPER_TABLE_BLANK_CORNERS,
  cellAlign: PAPER_TABLE_CELL_ALIGNS,
  columnHeaders: PAPER_TABLE_COLUMN_HEADERS,
  density: PAPER_TABLE_DENSITIES,
  firstColumnStartPadding: PAPER_TABLE_FIRST_COLUMN_START_PADDINGS,
  grid: PAPER_TABLE_GRIDS,
  indent: PAPER_TABLE_INDENTS,
  rowHeaders: PAPER_TABLE_ROW_HEADERS,
  width: PAPER_TABLE_WIDTHS,
} as const;

export type PaperTablePropName = keyof typeof PAPER_TABLE_PROP_VALUES;
export type PaperTablePropValue<Name extends PaperTablePropName> =
  (typeof PAPER_TABLE_PROP_VALUES)[Name][number];
export type PaperTableConfig = {
  [Name in PaperTablePropName]: PaperTablePropValue<Name>;
};

export const PAPER_TABLE_DEFAULTS = {
  align: "start",
  blankCorner: "ruled",
  cellAlign: "center",
  columnHeaders: "first-row",
  density: "default",
  firstColumnStartPadding: "default",
  grid: "horizontal",
  indent: "none",
  rowHeaders: "none",
  width: "fit",
} as const satisfies PaperTableConfig;

export const PAPER_TABLE_PROP_NAMES = Object.keys(
  PAPER_TABLE_PROP_VALUES,
) as PaperTablePropName[];

type AstPoint = Readonly<{ column?: number; line?: number }>;
type AstNode = {
  attributes?: unknown[];
  children?: unknown[];
  data?: Data & Readonly<{ hProperties?: Readonly<Record<string, unknown>> }>;
  name?: unknown;
  position?: Readonly<{ start?: AstPoint }>;
  properties?: Record<string, unknown>;
  tagName?: unknown;
  type: string;
  value?: unknown;
};
type PaperTableAttribute = Readonly<{
  name: PaperTablePropName;
  node: AstNode;
  value: string;
}>;
type MarkdownFence = Readonly<{ character: "`" | "~"; length: number }>;

const MARKDOWN_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const PAPER_TABLE_TAG = /<\/?PaperTable\b[^>\r\n]*(?:>|$)/g;
const PAPER_TABLE_TOKEN = /<\/?PaperTable\b/;

function isAstNode(value: unknown): value is AstNode {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function isParent(node: AstNode): node is AstNode & Parent {
  return Array.isArray(node.children);
}

function isPaperTable(node: AstNode): boolean {
  return (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    node.name === "PaperTable"
  );
}

function isElement(node: unknown, tagName?: string): node is AstNode {
  return (
    isAstNode(node) &&
    node.type === "element" &&
    typeof node.tagName === "string" &&
    (tagName === undefined || node.tagName === tagName)
  );
}

function isTableNode(node: unknown): node is AstNode {
  return isAstNode(node) && node.type === "table";
}

function isTableCell(node: unknown): node is AstNode {
  return isAstNode(node) && node.type === "tableCell";
}

function throwPaperTableError(message: string, node: AstNode): never {
  throw Object.assign(new Error(message), {
    column: node.position?.start?.column,
    line: node.position?.start?.line,
    ruleId: "paper-table-authoring",
    source: "rtq-paper-table",
  });
}

export function isPaperTablePropName(
  value: string,
): value is PaperTablePropName {
  return Object.hasOwn(PAPER_TABLE_PROP_VALUES, value);
}

export function isPaperTablePropValue<Name extends PaperTablePropName>(
  name: Name,
  value: unknown,
): value is PaperTablePropValue<Name> {
  return (
    typeof value === "string" &&
    (PAPER_TABLE_PROP_VALUES[name] as readonly string[]).includes(value)
  );
}

function getAttributeForm(attribute: AstNode): string {
  if (attribute.type === "mdxJsxExpressionAttribute") {
    return "spread or expression attribute";
  }
  if (attribute.type !== "mdxJsxAttribute") {
    return `unsupported ${attribute.type} attribute`;
  }
  if (attribute.value === null || attribute.value === undefined) {
    return "boolean attribute";
  }
  if (typeof attribute.value === "object") {
    return "expression-valued attribute";
  }
  return `${typeof attribute.value}-valued attribute`;
}

function getPaperTableAttributes(node: AstNode): PaperTableAttribute[] {
  const attributes: PaperTableAttribute[] = [];
  const seenNames = new Set<PaperTablePropName>();

  for (const rawAttribute of node.attributes ?? []) {
    if (!isAstNode(rawAttribute)) {
      throwPaperTableError(
        `PaperTable received an unsupported attribute form; supported props: ${PAPER_TABLE_PROP_NAMES.join(", ")}.`,
        node,
      );
    }
    if (
      rawAttribute.type !== "mdxJsxAttribute" ||
      typeof rawAttribute.name !== "string"
    ) {
      throwPaperTableError(
        `PaperTable received ${getAttributeForm(rawAttribute)}; only static quoted-string props are supported: ${PAPER_TABLE_PROP_NAMES.join(", ")}.`,
        rawAttribute,
      );
    }
    if (!isPaperTablePropName(rawAttribute.name)) {
      throwPaperTableError(
        `PaperTable prop ${JSON.stringify(rawAttribute.name)} is unsupported; supported props: ${PAPER_TABLE_PROP_NAMES.join(", ")}.`,
        rawAttribute,
      );
    }

    const name = rawAttribute.name;
    if (seenNames.has(name)) {
      throwPaperTableError(
        `PaperTable prop ${JSON.stringify(name)} must be authored once; received a duplicate attribute.`,
        rawAttribute,
      );
    }
    seenNames.add(name);

    if (typeof rawAttribute.value !== "string") {
      throwPaperTableError(
        `PaperTable prop ${JSON.stringify(name)} must use a static quoted string; received ${getAttributeForm(rawAttribute)}. Allowed values: ${PAPER_TABLE_PROP_VALUES[name].join(", ")}.`,
        rawAttribute,
      );
    }
    if (!isPaperTablePropValue(name, rawAttribute.value)) {
      throwPaperTableError(
        `PaperTable prop ${JSON.stringify(name)} received ${JSON.stringify(rawAttribute.value)}; allowed values: ${PAPER_TABLE_PROP_VALUES[name].join(", ")}.`,
        rawAttribute,
      );
    }
    attributes.push({ name, node: rawAttribute, value: rawAttribute.value });
  }

  return attributes;
}

function resolvePaperTableConfig(
  attributes: readonly PaperTableAttribute[],
): PaperTableConfig {
  const authored = Object.fromEntries(
    attributes.map(({ name, value }) => [name, value]),
  ) as Partial<Record<PaperTablePropName, string>>;
  return Object.fromEntries(
    PAPER_TABLE_PROP_NAMES.map((name) => [
      name,
      authored[name] ?? PAPER_TABLE_DEFAULTS[name],
    ]),
  ) as PaperTableConfig;
}

function getOnlyDirectTable(node: AstNode): AstNode {
  const significantChildren = (node.children ?? []).filter(
    (child) =>
      !(
        isAstNode(child) &&
        child.type === "text" &&
        typeof child.value === "string" &&
        child.value.trim() === ""
      ),
  );
  if (
    significantChildren.length !== 1 ||
    !isTableNode(significantChildren[0])
  ) {
    throwPaperTableError(
      "PaperTable requires exactly one direct GFM table child.",
      node,
    );
  }
  return significantChildren[0];
}

function isEmptyAuthoredCell(node: AstNode): boolean {
  return (node.children ?? []).every(
    (child) =>
      isAstNode(child) &&
      child.type === "text" &&
      typeof child.value === "string" &&
      child.value.trim() === "",
  );
}

function validateBlankCorner(
  table: AstNode,
  config: PaperTableConfig,
  attributes: readonly PaperTableAttribute[],
  owner: AstNode,
): void {
  if (config.blankCorner !== "open") return;
  const blankCornerNode =
    attributes.find(({ name }) => name === "blankCorner")?.node ?? owner;
  if (
    config.columnHeaders !== "first-row" ||
    config.rowHeaders !== "first-column"
  ) {
    throwPaperTableError(
      'PaperTable prop "blankCorner" received "open"; open requires columnHeaders="first-row" and rowHeaders="first-column".',
      blankCornerNode,
    );
  }
  const firstRow = table.children?.[0];
  const firstCell = isAstNode(firstRow) ? firstRow.children?.[0] : undefined;
  if (!isTableCell(firstCell) || !isEmptyAuthoredCell(firstCell)) {
    throwPaperTableError(
      'PaperTable prop "blankCorner" received "open", but the first column-header cell contains authored content.',
      blankCornerNode,
    );
  }
}

function configurePaperTable(node: AstNode): AstNode {
  const attributes = getPaperTableAttributes(node);
  const config = resolvePaperTableConfig(attributes);
  const table = getOnlyDirectTable(node);
  validateBlankCorner(table, config, attributes, node);

  const existingData = table.data ?? {};
  const existingProperties = existingData.hProperties ?? {};
  table.data = {
    ...existingData,
    hProperties: {
      ...existingProperties,
      "data-align": config.align,
      "data-blank-corner": config.blankCorner,
      "data-cell-align": config.cellAlign,
      ...(attributes.some(({ name }) => name === "cellAlign")
        ? { "data-cell-align-authored": "" }
        : {}),
      "data-column-headers": config.columnHeaders,
      "data-density": config.density,
      "data-first-column-start-padding": config.firstColumnStartPadding,
      "data-grid": config.grid,
      "data-indent": config.indent,
      "data-paper-table": "",
      "data-row-headers": config.rowHeaders,
      "data-width": config.width,
    },
  };
  return table;
}

function transformPaperTableChildren(parent: AstNode & Parent): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index] as RootContent;
    if (!isAstNode(child)) continue;
    if (isPaperTable(child)) {
      const table = configurePaperTable(child);
      parent.children[index] = table as RootContent;
      if (isParent(table)) transformPaperTableChildren(table);
      continue;
    }
    if (isParent(child)) transformPaperTableChildren(child);
  }
}

export const remarkPaperTable: Plugin<[], Root> = () => (tree) => {
  transformPaperTableChildren(tree as AstNode & Parent);
};

function getDirectElement(node: AstNode, tagName: string): AstNode | undefined {
  return (node.children ?? []).find((child) => isElement(child, tagName)) as
    AstNode | undefined;
}

function getDirectElements(node: AstNode, tagName: string): AstNode[] {
  return (node.children ?? []).filter((child) =>
    isElement(child, tagName),
  ) as AstNode[];
}

function getProperties(node: AstNode): Record<string, unknown> {
  node.properties ??= {};
  return node.properties;
}

function getDataProperty(node: AstNode, name: string): unknown {
  const properties = getProperties(node);
  const camelName = `data${name
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")}`;
  return properties[`data-${name}`] ?? properties[camelName];
}

function hasDataProperty(node: AstNode, name: string): boolean {
  const properties = getProperties(node);
  const camelName = `data${name
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")}`;
  return (
    Object.hasOwn(properties, `data-${name}`) ||
    Object.hasOwn(properties, camelName)
  );
}

function deleteDataProperty(node: AstNode, name: string): void {
  const properties = getProperties(node);
  const camelName = `data${name
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")}`;
  delete properties[`data-${name}`];
  delete properties[camelName];
}

function getHeaderRow(table: AstNode): AstNode | undefined {
  const tableHead = getDirectElement(table, "thead");
  return tableHead && getDirectElement(tableHead, "tr");
}

function applyColumnHeaderSemantics(
  table: AstNode,
  columnHeaders: PaperTableConfig["columnHeaders"],
  blankCorner: PaperTableConfig["blankCorner"],
): void {
  const tableHead = getDirectElement(table, "thead");
  const headerRow = getHeaderRow(table);
  if (!tableHead || !headerRow) return;

  if (columnHeaders === "first-row") {
    for (const [index, cell] of getDirectElements(headerRow, "th").entries()) {
      if (blankCorner === "open" && index === 0) {
        delete getProperties(cell).scope;
      } else {
        getProperties(cell).scope = "col";
      }
    }
    return;
  }

  for (const cell of getDirectElements(headerRow, "th")) {
    cell.tagName = "td";
    delete getProperties(cell).scope;
  }
  const tableChildren = table.children ?? [];
  const tableHeadIndex = tableChildren.indexOf(tableHead);
  let tableBody = getDirectElement(table, "tbody");
  if (tableBody) {
    tableChildren.splice(tableHeadIndex, 1);
    tableBody.children ??= [];
    tableBody.children.unshift(headerRow);
  } else {
    tableBody = {
      children: [headerRow],
      properties: {},
      tagName: "tbody",
      type: "element",
    };
    tableChildren.splice(tableHeadIndex, 1, tableBody);
  }
}

function applyRowHeaderSemantics(
  table: AstNode,
  rowHeaders: PaperTableConfig["rowHeaders"],
): void {
  if (rowHeaders === "none") return;
  const tableBody = getDirectElement(table, "tbody");
  if (!tableBody) return;
  for (const row of getDirectElements(tableBody, "tr")) {
    const firstCell = getDirectElement(row, "td");
    if (!firstCell) continue;
    firstCell.tagName = "th";
    getProperties(firstCell).scope = "row";
  }
}

function resolvedDataValue<Name extends PaperTablePropName>(
  table: AstNode,
  name: Name,
): PaperTablePropValue<Name> {
  const propertyName = name.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`,
  );
  const value = getDataProperty(table, propertyName);
  return isPaperTablePropValue(name, value)
    ? value
    : PAPER_TABLE_DEFAULTS[name];
}

function prepareHastTable(table: AstNode): AstNode {
  const configured = hasDataProperty(table, "paper-table");
  const config = Object.fromEntries(
    PAPER_TABLE_PROP_NAMES.map((name) => [
      name,
      resolvedDataValue(table, name),
    ]),
  ) as PaperTableConfig;
  const cellAlignAuthored = hasDataProperty(table, "cell-align-authored");

  if (configured) {
    applyColumnHeaderSemantics(table, config.columnHeaders, config.blankCorner);
    applyRowHeaderSemantics(table, config.rowHeaders);
  }

  for (const name of [
    "align",
    "blank-corner",
    "cell-align",
    "cell-align-authored",
    "column-headers",
    "density",
    "first-column-start-padding",
    "grid",
    "indent",
    "paper-table",
    "row-headers",
    "width",
  ]) {
    deleteDataProperty(table, name);
  }

  return {
    children: [table],
    properties: {
      className: ["rtq-paper-table"],
      dataAlign: config.align,
      dataBlankCorner: config.blankCorner,
      dataCellAlign: config.cellAlign,
      ...(cellAlignAuthored ? { dataCellAlignAuthored: "" } : {}),
      dataDensity: config.density,
      dataFirstColumnStartPadding: config.firstColumnStartPadding,
      dataGrid: config.grid,
      dataIndent: config.indent,
      ...(configured ? { dataPaperTable: "" } : {}),
      dataWidth: config.width,
    },
    tagName: "div",
    type: "element",
  };
}

function transformHastTables(parent: AstNode): void {
  if (!Array.isArray(parent.children)) return;
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (!isAstNode(child)) continue;
    if (isElement(child, "table")) {
      transformHastTables(child);
      parent.children[index] = prepareHastTable(child);
      continue;
    }
    transformHastTables(child);
  }
}

export function rehypePaperTable() {
  return (tree: unknown): void => {
    if (isAstNode(tree)) transformHastTables(tree);
  };
}

function openingFence(value: string): MarkdownFence | undefined {
  const match = value.match(MARKDOWN_FENCE);
  return match
    ? {
        character: match[1][0] as MarkdownFence["character"],
        length: match[1].length,
      }
    : undefined;
}

function closesFence(value: string, fence: MarkdownFence): boolean {
  return new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`).test(
    value,
  );
}

export function hasActivePaperTable(markdown: string): boolean {
  const lines = markdown.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  let fence: MarkdownFence | undefined;
  for (const line of lines) {
    const content = line.replace(/\r?\n$/, "");
    if (fence) {
      if (closesFence(content, fence)) fence = undefined;
      continue;
    }
    const nextFence = openingFence(content);
    if (nextFence) {
      fence = nextFence;
    } else if (PAPER_TABLE_TOKEN.test(content)) {
      return true;
    }
  }
  return false;
}

export function stripPaperTableWrapperLines(markdown: string): string {
  const lines = markdown.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  const output: string[] = [];
  let fence: MarkdownFence | undefined;
  for (const line of lines) {
    const content = line.replace(/\r?\n$/, "");
    if (fence) {
      output.push(line);
      if (closesFence(content, fence)) fence = undefined;
      continue;
    }
    const nextFence = openingFence(content);
    if (nextFence) {
      fence = nextFence;
      output.push(line);
      continue;
    }
    const strippedContent = content.replace(PAPER_TABLE_TAG, "");
    if (strippedContent === content) {
      output.push(line);
    } else if (strippedContent.trim()) {
      output.push(`${strippedContent}${line.slice(content.length)}`);
    }
  }
  return output.join("");
}
