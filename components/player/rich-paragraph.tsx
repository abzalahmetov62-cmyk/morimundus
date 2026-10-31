import type { Paragraph } from '@/lib/engine/project';

export function RichParagraph({ paragraph }: { paragraph: Paragraph }) {
  return <p className="rich-paragraph">{paragraph.spans.map((span, index) => {
    let content: React.ReactNode = span.text;
    if (span.marks.includes('bold')) content = <strong>{content}</strong>;
    if (span.marks.includes('italic')) content = <em>{content}</em>;
    if (span.marks.includes('underline')) content = <u>{content}</u>;
    if (span.marks.includes('strike')) content = <s>{content}</s>;
    return <span key={index}>{content}</span>;
  })}</p>;
}
