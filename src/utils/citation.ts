export function extractCitations(text: string): string[] {
  const patterns = [
    /\[Source:\s*([^\]]+)\]/g,
    /\[source:\s*([^\]]+)\]/g,
    /\[Src:\s*([^\]]+)\]/g,
    /(?<!\[)Source:\s*([^\]\n,]+)/g,
  ];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const citation = match[1].trim();
      if (!seen.has(citation)) {
        seen.add(citation);
        matches.push(citation);
      }
    }
  }
  return matches;
}

export function formatCitation(sourceDoc: string, sectionRef: string): string {
  return `[Source: ${sourceDoc}, ${sectionRef}]`;
}

export function hasCitations(text: string): boolean {
  return extractCitations(text).length > 0;
}
