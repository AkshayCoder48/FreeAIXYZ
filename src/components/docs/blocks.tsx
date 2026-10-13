"use client";

/**
 * DocBlocks — renderer for the FreeAIXYZ documentation content model.
 *
 * Every block renders in the HyperDimension design language:
 *   - paragraphs: Geist 14.5px on #111319;
 *   - code: obsidian mono blocks with a crimson header row (traffic lights
 *     + lang badge) and the warm HyperDimension tokenizer (comments wine,
 *     strings blush, numbers ember, keywords crimson) — NO blue/purple;
 *   - tables: crimson hairlines, mono uppercase headers;
 *   - callouts: crimson/ember/gold-tinted glass;
 *   - kbd: the crimson mono chips.
 *
 * Paragraph text supports a markdown-lite inline grammar:
 *   **bold**  `code`  [label](href)
 */

import * as React from "react";
import { Info, AlertTriangle, Lightbulb, Terminal } from "lucide-react";
import type { DocBlock, DocCalloutTone } from "@/lib/docs/content";

// ─── Inline markdown-lite ────────────────────────────────────────────────────

const INLINE_SPLIT =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function InlineText({ text }: { text: string }) {
  const parts = text.split(INLINE_SPLIT).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="fxz-code">
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
          return (
            <a
              key={i}
              href={link[2]}
              className="text-blush hover:text-gold underline decoration-crimson/40 underline-offset-2 transition-colors"
            >
              {link[1]}
            </a>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

// ─── Warm code tokenizer ─────────────────────────────────────────────────────

const TOKEN_RE_SOURCE = [
  "(\\/\\/[^\\n]*)", // // line comment
  "(#[^\\n]*)", // # line comment (bash / json comments in text)
  "(\"[^\"\\n]*\"|'[^'\\n]*')", // strings
  "(\\b\\d+(?:\\.\\d+)?\\b)", // numbers
  "(\\b(?:const|let|var|function|return|import|from|export|default|await|async|true|false|null|undefined|if|else|for|while|try|catch|throw|new|class|type|interface|string|number|boolean|def|print|curl|GET|POST|not-needed)\\b)", // keywords
].join("|");

function CodeLine({ line }: { line: string }) {
  // A LOCAL regex (fresh per render) — module-level stateful regexes are
  // not allowed by the react-hooks/immutability rule.
  const tokenRe = new RegExp(TOKEN_RE_SOURCE, "g");
  const pieces: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(line)) !== null) {
    if (m.index > last) {
      pieces.push(line.slice(last, m.index));
    }
    const [tok, comment, hash, str, num, kw] = m;
    if (comment || hash) {
      pieces.push(
        <span key={pieces.length} className="text-[#8a5a5e] italic">
          {tok}
        </span>,
      );
    } else if (str) {
      pieces.push(
        <span key={pieces.length} className="text-blush">
          {tok}
        </span>,
      );
    } else if (num) {
      pieces.push(
        <span key={pieces.length} className="text-ember">
          {tok}
        </span>,
      );
    } else if (kw) {
      pieces.push(
        <span key={pieces.length} className="text-crimson font-semibold">
          {tok}
        </span>,
      );
    } else {
      pieces.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < line.length) pieces.push(line.slice(last));
  return <>{pieces.length ? pieces : "\u00A0"}</>;
}

function CodeBlock({
  title,
  lang,
  code,
}: {
  title?: string;
  lang?: string;
  code: string;
}) {
  const lines = code.split("\n");
  return (
    <div className="fxz-cmdbar overflow-hidden my-4" aria-label={title ?? "Code example"}>
      {/* Header row — crimson traffic lights + language badge */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-hd-highest/60">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson shadow-[0_0_6px_rgba(255,42,85,0.8)]" />
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-ember shadow-[0_0_6px_rgba(255,133,13,0.8)]" />
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gold" />
          {title && (
            <span
              className="ml-2 text-[10.5px] text-muted-foreground truncate"
              style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
            >
              {title}
            </span>
          )}
        </div>
        <span
          className="shrink-0 text-[10px] uppercase tracking-[0.15em] text-ember"
          style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
        >
          {lang ?? "text"}
        </span>
      </div>
      <pre
        className="overflow-x-auto px-4 sm:px-5 py-4 text-[12px] leading-[1.7] text-[#e2e2ea] custom-scroll"
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        <code>
          {lines.map((line, i) => (
            <React.Fragment key={i}>
              <CodeLine line={line} />
              {i < lines.length - 1 && "\n"}
            </React.Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ─── Callouts ────────────────────────────────────────────────────────────────

const CALLOUT_META: Record<
  DocCalloutTone,
  { cls: string; icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  info: { cls: "fxz-docs-callout-info", icon: Info, label: "Note" },
  warn: { cls: "fxz-docs-callout-warn", icon: AlertTriangle, label: "Warning" },
  tip: { cls: "fxz-docs-callout-tip", icon: Lightbulb, label: "Tip" },
};

function Callout({
  tone,
  title,
  text,
}: {
  tone: DocCalloutTone;
  title?: string;
  text: string;
}) {
  const meta = CALLOUT_META[tone];
  const Icon = meta.icon;
  return (
    <div className={`fxz-docs-callout ${meta.cls} my-4 flex gap-3`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5 text-ember" />
      <div className="min-w-0">
        <p className="font-semibold text-white text-[13px] mb-1">
          {title ?? meta.label}
        </p>
        <p className="min-w-0">
          <InlineText text={text} />
        </p>
      </div>
    </div>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="my-4 overflow-x-auto custom-scroll fxz-code-block">
      <table className="fxz-docs-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>
                  {j === 0 ? <InlineText text={cell} /> : <InlineText text={cell} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Kbd rows ────────────────────────────────────────────────────────────────

function KbdRow({ items }: { items: { keys: string; label: string }[] }) {
  return (
    <div className="my-4 fxz-code-block rounded-[10px] p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-wrap">
      <span
        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground shrink-0"
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        <Terminal className="inline h-3 w-3 mr-1.5 -mt-0.5 text-crimson" />
        shortcuts
      </span>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {items.map((item) => (
          <span key={item.keys} className="inline-flex items-center gap-2.5">
            <span className="fxz-kbd">{item.keys}</span>
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Block dispatcher ────────────────────────────────────────────────────────

export function DocBlockView({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="my-3.5">
          <InlineText text={block.text} />
        </p>
      );
    case "h3":
      return (
        <h3 className="mt-8 mb-2 scroll-mt-28" id={slugify(block.text)}>
          <InlineText text={block.text} />
        </h3>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          className={`my-3.5 pl-6 ${block.ordered ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="my-1.5 marker:text-crimson/70">
              <InlineText text={item} />
            </li>
          ))}
        </ListTag>
      );
    }
    case "code":
      return <CodeBlock title={block.title} lang={block.lang} code={block.code} />;
    case "table":
      return <Table head={block.head} rows={block.rows} />;
    case "callout":
      return <Callout tone={block.tone} title={block.title} text={block.text} />;
    case "kbd":
      return <KbdRow items={block.items} />;
  }
}

/** slugify a heading for anchors (page-scoped usage: pass a prefix). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
