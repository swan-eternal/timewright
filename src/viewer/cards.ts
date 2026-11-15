/**
 * Cards: event, location and person cards, with Markdown.
 *
 * Markdown is rendered with `marked` and sanitised with DOMPurify, because
 * a world may come from someone else.
 */

import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderMarkdown(markdown: string | undefined): string {
  if (markdown === undefined || markdown.trim() === "") {
    return "";
  }
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
