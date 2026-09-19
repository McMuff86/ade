import { currentLocale } from './index';

/**
 * Read-only, module-level label tables must follow the active language too.
 * Keep their public array/object shape and resolve a fresh snapshot on demand.
 * Do not use for application state, instances, frozen objects or user data.
 */
export function localizedLabels<T extends object>(factory: () => T): T {
  let locale = currentLocale();
  let snapshot = factory();
  const current = (): T => {
    if (locale !== currentLocale()) { locale = currentLocale(); snapshot = factory(); }
    return snapshot;
  };
  const target = Array.isArray(snapshot) ? [] : {};
  return new Proxy(target, {
    get: (_target, key) => Reflect.get(current(), key),
    has: (_target, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      if (!descriptor) return undefined;
      return { ...descriptor, configurable: key !== 'length' || !Array.isArray(snapshot) };
    },
    set: () => { throw new TypeError('Localized label tables are read-only'); },
    deleteProperty: () => { throw new TypeError('Localized label tables are read-only'); },
  }) as T;
}
