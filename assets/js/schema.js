// Plain schema map: importable in Node (no indexedDB access).
export const DB_NAME = 'agorasite-fashion1-v1';
export const SCHEMA_VERSION = 1;

const idx = (name, keyPath = name, options = {}) => ({ name, keyPath, options });

export const STORE_DEFS = {
  categories: { keyPath: 'id', indexes: [] },
  products: { keyPath: 'id', indexes: [idx('categoryId'), idx('slug')] },
  variants: { keyPath: 'sku', indexes: [idx('productId')] },
  carts: { keyPath: 'id', indexes: [] },
  wishlists: { keyPath: 'id', indexes: [] },
  customers: { keyPath: 'id', indexes: [] },
  orders: { keyPath: 'id', indexes: [idx('customerId'), idx('createdAt')] },
  coupons: { keyPath: 'code', indexes: [] },
  reviews: { keyPath: 'id', indexes: [] },
  settings: { keyPath: 'key', indexes: [] },
  content: { keyPath: 'key', indexes: [] },
};
