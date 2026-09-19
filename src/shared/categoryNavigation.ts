import { t as translate } from "./i18n";
/** A navigation group adds one display level, without inheriting agent or Git policy. */
export function validNavigationGroup(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
    && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}

export function navigationGroup(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!validNavigationGroup(value)) throw new Error(translate("Parent group must contain 1–80 characters without control characters."));
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

/** Move a root row (whole group or loose category), or a member inside its group. */
export function shiftNavigationItem<T extends { id: string; navigationGroup?: string }>(
  categories: readonly T[], key: string, direction: -1 | 1,
): string[] | null {
  const rows = groupCategories(categories);
  const rootIndex = rows.findIndex((row) => row.key === key);
  if (rootIndex >= 0) {
    const next = rootIndex + direction;
    if (next < 0 || next >= rows.length) return null;
    [rows[rootIndex], rows[next]] = [rows[next]!, rows[rootIndex]!];
  } else {
    const parent = rows.find((row) => row.categories.some((cat) => `category:${cat.id}` === key));
    if (!parent) return null;
    const index = parent.categories.findIndex((cat) => `category:${cat.id}` === key);
    const next = index + direction;
    if (next < 0 || next >= parent.categories.length) return null;
    [parent.categories[index], parent.categories[next]] = [parent.categories[next]!, parent.categories[index]!];
  }
  return rows.flatMap((row) => row.categories.map((cat) => cat.id));
}
