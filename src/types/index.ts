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

export type RecentSale = {
  id: string;
  items: string;
  total: number;
  time: string;
};

// Barrel re-exports from modular type files
export * from './user';
export * from './product';
export * from './sale';
export * from './device';
export * from './alert';

