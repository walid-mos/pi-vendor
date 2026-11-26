/** The object without its undefined fields, so that what is absent is absent. */
export function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
