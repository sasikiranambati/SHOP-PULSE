export type PageRoute = 
  | 'landing' 
  | 'login' 
  | 'signup' 
  | 'select-store'
  | 'dashboard' 
  | 'sales' 
  | 'inventory' 
  | 'scanner' 
  | 'insights'
  | 'profile';

export type BusinessTypeId = 
  | 'grocery'
  | 'bakery'
  | 'pharmacy'
  | 'teaCoffee'
  | 'sweetShop'
  | 'fruitVegetables'
  | 'mobileAccessories'
  | 'stationery'
  | 'hardware'
  | 'electrical'
  | 'cosmetics'
  | 'household'
  | 'gardening'
  | 'otherRetail';

export interface BusinessTypeOption {
  id: BusinessTypeId;
  name: string;
  emoji: string;
  tagline: string;
  defaultStoreName: string;
  greetingWording: string;
  categoryList: string[];
}

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;         // Selling Price
  purchasePrice: number; // Purchase Price / Cost
  stock: number;
  minStock: number;      // Reorder Level
  unit: string;
  supplier: string;
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

export interface StoreProfile {
  shopName: string;
  ownerName: string;
  businessTypeId: BusinessTypeId;
  location: string;
  contact: string;
}
