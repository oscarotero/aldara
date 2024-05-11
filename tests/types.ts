type Markdown = string;
type Tag = string;
interface People {
  name: string;
  email: string;
}

/** The title of the blog post */
export interface Blog {
  /** Hello
  @readonly
  @see https://example.com
   */
  title: string;
  /** @default "subtitle" */
  subtitle?: string;
  content: Markdown;
  readonly date: Date;
  tags: Tag[];
  authors: {
    name: string;
    email: string;
  }[];
  people: string | People[];
}

export const defaults: Blog = {
  title: "Hello World",
  content: "Hello World",
  date: new Date("2020-01-01T00:00:00Z"),
  tags: [],
  authors: [],
  people: [],
};
