import { doc } from "https://deno.land/x/deno_doc@0.64.0/mod.ts";

import type {
  DocNode,
  JsDoc,
  LiteralPropertyDef,
  TsTypeDef,
} from "https://deno.land/x/deno_doc@0.64.0/types.d.ts";

interface TypeDef {
  type: string;
  subtype?: string;
  union?: NodeType[];
  children?: string | NodeType | Record<string, NodeType>;
}
interface TypeProps {
  required?: boolean;
  readonly?: boolean;
  [key: string]: unknown;
}
interface Options {
  // deno-lint-ignore no-explicit-any
  defaults?: any;
}

export interface NodeType extends TypeDef, TypeProps {}

export default async function analyze(url: string, options: Options = {}) {
  const docs = await doc(url, {
    includeAll: true,
  });

  const schema: Record<string, Record<string, NodeType>> = {};

  for (const doc of docs) {
    if (doc.declarationKind !== "export" || doc.kind !== "interface") {
      continue;
    }

    const name = doc.name;
    schema[name] = handleInterfaceProperties(
      doc.interfaceDef.properties,
      options.defaults?.[name],
    );
  }

  return schema;

  function findTypeRef(name: string): DocNode | undefined {
    return docs.find((t) => t.name === name);
  }

  function handleInterfaceProperties(
    properties: LiteralPropertyDef[],
    defaults?: Record<string, unknown>,
  ) {
    const props: Record<string, NodeType> = {};

    for (const property of properties) {
      const type = handleInterfaceProperty(property, defaults?.[property.name]);

      if (type) {
        props[property.name] = type;
        continue;
      }
    }

    return props;
  }

  function handleInterfaceProperty(
    property: LiteralPropertyDef,
    defaultValue?: unknown,
  ): NodeType | undefined {
    // @ts-ignore: tsDoc does not exist on LiteralPropertyDef
    const props: TypeProps = handleJsDoc(property.jsDoc);

    if ("optional" in property) {
      props.required = !property.optional;
    }

    if ("readonly" in property) {
      props.readonly = property.readonly;
    }

    if (defaultValue) {
      props.default = defaultValue;
    }

    if (property.tsType) {
      return handleTsType(property.tsType, props);
    }

    throw new Error("No tsType");
  }

  function handleTsType(
    tsType: TsTypeDef,
    props: TypeProps,
  ): NodeType {
    if (tsType.kind === "keyword") {
      return {
        type: tsType.repr,
        ...props,
      };
    }

    if (tsType.kind === "array") {
      const type = handleTsType(tsType.array, props);

      if (type) {
        return {
          type: "array",
          children: type,
          ...props,
        };
      }
    }

    if (tsType.kind === "typeLiteral") {
      return {
        type: "object",
        children: handleInterfaceProperties(tsType.typeLiteral.properties),
        ...props,
      };
    }

    if (tsType.kind === "typeRef") {
      const ref = findTypeRef(tsType.repr);

      if (!ref) {
        return {
          type: tsType.repr,
          ...props,
        };
      }

      if (ref.kind === "typeAlias") {
        const type = handleTsType(ref.typeAliasDef.tsType, props);

        return {
          ...type,
          subtype: tsType.repr,
        };
      }

      if (ref.kind === "interface") {
        return {
          type: "object",
          children: handleInterfaceProperties(ref.interfaceDef.properties),
          ...props,
        };
      }
    }

    if (tsType.kind === "union") {
      return {
        type: "union",
        union: tsType.union.map((t: TsTypeDef) => handleTsType(t, props)),
      };
    }

    console.log(tsType);

    throw new Error("Unhandled tsType");
  }
}

function handleJsDoc(jsDoc?: JsDoc): TypeProps {
  const doc: TypeProps = {};

  if (jsDoc) {
    const { doc: description, tags } = jsDoc;

    if (description) {
      doc.description = description;
    }

    if (tags) {
      for (const tag of tags) {
        const { kind } = tag;
        if (kind === "unsupported") {
          const match = tag.value.match(/@(\w+)(?:\s+(.+))?/);

          if (!match) {
            continue;
          }

          const [, key, value] = match;
          doc[key] = value ? cast(value) : true;
          continue;
        }

        // @ts-ignore: value does not exist on JsDocTag
        doc[kind] = tag.value ?? true;
      }
    }

    return doc;
  }

  return doc;
}

function cast(str: string) {
  switch (str.toLowerCase()) {
    case "true":
      return true;
    case "false":
      return false;
  }
  if (/^\d+$/.test(str)) {
    return Number(str);
  }

  // Unquote string
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    return str.slice(1, -1);
  }
  return str;
}
