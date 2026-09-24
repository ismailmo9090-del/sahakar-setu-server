export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\u0900-\u097F.,!?;:'"()\-]/g, '')
    .trim();
}

export function truncateToWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

export function extractNumbers(text: string): number[] {
  const matches = text.match(/\d[\d,]*\.?\d*/g) || [];
  return matches.map(m => parseFloat(m.replace(/,/g, '')));
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, 2) + '****' + phone.slice(-2);
}
