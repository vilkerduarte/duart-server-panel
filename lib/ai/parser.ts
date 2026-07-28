/**
 * Parses AI responses to detect command blocks and shell scripts.
 */

export interface ParsedContent {
  type: 'text' | 'command' | 'shellscript';
  content: string;
}

export function parseAIResponse(text: string): ParsedContent[] {
  const parts: ParsedContent[] = [];
  const regex = /```(command|shellscript)?\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index).trim();
      if (textBefore) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    const lang = match[1] || 'command';
    const code = match[2].trim();

    parts.push({
      type: lang === 'shellscript' ? 'shellscript' : 'command',
      content: code,
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      parts.push({ type: 'text', content: remaining });
    }
  }

  // If no code blocks found, return entire text as text
  if (parts.length === 0) {
    return [{ type: 'text', content: text }];
  }

  return parts;
}

/**
 * Extracts only text content from parsed response (for streaming display).
 */
export function extractTextOnly(parsed: ParsedContent[]): string {
  return parsed
    .filter(p => p.type === 'text')
    .map(p => p.content)
    .join('\n\n');
}

/**
 * Extracts commands from parsed response.
 */
export function extractCommands(parsed: ParsedContent[]): string[] {
  return parsed
    .filter(p => p.type === 'command')
    .map(p => p.content);
}

/**
 * Extracts shell scripts from parsed response.
 */
export function extractScripts(parsed: ParsedContent[]): string[] {
  return parsed
    .filter(p => p.type === 'shellscript')
    .map(p => p.content);
}
