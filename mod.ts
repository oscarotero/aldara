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
  private?: boolean;
}

export interface NodeType extends TypeDef, TypeProps {}

export async function nativeDoc(
  url: string,
  includePrivate = false,
): Promise<DocNode[]> {
  const args = ["doc", "--json"];
  if (includePrivate) {
    args.push("--private");
  }
  args.push(url);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "piped",
  });

  const { stdout } = await command.output();

  const decoder = new TextDecoder();
  const json = decoder.decode(stdout);

  return JSON.parse(json);
}

export default async function analyze(url: string, options: Options = {}) {
  const docs = await nativeDoc(url, options.private);

  const schema: Record<string, Record<string, NodeType>> = {};

  for (const doc of docs) {
    if (doc.declarationKind !== "export" || doc.kind !== "interface") {
      continue;
    }

    const name = doc.name;
    schema[name] = await handleInterfaceProperties(
      doc.interfaceDef.properties,
      options.defaults?.[name],
    );
  }

  return schema;

  function findTypeRef(name: string): DocNode | undefined {
    return docs.find((t) => t.name === name);
  }

  async function handleInterfaceProperties(
    properties: LiteralPropertyDef[],
    defaults?: Record<string, unknown>,
  ) {
    const props: Record<string, NodeType> = {};

    for (const property of properties) {
      const type = await handleInterfaceProperty(
        property,
        defaults?.[property.name],
      );

      if (type) {
        props[property.name] = type;
        continue;
      }
    }

    return props;
  }

  async function handleInterfaceProperty(
    property: LiteralPropertyDef,
    defaultValue?: unknown,
  ): Promise<NodeType | undefined> {
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
      return await handleTsType(property.tsType, props);
    }

    throw new Error("No tsType");
  }

  async function handleTsType(
    tsType: TsTypeDef,
    props: TypeProps,
  ): Promise<NodeType | undefined> {
    if (tsType.kind === "keyword") {
      return {
        type: tsType.repr,
        ...props,
      };
    }

    if (tsType.kind === "array") {
      const type = await handleTsType(tsType.array, props);

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
        children: await handleInterfaceProperties(
          tsType.typeLiteral.properties,
        ),
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
        const type = await handleTsType(ref.typeAliasDef.tsType, props);
        return type
          ? {
            ...type,
            subtype: tsType.repr,
          }
          : {
            type: tsType.repr,
            ...props,
          };
      }

      if (ref.kind === "interface") {
        return {
          type: "object",
          children: await handleInterfaceProperties(
            ref.interfaceDef.properties,
          ),
          ...props,
        };
      }

      if (ref.kind === "import") {
        const doc = await nativeDoc(ref.importDef.src);
        const type = doc.find((t) => t.name === ref.importDef.imported);

        if (type?.kind === "interface") {
          return {
            type: "object",
            children: await handleInterfaceProperties(
              type.interfaceDef.properties,
            ),
            ...props,
          };
        }
      }

      throw new Error("Unhandled typeRef");
    }

    if (tsType.kind === "union") {
      return {
        type: "union",
        union: (await Promise.all(tsType.union.map((t: TsTypeDef) =>
          handleTsType(t, props)
        ))).filter((i) =>
          i
        ) as NodeType[],
      };
    }

    // console.log(tsType);
    // throw new Error("Unhandled tsType");
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
