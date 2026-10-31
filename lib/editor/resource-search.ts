const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().replace(/\s+/gu, ' ');

export function resourceNameMatches(name: string, query: string): boolean {
  return normalize(name).includes(normalize(query));
}
