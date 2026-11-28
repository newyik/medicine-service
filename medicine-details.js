export const medicineDetailFields = {
  productName: ['正式名称', 200],
  ingredient: ['成分', 200],
  strength: ['规格／含量', 100],
  brand: ['品牌／厂家', 120],
  notes: ['备注', 1000]
};

export function validateMedicineDetails(details = {}) {
  if (!details || Array.isArray(details) || typeof details !== 'object') throw new Error('Invalid medicine details');
  const result = Object.create(null);
  for (const [id, detail] of Object.entries(details)) {
    if (!id || id.length > 100 || !detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('Invalid medicine detail');
    const fields = {};
    for (const [key, [, limit]] of Object.entries(medicineDetailFields)) {
      const value = detail[key] ?? '';
      if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid medicine detail field');
      fields[key] = value.trim();
    }
    result[id] = fields;
  }
  return result;
}
