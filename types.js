// Shared data types and models

export const OrderStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const FinanceType = {
  INCOME: 'income',
  EXPENSE: 'expense'
};

// Order Model
export class Order {
  constructor(data = {}) {
    this.id = data.id || null;
    this.customerName = data.customerName || '';
    this.customerPhone = data.customerPhone || '';
    this.customerEmail = data.customerEmail || '';
    this.items = data.items || [];
    this.totalAmount = data.totalAmount || 0;
    this.status = data.status || OrderStatus.PENDING;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.notes = data.notes || '';
    this.dueDate = data.dueDate || null;
  }
}

// Supply Model
export class Supply {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.category = data.category || '';
    this.quantity = data.quantity || 0;
    this.unit = data.unit || 'pcs';
    this.costPerUnit = data.costPerUnit || 0;
    this.supplier = data.supplier || '';
    this.lastOrdered = data.lastOrdered || null;
    this.reorderLevel = data.reorderLevel || 0;
    this.notes = data.notes || '';
  }
}

// Finance Transaction Model
export class FinanceTransaction {
  constructor(data = {}) {
    this.id = data.id || null;
    this.type = data.type || FinanceType.INCOME;
    this.amount = data.amount || 0;
    this.category = data.category || '';
    this.description = data.description || '';
    this.date = data.date || new Date().toISOString();
    this.orderId = data.orderId || null;
    this.notes = data.notes || '';
  }
}

// Design Model
export class Design {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.imageUrl = data.imageUrl || '';
    this.category = data.category || '';
    this.tags = data.tags || [];
    this.createdAt = data.createdAt || new Date().toISOString();
    this.usageCount = data.usageCount || 0;
  }
}

// Product/Item Model
export class Product {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.price = data.price || 0;
    this.category = data.category || '';
    this.size = data.size || '';
    this.color = data.color || '';
    this.designId = data.designId || null;
    this.imageUrl = data.imageUrl || '';
  }
}

