/** A navigation group adds one display level, without inheriting agent or Git policy. */
export function validNavigationGroup(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
    && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}

export function navigationGroup(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!validNavigationGroup(value)) throw new Error('Obergruppe muss 1–80 Zeichen ohne Steuerzeichen enthalten.');
  return value;
}

/** First category determines group position; membership order remains the catalog order. */
export function groupCategories<T extends { id: string; navigationGroup?: string }>(categories: readonly T[]): Array<{ key: string; name?: string; categories: T[] }> {
  const rows: Array<{ key: string; name?: string; categories: T[] }> = [];
  const groups = new Map<string, (typeof rows)[number]>();
  for (const category of categories) {
    if (!category.navigationGroup) { rows.push({ key: `category:${category.id}`, categories: [category] }); continue; }
    let group = groups.get(category.navigationGroup);
    if (!group) {
      group = { key: `group:${category.navigationGroup}`, name: category.navigationGroup, categories: [] };
      groups.set(category.navigationGroup, group); rows.push(group);
    }
    group.categories.push(category);
  }
  return rows;
}
