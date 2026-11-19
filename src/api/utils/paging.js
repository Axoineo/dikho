// Keyset paging and LIKE search, shared by the routes that page through long lists.

// "<timestamp>|<id>": the sort columns of the last row of the page before.
export const KEYSET_CURSOR = /^(\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?)\|(\d{1,15})$/

// For binding as a LIKE value with ESCAPE '\', so % and _ mean themselves.
export const likeTerm = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`
