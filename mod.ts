import {
  type ClassPropertyDef,
  type Declaration,
  doc,
  type InterfacePropertyDef,
  type LiteralPropertyDef,
  type TsTypeArrayDef,
  type TsTypeDef,
  type TsTypeDefLiteral,
  type TsTypeFnOrConstructorDef,
  type TsTypeKeywordDef,
  type TsTypeParenthesizedDef,
  type TsTypeTupleDef,
  type TsTypeTypeLiteralDef,
  type TsTypeTypeOperatorDef,
  type TsTypeTypeRefDef,
  type TsTypeUnionDef,
} from "jsr:@deno/doc@0.198.0";

type Type =
  | "any"
  | "object"
  | "record"
  | "array"
  | "string"
  | "union"
  | "boolean"
  | "function"
  | "number"
  | "undefined"
  | "null"
  | "enum";

interface TypeDef {
  type: Type;
  typeName?: string;
  children?: NodeType | NodeType[] | Record<string, NodeType>;
}
interface TypeProps {
  required?: boolean;
  [key: string]: unknown;
}
export interface NodeType extends TypeDef, TypeProps {}

interface Options {
  // deno-lint-ignore no-explicit-any
  defaults?: any;
  private?: boolean;
  maxDepth?: number;
}

interface Status extends Options {
  url: string;
  depth: number;
}

export default async function analyze(url: string, options: Options = {}) {
  const status = {
    url,
    depth: 0,
    cache: new Map(),
    ...options,
  };

  const records = await doc([url]);
  const symbols = records[url].symbols;

  const schema: Record<string, NodeType> = {};

  for (const symbol of symbols) {
    const name = symbol.name;
    // Only exported interfaces
    const declaration = symbol.declarations.find((d) =>
      d.declarationKind === "export" && d.kind === "interface"
    );

    if (declaration) {
      schema[name] = await typeInterface(name, declaration, status);
    }
  }

  return schema;
}

async function typeAll(
  node: TsTypeDef,
  status: Status,
): Promise<NodeType> {
  switch (node.kind) {
    case "typeRef":
      return await typeRef(node, status);
    case "union":
      return await typeUnion(node, status);
    case "array":
      return await typeArray(node, status);
    case "tuple":
      return await typeTuple(node, status);
    case "literal":
      return typeLiteral(node, status);
    case "typeLiteral":
      return await typeLiteralObject(node, status);
    case "typeOperator":
      return await typeOperator(node, status);
    case "keyword":
      return typeKeyword(node, status);
    case "fnOrConstructor":
      return typefnOrConstructor(node, status);
    case "parenthesized":
      return await typeParenthesized(node, status);
    case "mapped":
      return { type: "object" };
    case "indexedAccess":
    case "intersection":
    case "importType":
      return { type: "any" };
    default:
      throw new Error(`Unhandled node kind "${node.kind}"`);
  }
}

async function children(
  properties: (InterfacePropertyDef | LiteralPropertyDef | ClassPropertyDef)[],
  status: Status,
): Promise<Record<string, NodeType> | undefined> {
  if (status.depth >= status.maxDepth!) {
    return;
  }

  status.depth++;
  const children: Record<string, NodeType> = {};

  for (const property of properties) {
    const { name, tsType } = property;

    if (!tsType) {
      continue;
    }

    children[name] = await typeAll(tsType, status);
  }
  status.depth--;
  return children;
}

async function typeInterface(
  name: string,
  declaration: Declaration,
  status: Status,
): Promise<NodeType> {
  // @ts-ignore declaration.def is not defined
  const properties = declaration.def.properties;

  return {
    type: "object",
    children: await children(properties, status),
    typeName: name,
  };
}

async function typeLiteralObject(
  node: TsTypeTypeLiteralDef,
  status: Status,
): Promise<NodeType> {
  return {
    type: "object",
    children: await children(node.value.properties ?? [], status),
  };
}

async function typeParenthesized(
  node: TsTypeParenthesizedDef,
  status: Status,
): Promise<NodeType> {
  return await typeAll(node.value, status);
}

async function typeOperator(
  node: TsTypeTypeOperatorDef,
  status: Status,
): Promise<NodeType> {
  const { operator, tsType } = node.value;
  const type = await typeAll(tsType, status);
  switch (operator) {
    case "readonly":
      type.readonly = true;
      break;
    default:
      throw new Error(`Unhandled operator kind "${operator}"`);
  }
  return type;
}

async function typeRef(
  node: TsTypeTypeRefDef,
  status: Status,
): Promise<NodeType> {
  // Partial is a special case
  switch (node.repr) {
    case "Partial": {
      const type = node.value.typeParams?.[0];

      if (!type) {
        throw new Error(`Partial type "${node.repr}" not found`);
      }

      return await typeAll(type, status);
    }
    case "Record": {
      const [key, value] = node.value.typeParams ?? [];

      if (!value) {
        throw new Error(`Record type "${value}" not found`);
      }

      return {
        type: "record",
        children: {
          key: await typeAll(key, status),
          value: await typeAll(value, status),
        },
      };
    }
  }

  return {
    type: "object",
    typeName: node.repr,
  };
}

async function typeUnion(
  node: TsTypeUnionDef,
  status: Status,
): Promise<NodeType> {
  return {
    type: "union",
    children: await Promise.all(node.value.map((t) => typeAll(t, status))),
  };
}

async function typeArray(
  node: TsTypeArrayDef,
  status: Status,
): Promise<NodeType> {
  return {
    type: "array",
    children: await typeAll(node.value, status),
  };
}

async function typeTuple(
  node: TsTypeTupleDef,
  status: Status,
): Promise<NodeType> {
  return {
    type: "array",
    children: await Promise.all(
      node.value.map((node) => typeAll(node, status)),
    ),
  };
}

function typeLiteral(node: TsTypeDefLiteral, _status: Status): NodeType {
  switch (node.value.kind) {
    case "string":
      return {
        type: node.value.kind,
        value: node.value.string,
      };
    case "boolean":
      return {
        type: node.value.kind,
      };
    case "number":
      return {
        type: node.value.kind,
        value: node.value.number,
      };
    default:
      throw new Error(`Unhandled literal kind "${node.value.kind}"`);
  }
}

function typeKeyword(keyword: TsTypeKeywordDef, _status: Status): NodeType {
  switch (keyword.value) {
    case "string":
    case "boolean":
    case "number":
    case "any":
    case "undefined":
    case "null":
      return {
        type: keyword.value,
      };
    case "unknown":
      return {
        type: "any",
      };
    default:
      throw new Error(`Unhandled keyword kind "${keyword.value}"`);
  }
}

function typefnOrConstructor(
  node: TsTypeFnOrConstructorDef,
  _status: Status,
): NodeType {
  if (node.value.constructor === false) {
    return {
      type: "function",
    };
  }

  throw new Error(
    `Unhandled fnOrConstructor kind "${node.value.constructor}"`,
  );
}

// deno-lint-ignore no-explicit-any
export function mergeDefaults(node: NodeType, defaults: any, override = false) {
  switch (node.type) {
    case "object":
      if (node.children) {
        for (
          const [key, child] of Object.entries(
            node.children as Record<string, NodeType>,
          )
        ) {
          if (child.default && !override) {
            continue;
          }
          if (defaults && defaults[key] !== undefined) {
            if (
              child.type === "object" && child.children &&
              Object.keys(child.children).length
            ) {
              mergeDefaults(child, defaults[key]);
            } else {
              child.default = defaults[key];
            }
          }
        }
      }
      break;
  }
}
