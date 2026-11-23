export type LegalBlock = {
  kind: "title" | "heading" | "paragraph" | "list-item";
  text: string;
  ordered?: boolean;
  index?: number;
};

export function parseLegalMarkdown(markdown: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let activeListItemIndex: number | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (const rawLine of markdown.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      activeListItemIndex = null;
      continue;
    }
    if (line.startsWith("<!--") && line.endsWith("-->")) continue;
    if (line.startsWith("# ")) {
      flushParagraph();
      activeListItemIndex = null;
      blocks.push({ kind: "title", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      activeListItemIndex = null;
      blocks.push({ kind: "heading", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      blocks.push({ kind: "list-item", text: line.slice(2) });
      activeListItemIndex = blocks.length - 1;
      continue;
    }
    const orderedMatch = /^(\d+)\.\s+(.+)$/.exec(line);
    if (orderedMatch) {
      flushParagraph();
      blocks.push({
        kind: "list-item",
        text: orderedMatch[2],
        ordered: true,
        index: Number(orderedMatch[1]),
      });
      activeListItemIndex = blocks.length - 1;
      continue;
    }
    if (activeListItemIndex !== null) {
      blocks[activeListItemIndex].text += ` ${line}`;
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
