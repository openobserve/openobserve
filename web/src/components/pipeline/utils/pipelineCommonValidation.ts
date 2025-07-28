export function sanitizeStreamName(input: string): string | null {
  if(input.length > 100){
    return "";  // Return empty string for too long input
  }
  const regex = /\{[^{}]+\}/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    // Sanitize and add the static part before the dynamic part
    if (match.index > lastIndex) {
      const staticPart = input.slice(lastIndex, match.index);
      parts.push(...sanitizeStaticPart(staticPart));
    }

    // Push the dynamic part as-is
    parts.push(match[0]);

    lastIndex = regex.lastIndex;
  }

  // Sanitize and add the remaining static part (after the last dynamic part)
  if (lastIndex < input.length) {
    const staticPart = input.slice(lastIndex);
    parts.push(...sanitizeStaticPart(staticPart));
  }

  return parts.join('');
}

// Only sanitize non-dynamic parts
function sanitizeStaticPart(str: string): string[] {
  return str.split('').map(char => /[a-zA-Z0-9]/.test(char) ? char : '_');
} 