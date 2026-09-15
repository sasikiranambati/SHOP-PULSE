export type PageRoute = 
  | 'landing' 
  | 'login' 
  | 'signup' 
  | 'dashboard' 
  | 'sales' 
  | 'inventory' 
  | 'scanner' 
  | 'insights'
  | 'settings';

export type BusinessType = 
  | 'Kirana Store' 
  | 'Bakery' 
  | 'Pharmacy' 
  | 'Tea Stall' 
  | 'Supermarket' 
  | 'Other';

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

export interface Product {
  id: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unit: string;
  price: number;
  status: StockStatus;
  lastRestocked?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface RecentSale {
  id: string;
  items: string;
  total: number;
  time: string;
}

export interface ActionRecommendation {
  id: string;
  type: 'warning' | 'info' | 'urgent';
  productName: string;
  message: string;
  recommendedOrder: string;
}
